const Anthropic = require('@anthropic-ai/sdk');
const { z } = require('zod');
const { detectEmergency, emergencyReply } = require('./emergency');

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  (value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
);
const uuidSchema = z.string().uuid();
const toolSchemas = {
  search_doctors: z.object({
    specialty: z.string().trim().min(2).max(80).optional(),
    date: dateSchema.optional()
  }).strict(),
  get_slots: z.object({
    doctor_id: uuidSchema,
    date: dateSchema
  }).strict(),
  book_appointment: z.object({
    doctor_id: uuidSchema,
    slot_id: uuidSchema
  }).strict()
};

const toolDefinitions = [
  {
    name: 'search_doctors',
    description: 'Find fake demo doctors by medical specialty, optionally limited to a date.',
    input_schema: {
      type: 'object',
      properties: {
        specialty: { type: 'string', description: 'Specialty to search for, such as Neurology.' },
        date: { type: 'string', description: 'Optional appointment date in YYYY-MM-DD format.' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_slots',
    description: 'List available appointment times for a doctor on a date.',
    input_schema: {
      type: 'object',
      properties: {
        doctor_id: { type: 'string' },
        date: { type: 'string', description: 'Appointment date in YYYY-MM-DD format.' }
      },
      required: ['doctor_id', 'date'],
      additionalProperties: false
    }
  },
  {
    name: 'book_appointment',
    description: 'Request an appointment. The app will ask the patient to confirm before booking.',
    input_schema: {
      type: 'object',
      properties: {
        doctor_id: { type: 'string' },
        slot_id: { type: 'string' }
      },
      required: ['doctor_id', 'slot_id'],
      additionalProperties: false
    }
  }
];

const systemPrompt = `You are CareFlow, a medical appointment scheduling assistant, not a doctor.
Never diagnose, interpret test results, recommend treatment, or give medical advice. You may only suggest a medical specialty and help find fake demo doctors and available appointment slots.
Reply in the user's language (English or Hindi/Hinglish). Ask a concise follow-up question if the symptoms, preferred date, specialty, or desired slot are unclear.
Use search_doctors and get_slots to look up doctors and availability; never invent clinicians or slots. Never claim an appointment is booked unless the booking tool reports success.
Never book without explicit confirmation. When the user has selected a doctor and slot, call book_appointment; the application will require a separate explicit confirmation before creating the booking. Do not ask for names, contact details, or other unnecessary personal information.
This service uses fictional demonstration doctors and is not for medical care. If an emergency is described, direct the user to emergency services.`;

function isExplicitConfirmation(message) {
  return /^(?:yes|yeah|yep|confirm|confirmed|book it|please book|go ahead|haan|han|haanji|ji haan|kar do|confirm karo|हाँ|हां|जी हाँ|ठीक है)(?:\s*(?:,|and)?\s*(?:please|confirm(?: this appointment)?|book(?: it| this appointment)?|I confirm|go ahead))?\s*[.!।]*$/i.test(message.trim());
}

function isCancellation(message) {
  return /^(?:no|nope|cancel|cancel it|cancel this appointment|don't book|do not book|nahi|nahin|mat karo|रद्द|नहीं)\s*[.!।]*$/i.test(message.trim());
}

function validateToolInput(name, input) {
  const schema = toolSchemas[name];
  if (!schema) return { success: false, error: 'Unknown assistant tool.' };
  const result = schema.safeParse(input);
  if (!result.success) return { success: false, error: 'Invalid tool input.' };
  return { success: true, data: result.data };
}

function inferSpecialty(message) {
  const text = message.toLowerCase();
  if (/\b(child|children|kid|baby|pediatric|pediatrics|bachch|बच्चे|बच्चा)\b/.test(text)) return 'Pediatrics';
  if (/\b(dermatology|dermatologist|skin|rash|acne|itch|त्वचा|खुजली|दाने)\b/.test(text)) return 'Dermatology';
  if (/\b(neurology|neurologist|headache|migraine|head pain|sar dard|सिर दर्द|चक्कर)\b/.test(text)) return 'Neurology';
  if (/\b(cardiology|cardiologist|heart|cardiac|palpitation|dil|दिल)\b/.test(text)) return 'Cardiology';
  if (/\b(general physician|general medicine|family medicine|fever|cough|cold|bukhar|खांसी|बुखार|जुकाम)\b/.test(text)) return 'General Physician';
  return null;
}

function getPreferredDate(message) {
  const explicitDate = message.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (explicitDate) return explicitDate[1];
  if (/\b(today|aaj|आज)\b/i.test(message)) return new Date().toISOString().slice(0, 10);
  if (/\b(tomorrow|kal|next day|कल)\b/i.test(message)) {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    return tomorrow.toISOString().slice(0, 10);
  }
  return null;
}

function createChatService({
  pool,
  doctorService,
  appointmentService,
  apiKey = process.env.ANTHROPIC_API_KEY,
  model = process.env.LLM_MODEL || 'claude-3-5-haiku-latest',
  anthropicClient
}) {
  const client = anthropicClient || (apiKey ? new Anthropic({ apiKey }) : null);

  async function saveSession({ sessionId, userId, history, pendingBooking }) {
    await pool.query(
      `INSERT INTO chat_sessions (id, user_id, history, pending_booking, updated_at)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, now())
       ON CONFLICT (id, user_id)
       DO UPDATE SET history = EXCLUDED.history,
                     pending_booking = EXCLUDED.pending_booking,
                     updated_at = now()`,
      [sessionId, userId, JSON.stringify(history.slice(-12)), pendingBooking ? JSON.stringify(pendingBooking) : null]
    );
  }

  async function getSession(sessionId, userId) {
    const { rows } = await pool.query(
      'SELECT history, pending_booking FROM chat_sessions WHERE id = $1 AND user_id = $2',
      [sessionId, userId]
    );
    return rows[0] || { history: [], pending_booking: null };
  }

  async function executeTool(name, input, context) {
    const parsed = validateToolInput(name, input);
    if (!parsed.success) {
      return { error: 'Invalid tool input. Use valid UUIDs and dates formatted YYYY-MM-DD.' };
    }
    const args = parsed.data;
    if (name === 'search_doctors') {
      context.doctors = await doctorService.search({ specialty: args.specialty, date: args.date });
      return context.doctors;
    }
    if (name === 'get_slots') {
      const doctor = await doctorService.getDoctor(args.doctor_id);
      if (!doctor) return { error: 'Doctor not found.' };
      context.slots = await doctorService.getSlots({ doctorId: args.doctor_id, date: args.date });
      context.selectedDoctor = doctor;
      return context.slots;
    }

    const selected = await appointmentService.validateSelection({
      doctorId: args.doctor_id,
      slotId: args.slot_id
    });
    context.pendingBooking = {
      doctorId: args.doctor_id,
      slotId: args.slot_id,
      doctorName: selected.doctor_name,
      specialty: selected.specialty,
      startsAt: selected.starts_at
    };
    return {
      confirmation_required: true,
      doctor_name: selected.doctor_name,
      specialty: selected.specialty,
      starts_at: selected.starts_at,
      message: 'Ask the patient to explicitly confirm this appointment in a separate message. Do not say it is booked.'
    };
  }

  async function ruleBasedReply(message, history, context) {
    const conversation = [...history.map((item) => item.content), message].join(' ');
    const specialty = inferSpecialty(conversation);
    const asksForDoctor = /\b(doctor|appointment|book|slot|available|specialist)\b/i.test(message);
    const selection = message.match(/slot\s+([0-9a-f-]{36}).*doctor\s+([0-9a-f-]{36})/i);
    if (selection) {
      try {
        const selected = await appointmentService.validateSelection({ slotId: selection[1], doctorId: selection[2] });
        context.pendingBooking = {
          doctorId: selection[2],
          slotId: selection[1],
          doctorName: selected.doctor_name,
          specialty: selected.specialty,
          startsAt: selected.starts_at
        };
        return {
          reply: `Please confirm: ${selected.doctor_name}, ${selected.specialty}, ${new Date(selected.starts_at).toLocaleString()}. Reply “confirm” to book, or “cancel” to discard this request.`,
          doctors: [],
          slots: []
        };
      } catch (error) {
        if (error.status === 409) {
          return { reply: 'That appointment time is no longer available. I can help you look for another slot.', doctors: [], slots: [] };
        }
        throw error;
      }
    }

    if (!specialty && !context.pendingBooking) {
      return {
        reply: 'I can help find a specialist, but I need a little more detail. What symptoms are you experiencing, and what day would you prefer?',
        doctors: [],
        slots: []
      };
    }
    const date = getPreferredDate(conversation);
    if (specialty && (asksForDoctor || date)) {
      const doctors = await doctorService.search({ specialty });
      if (date) {
        const results = await Promise.all(doctors.map(async (doctor) => ({
          doctor,
          slots: await doctorService.getSlots({ doctorId: doctor.id, date })
        })));
        const available = results.filter((result) => result.slots.length > 0);
        const morningOnly = /\b(morning|subah|सुबह)\b/i.test(message);
        const matchingSlots = available.flatMap((result) => result.slots
          .filter((slot) => !morningOnly || new Date(slot.starts_at).getUTCHours() < 12));
        context.slots = matchingSlots;
        context.selectedDoctor = null;
        return {
          reply: matchingSlots.length
            ? `These ${specialty} appointments are available for ${date}. Select a time below; I will ask you to confirm before booking.`
            : `I couldn't find an available ${specialty} appointment for ${date}. Would you like to try another date?`,
          doctors: available.map((result) => result.doctor),
          slots: matchingSlots
        };
      }
      return {
        reply: `Based on what you shared, ${specialty} may be a suitable specialty to consult. I can help you look at availability. Which date would you prefer?`,
        doctors,
        slots: []
      };
    }
    if (specialty) {
      return {
        reply: `A ${specialty} specialist may be appropriate for a consultation. This is not a diagnosis or medical advice. Would you like me to find doctors and available times?`,
        doctors: [],
        slots: []
      };
    }
    return {
      reply: `I have a pending appointment with ${context.pendingBooking.doctorName}. Reply “confirm” to book it or “cancel” to discard it.`,
      doctors: [],
      slots: []
    };
  }

  async function getLlmReply(message, history, context) {
    const messages = [...history, { role: 'user', content: message }].slice(-12);
    let response = await client.messages.create({
      model,
      max_tokens: 700,
      system: systemPrompt,
      tools: toolDefinitions,
      messages
    });

    for (let attempt = 0; attempt < 4 && response.stop_reason === 'tool_use'; attempt += 1) {
      const toolBlocks = response.content.filter((block) => block.type === 'tool_use');
      const results = await Promise.all(toolBlocks.map(async (tool) => {
        try {
          return {
            type: 'tool_result',
            tool_use_id: tool.id,
            content: JSON.stringify(await executeTool(tool.name, tool.input, context))
          };
        } catch (error) {
          return {
            type: 'tool_result',
            tool_use_id: tool.id,
            is_error: true,
            content: error.status ? error.message : 'The requested scheduling action could not be completed.'
          };
        }
      }));
      messages.push(
        { role: 'assistant', content: response.content },
        { role: 'user', content: results }
      );
      response = await client.messages.create({
        model,
        max_tokens: 700,
        system: systemPrompt,
        tools: toolDefinitions,
        messages
      });
    }
    return response.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n').trim();
  }

  return {
    async handle({ sessionId, userId, message }) {
      const session = await getSession(sessionId, userId);
      const history = Array.isArray(session.history) ? session.history : [];
      let pendingBooking = session.pending_booking || null;

      if (detectEmergency(message)) {
        pendingBooking = null;
        const nextHistory = [...history, { role: 'user', content: message }, { role: 'assistant', content: emergencyReply }].slice(-12);
        await saveSession({ sessionId, userId, history: nextHistory, pendingBooking });
        return { reply: emergencyReply, emergency: true, doctors: [], slots: [], pendingBooking };
      }

      if (pendingBooking && isCancellation(message)) {
        pendingBooking = null;
        const reply = 'I cancelled the pending request. No appointment was booked. Would you like to look for another time?';
        await saveSession({
          sessionId,
          userId,
          history: [...history, { role: 'user', content: message }, { role: 'assistant', content: reply }],
          pendingBooking
        });
        return { reply, emergency: false, doctors: [], slots: [], pendingBooking };
      }

      if (pendingBooking && isExplicitConfirmation(message)) {
        const appointment = await appointmentService.book({
          userId,
          doctorId: pendingBooking.doctorId,
          slotId: pendingBooking.slotId
        });
        pendingBooking = null;
        const reply = `Your appointment with ${session.pending_booking.doctor_name || session.pending_booking.doctorName} has been booked.`;
        await saveSession({
          sessionId,
          userId,
          history: [...history, { role: 'user', content: message }, { role: 'assistant', content: reply }].slice(-12),
          pendingBooking
        });
        return { reply, emergency: false, doctors: [], slots: [], appointment, pendingBooking };
      }

      const context = { userId, explicitConfirmation: isExplicitConfirmation(message), pendingBooking, appointment: null };
      let reply;
      if (client) {
        reply = await getLlmReply(message, history, context);
      } else {
        const mock = await ruleBasedReply(message, history, context);
        reply = mock.reply;
        context.doctors = mock.doctors;
        context.slots = mock.slots;
      }
      if (!reply) reply = 'I can help you find a suitable specialist and appointment time. What would you like help with?';
      const nextHistory = [...history, { role: 'user', content: message }, { role: 'assistant', content: reply }].slice(-12);
      await saveSession({ sessionId, userId, history: nextHistory, pendingBooking: context.pendingBooking });
      return {
        reply,
        emergency: false,
        doctors: context.doctors || [],
        slots: context.slots || [],
        selectedDoctor: context.selectedDoctor || null,
        pendingBooking: context.pendingBooking,
        appointment: context.appointment
      };
    }
  };
}

module.exports = {
  createChatService,
  isExplicitConfirmation,
  systemPrompt,
  toolDefinitions,
  toolSchemas,
  validateToolInput
};
