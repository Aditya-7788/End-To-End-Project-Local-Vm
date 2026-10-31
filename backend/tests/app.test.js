const request = require('supertest');
const { createApp } = require('../src/app');
const { createTestPool } = require('./setup');
const { detectEmergency } = require('../src/services/emergency');
const { validateToolInput, systemPrompt } = require('../src/services/chat-service');
const { loadConfig } = require('../src/config');

const jwtSecret = 'test-secret-with-more-than-thirty-two-characters';

describe('CareFlow API', () => {
  let pool;
  let app;
  let token;

  beforeAll(async () => {
    pool = await createTestPool();
    app = createApp({ pool, jwtSecret, geminiApiKey: '' });
    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: 'patient@example.test', password: 'a-safe-test-password' });
    expect(response.status).toBe(201);
    token = response.body.token;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('registers and authenticates users with hashed passwords', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'patient@example.test', password: 'a-safe-test-password' });
    expect(login.status).toBe(200);
    expect(login.body.token).toEqual(expect.any(String));

    const invalid = await request(app)
      .post('/api/auth/login')
      .send({ email: 'patient@example.test', password: 'incorrect-password' });
    expect(invalid.status).toBe(401);
  });

  it('rejects invalid credentials and protects patient endpoints', async () => {
    const invalid = await request(app)
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: 'short' });
    expect(invalid.status).toBe(400);

    const unauthorized = await request(app).get('/api/appointments/me');
    expect(unauthorized.status).toBe(401);
  });

  it('makes double booking impossible and permits only the owning patient to cancel', async () => {
    const doctors = await request(app).get('/api/doctors?specialty=Neurology');
    expect(doctors.status).toBe(200);
    expect(doctors.body.doctors).toHaveLength(2);
    const doctor = doctors.body.doctors[0];
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const date = tomorrow.toISOString().slice(0, 10);
    const slotResponse = await request(app).get(`/api/doctors/${doctor.id}/slots?date=${date}`);
    expect(slotResponse.status).toBe(200);
    const slot = slotResponse.body.slots[0];
    expect(slot).toBeDefined();

    const first = await request(app)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send({ doctorId: doctor.id, slotId: slot.id, confirmed: true });
    expect(first.status).toBe(201);

    const duplicate = await request(app)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send({ doctorId: doctor.id, slotId: slot.id, confirmed: true });
    expect(duplicate.status).toBe(409);

    const anotherPatient = await request(app)
      .post('/api/auth/register')
      .send({ email: 'other-patient@example.test', password: 'another-safe-password' });
    const forbiddenCancel = await request(app)
      .delete(`/api/appointments/${first.body.appointment.id}`)
      .set('Authorization', `Bearer ${anotherPatient.body.token}`);
    expect(forbiddenCancel.status).toBe(404);

    const appointmentList = await request(app)
      .get('/api/appointments/me')
      .set('Authorization', `Bearer ${token}`);
    expect(appointmentList.body.appointments).toHaveLength(1);
    expect(appointmentList.body.appointments[0].id).toBe(first.body.appointment.id);
  });

  it('returns emergencies immediately in English and Hindi/Hinglish', async () => {
    for (const message of ['I have chest pain', 'I have trouble breathing', 'saans nahi aa rahi', 'मुझे सीने में दर्द है']) {
      const response = await request(app)
        .post('/api/chat')
        .set('Authorization', `Bearer ${token}`)
        .send({ sessionId: `emergency-${message.length}`, message });
      expect(response.status).toBe(200);
      expect(response.body.emergency).toBe(true);
      expect(response.body.reply).toMatch(/emergency services|emergency number|आपातकालीन सेवाओं/i);
      expect(response.body.doctors).toHaveLength(0);
    }
    expect(detectEmergency('I have severe bleeding')).toBe(true);

    const geminiClient = { models: { generateContent: jest.fn() } };
    const geminiApp = createApp({
      pool,
      jwtSecret,
      geminiApiKey: 'not-a-real-test-key',
      model: 'test-gemini-model',
      geminiClient
    });
    const emergency = await request(geminiApp)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ sessionId: 'gemini-emergency', message: 'I have chest pain' });
    expect(emergency.body.emergency).toBe(true);
    expect(geminiClient.models.generateContent).not.toHaveBeenCalled();
  });

  it('uses the mock chat without an API key and asks before booking', async () => {
    const first = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ sessionId: 'mock-chat', message: '2 din se sar dard aur bukhar hai' });
    expect(first.status).toBe(200);
    expect(first.body.reply).toMatch(/Neurology/);
    expect(first.body.doctors.length).toBeGreaterThan(0);
    expect(first.body.slots.length).toBeGreaterThanOrEqual(3);
    expect(first.body.slots.length).toBeLessThanOrEqual(5);
    expect(first.body.slots[0].doctor_name).toBeTruthy();
    expect(first.body.slots[0].clinic).toBeTruthy();
    expect(first.body.pendingBooking).toBeNull();

    const availability = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ sessionId: 'mock-chat', message: 'Kal subah please show available slots.' });
    expect(availability.body.slots.length).toBeGreaterThan(0);
    const chosenSlot = availability.body.slots[0];

    const pending = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sessionId: 'mock-chat',
        message: `I would like to select slot ${chosenSlot.id} with doctor ${chosenSlot.doctor_id}.`
      });
    expect(pending.body.pendingBooking.slotId).toBe(chosenSlot.id);
    const beforeConfirmation = await request(app)
      .get('/api/appointments/me')
      .set('Authorization', `Bearer ${token}`);
    const previousAppointmentCount = beforeConfirmation.body.appointments.length;

    const confirmed = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ sessionId: 'mock-chat', message: 'Yes, confirm this appointment.' });
    expect(confirmed.body.appointment).toBeDefined();
    expect(confirmed.body.pendingBooking).toBeNull();
    const afterConfirmation = await request(app)
      .get('/api/appointments/me')
      .set('Authorization', `Bearer ${token}`);
    expect(afterConfirmation.body.appointments).toHaveLength(previousAppointmentCount + 1);
    expect(confirmed.body.reply).toMatch(/Dr\..*, .* \d{4}.*\d{1,2}:\d{2}/);
  });

  it('matches a requested date and time and waits for explicit confirmation', async () => {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
    const tomorrow = new Date(`${today}T00:00:00.000Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const date = tomorrow.toISOString().slice(0, 10);
    const response = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ sessionId: 'requested-slot', message: 'I have a skin rash, tomorrow at 10 baje subah.' });
    expect(response.status).toBe(200);
    expect(response.body.pendingBooking).toMatchObject({
      doctorName: expect.any(String),
      slotId: expect.any(String)
    });
    expect(new Date(response.body.pendingBooking.startsAt).toISOString().slice(0, 10)).toBe(date);
    expect(response.body.reply).toContain('Dermatology');
    expect(response.body.reply).toContain('10:00 am');

    const beforeConfirmation = await request(app)
      .get('/api/appointments/me')
      .set('Authorization', `Bearer ${token}`);
    const count = beforeConfirmation.body.appointments.length;
    const confirmed = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ sessionId: 'requested-slot', message: 'Haan, confirm.' });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.appointment).toBeDefined();
    expect(confirmed.body.reply).toContain(response.body.pendingBooking.doctorName);
    const afterConfirmation = await request(app)
      .get('/api/appointments/me')
      .set('Authorization', `Bearer ${token}`);
    expect(afterConfirmation.body.appointments).toHaveLength(count + 1);
  });

  it('searches for a General Physician while asking one clarifying question for vague symptoms', async () => {
    const response = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ sessionId: 'vague-symptoms', message: 'Mujhe theek nahi lag raha.' });
    expect(response.status).toBe(200);
    expect(response.body.reply).toMatch(/General Physician/);
    expect(response.body.reply).toMatch(/\?/);
    expect(response.body.doctors).toHaveLength(2);
    expect(response.body.slots.length).toBeGreaterThanOrEqual(3);
    expect(response.body.pendingBooking).toBeNull();
  });

  it('validates tool arguments and constrains assistant behavior', () => {
    expect(validateToolInput('get_slots', {
      doctor_id: 'not-a-uuid',
      date: 'tomorrow'
    }).success).toBe(false);
    expect(validateToolInput('get_slots', {
      doctor_id: '44f3ca01-e40a-49e9-9b17-cd96f26b6b34',
      date: '2026-10-31'
    }).success).toBe(true);
    expect(validateToolInput('book_appointment', {
      doctor_id: '44f3ca01-e40a-49e9-9b17-cd96f26b6b34',
      slot_id: '44f3ca01-e40a-49e9-9b17-cd96f26b6b34',
      user_id: 'untrusted-user-id'
    }).success).toBe(false);
    expect(validateToolInput('unknown', {}).success).toBe(false);
    expect(systemPrompt).toMatch(/Never diagnose/);
    expect(systemPrompt).toMatch(/Never book without explicit confirmation/);
  });

  it('validates runtime configuration without echoing secret values', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://careflow:test-password@localhost:5432/careflow',
      JWT_SECRET: 'a'.repeat(40),
      UNRELATED_HOST_VARIABLE: 'ignored'
    });
    expect(config.PORT).toBe(3000);
    expect(config.GEMINI_API_KEY).toBe('');
    expect(config.LLM_MODEL).toBe('');
    expect(() => loadConfig({
      DATABASE_URL: 'postgres://localhost:5432/careflow',
      JWT_SECRET: 'a'.repeat(40),
      GEMINI_API_KEY: 'test-key'
    })).toThrow(/LLM_MODEL/);
    expect(() => loadConfig({
      DATABASE_URL: 'postgres://careflow:test-password@localhost:5432/careflow',
      JWT_SECRET: 'short'
    })).toThrow(/JWT_SECRET/);
  });

  it('validates mocked Gemini function calls without contacting Google', async () => {
    const geminiClient = {
      models: {
        generateContent: jest.fn()
          .mockResolvedValueOnce({
            candidates: [{
              content: {
                role: 'model',
                parts: [{
                  functionCall: {
                    name: 'get_slots',
                    args: { doctor_id: 'not-a-uuid', date: 'tomorrow' }
                  }
                }]
              }
            }]
          })
          .mockResolvedValueOnce({
            candidates: [{
              content: {
                role: 'model',
                parts: [{ text: 'I need a valid appointment date to check slots.' }]
              }
            }]
          })
      }
    };
    const toolApp = createApp({
      pool,
      jwtSecret,
      geminiApiKey: 'not-a-real-test-key',
      model: 'test-gemini-model',
      geminiClient
    });
    const response = await request(toolApp)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ sessionId: 'tool-validation', message: 'Can you help me plan a visit?' });
    expect(response.status).toBe(200);
    expect(response.body.reply).toContain('valid appointment date');
    expect(geminiClient.models.generateContent).toHaveBeenCalledTimes(2);
    const functionResult = geminiClient.models.generateContent.mock.calls[1][0].contents.at(-1).parts[0].functionResponse;
    expect(functionResult.response.error).toContain('Invalid tool input');
  });

  it('returns a friendly message when Gemini reports a quota limit', async () => {
    const geminiClient = {
      models: {
        generateContent: jest.fn().mockRejectedValue(Object.assign(new Error('Quota exceeded'), { status: 429 }))
      }
    };
    const toolApp = createApp({
      pool,
      jwtSecret,
      geminiApiKey: 'not-a-real-test-key',
      model: 'test-gemini-model',
      geminiClient
    });
    const response = await request(toolApp)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ sessionId: 'gemini-quota', message: 'Hello!' });
    expect(response.status).toBe(200);
    expect(response.body.reply).toMatch(/usage limit/i);
  });

  it('provides liveness, readiness, and Prometheus metrics', async () => {
    expect((await request(app).get('/health')).status).toBe(200);
    expect((await request(app).get('/ready')).status).toBe(200);
    const metrics = await request(app).get('/metrics');
    expect(metrics.status).toBe(200);
    expect(metrics.text).toContain('careflow_http_requests_total');
    expect(metrics.text).toContain('careflow_booking_results_total');
  });
});
