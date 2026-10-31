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
    app = createApp({ pool, jwtSecret, apiKey: '' });
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
    for (const message of ['I have chest pain', 'saans nahi aa rahi', 'seene mein dard hai']) {
      const response = await request(app)
        .post('/api/chat')
        .set('Authorization', `Bearer ${token}`)
        .send({ sessionId: `emergency-${message.length}`, message });
      expect(response.status).toBe(200);
      expect(response.body.emergency).toBe(true);
      expect(response.body.reply).toMatch(/nearest emergency room/i);
    }
    expect(detectEmergency('I have severe bleeding')).toBe(true);
  });

  it('uses the mock chat without an API key and asks before booking', async () => {
    const first = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ sessionId: 'mock-chat', message: '2 din se sar dard aur bukhar hai' });
    expect(first.status).toBe(200);
    expect(first.body.reply).toMatch(/Neurology/);
    expect(first.body.reply).toMatch(/not a diagnosis/i);
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
    expect(config.LLM_MODEL).toBe('claude-3-5-haiku-latest');
    expect(() => loadConfig({
      DATABASE_URL: 'postgres://careflow:test-password@localhost:5432/careflow',
      JWT_SECRET: 'short'
    })).toThrow(/JWT_SECRET/);
  });

  it('validates mocked LLM tool calls without contacting Anthropic', async () => {
    const anthropicClient = {
      messages: {
        create: jest.fn()
          .mockResolvedValueOnce({
            stop_reason: 'tool_use',
            content: [{
              type: 'tool_use',
              id: 'tool-invalid-date',
              name: 'get_slots',
              input: { doctor_id: 'not-a-uuid', date: 'tomorrow' }
            }]
          })
          .mockResolvedValueOnce({
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: 'I need a valid appointment date to check slots.' }]
          })
      }
    };
    const toolApp = createApp({ pool, jwtSecret, apiKey: 'not-a-real-test-key', anthropicClient });
    const response = await request(toolApp)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ sessionId: 'tool-validation', message: 'Find me a neurology appointment.' });
    expect(response.status).toBe(200);
    expect(response.body.reply).toContain('valid appointment date');
    expect(anthropicClient.messages.create).toHaveBeenCalledTimes(2);
    const toolResultMessage = anthropicClient.messages.create.mock.calls[1][0].messages.at(-1);
    expect(toolResultMessage.content[0].is_error).toBeUndefined();
    expect(toolResultMessage.content[0].content).toContain('Invalid tool input');
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
