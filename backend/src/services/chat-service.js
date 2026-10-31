const { GoogleGenAI } = require('@google/genai');
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
    parameters: {
      type: 'OBJECT',
      properties: {
        specialty: { type: 'STRING', description: 'Specialty to search for, such as Neurology.' },
        date: { type: 'STRING', description: 'Optional appointment date in YYYY-MM-DD format.' }
      }
    }
  },
  {
    name: 'get_slots',
    description: 'List available appointment times for a doctor on a date.',
    parameters: {
      type: 'OBJECT',
      properties: {
        doctor_id: { type: 'STRING' },
        date: { type: 'STRING', description: 'Appointment date in YYYY-MM-DD format.' }
      },
      required: ['doctor_id', 'date']
    }
  },
  {
    name: 'book_appointment',
    description: 'Request an appointment. The app will ask the patient to confirm before booking.',
    parameters: {
      type: 'OBJECT',
      properties: {
        doctor_id: { type: 'STRING' },
        slot_id: { type: 'STRING' }
      },
      required: ['doctor_id', 'slot_id']
    }
  }
];

const systemPrompt = `You are CareFlow's appointment scheduling assistant. You are not a doctor.
Reply in the user's language (English, Hindi, or Hinglish). Never diagnose or give treatment or medicine advice.
When symptoms are mentioned, map them to exactly one of General Physician, Cardiology, Dermatology, Neurology, or Pediatrics, then immediately search doctors and slots for the next 7 days unless a date was provided. Never ask whether to search or ask for a date before searching.
Show only doctors and slots returned by the scheduling tools. If a day or time is given, match an available slot and ask for confirmation with the doctor, date, and time.
Never book without explicit confirmation in the latest user message for a pending appointment. Emergency symptoms require an immediate direction to call local emergency services and no appointment search or booking.
Ask at most one short question per reply, only when needed. This service uses fictional demonstration doctors.`;

function isExplicitConfirmation(message) {
  const trimmed = message.trim();
  if (/^(?:हाँ|हां|जी\s*हाँ|जी\s*हां|ठीक\s*है)[.!।]*$/u.test(trimmed)) return true;
  return /^(?:yes|yeah|yep|confirm|confirmed|book it|please book|go ahead|haan|han|haanji|ji haan|kar do|confirm karo)(?:\s*(?:,|and)?\s*(?:please|confirm(?: this appointment)?|book(?: it| this appointment)?|I confirm|go ahead))?\s*[.!।]*$/i.test(trimmed);
}

function isCancellation(message) {
  const trimmed = message.trim();
  if (/^(?:रद्द|नहीं|नही)[.!।]*$/u.test(trimmed)) return true;
  return /^(?:no|nope|cancel|cancel it|cancel this appointment|don't book|do not book|nahi|nahin|mat karo)\s*[.!।]*$/i.test(trimmed);
}

function validateToolInput(name, input) {
  const schema = toolSchemas[name];
  if (!schema) return { success: false, error: 'Unknown assistant tool.' };
  const result = schema.safeParse(input);
  if (!result.success) return { success: false, error: 'Invalid tool input.' };
  return { success: true, data: result.data };
}

function isQuotaError(error) {
  const status = Number(error?.status || error?.statusCode || error?.code || error?.error?.code);
  const code = String(error?.code || error?.status || error?.error?.status || '').toUpperCase();
  return status === 429
    || code === 'RESOURCE_EXHAUSTED'
    || code === 'TOO_MANY_REQUESTS'
    || /quota|resource exhausted|rate.?limit|too many requests/i.test(error?.message || '');
}

function inferSpecialty(message) {
  const text = message.toLowerCase();
  if (/\b(child|children|kid|baby|pediatric|pediatrics|bachch)\b/.test(text)
    || /बच्चे|बच्चा|शिशु/.test(text)) return 'Pediatrics';
  if (/\b(dermatology|dermatologist|skin|rash|acne|itch(?:y|ing)?|khujli|dane)\b/.test(text)
    || /त्वचा|दाने|चकत्ते/.test(text)) return 'Dermatology';
  if (/\b(neurology|neurologist|headache|migraine|head pain|dizziness|dizzy|sar dard|sir dard|numbness|tingling|seizure|tremor|weakness)\b/.test(text)
    || /सिर दर्द|चक्कर|माइग्रेन|सुन्न|झटके|कंपन|कमजोरी/.test(text)) return 'Neurology';
  if (/\b(cardiology|cardiologist|heart|cardiac|palpitation|dil|blood pressure)\b/.test(text)
    || /दिल|धड़कन/.test(text)) return 'Cardiology';
  if (/\b(general physician|general medicine|family medicine|fever|feverish|cough|cold|flu|nausea|vomiting|diarrhea|constipation|sore throat|swelling|swollen|injury|injured|burning|urinary|bukhar|pain|ache|hurt|hurts|sick|ill|unwell|not feeling well|not well|don't feel well|don't feel right|not okay|feel bad|feel off|feel strange|feeling strange|something feels wrong|symptoms?|stomach|body ache|fatigue|tabiyat|theek nahi|thik nahi|bimar)\b/.test(text)
    || /खांसी|बुखार|जुकाम|दर्द|ठीक नहीं|ठीक नहीं लग|बीमार|तबीयत खराब/.test(text)
    || /\b(tabiyat kharab|theek nahi|bimar|bukhar)\b/.test(text)) return 'General Physician';
  return null;
}

function getTodayInIndia(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getPreferredDate(message, now = new Date()) {
  const explicitDate = message.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (explicitDate) return explicitDate[1];
  const today = getTodayInIndia(now);
  if (/\b(today|aaj)\b/i.test(message) || /आज/.test(message)) return today;
  if (/\b(tomorrow|kal|next day)\b/i.test(message) || message.includes('कल')) {
    const tomorrow = new Date(`${today}T00:00:00.000Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    return tomorrow.toISOString().slice(0, 10);
  }

  const weekdays = [
    { pattern: /\bsunday\b/i, hindi: 'रविवार', day: 0 },
    { pattern: /\bmonday\b/i, hindi: 'सोमवार', day: 1 },
    { pattern: /\btuesday\b/i, hindi: 'मंगलवार', day: 2 },
    { pattern: /\bwednesday\b/i, hindi: 'बुधवार', day: 3 },
    { pattern: /\bthursday\b/i, hindi: 'गुरुवार', day: 4 },
    { pattern: /\bfriday\b/i, hindi: 'शुक्रवार', day: 5 },
    { pattern: /\bsaturday\b/i, hindi: 'शनिवार', day: 6 }
  ];
  const weekday = weekdays.find(({ pattern, hindi }) => pattern.test(message) || message.includes(hindi));
  if (weekday) {
    const todayDate = new Date(`${today}T00:00:00.000Z`);
    const daysAhead = (weekday.day - todayDate.getUTCDay() + 7) % 7 || 7;
    todayDate.setUTCDate(todayDate.getUTCDate() + daysAhead);
    return todayDate.toISOString().slice(0, 10);
  }
  return null;
}

function getPreferredTime(message) {
  const clock = message.match(/\b(?:at\s*)?([01]?\d|2[0-3]):([0-5]\d)\s*(am|pm)?\b/i);
  const amPm = message.match(/\b([1-9]|1[0-2])\s*(am|pm)\b/i);
  const spoken = message.match(/\b([01]?\d|2[0-3])\s*(?:baje|bajey|o'clock)\b/i);
  const atHour = message.match(/\bat\s*([01]?\d|2[0-3])\b/i);
  const match = clock || amPm || spoken || atHour;
  if (match) {
    let hour = Number(match[1]);
    const minute = clock ? Number(clock[2]) : 0;
    const meridiem = (clock?.[3] || amPm?.[2] || '').toLowerCase();
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    return (date) => date.hour === hour && date.minute === minute;
  }
  if (/\b(morning|subah)\b/i.test(message) || /सुबह/.test(message)) {
    return (date) => date.hour >= 6 && date.hour < 12;
  }
  if (/\b(afternoon|dopahar)\b/i.test(message) || /दोपहर/.test(message)) {
    return (date) => date.hour >= 12 && date.hour < 17;
  }
  if (/\b(evening|shaam|night)\b/i.test(message) || /शाम|रात/.test(message)) {
    return (date) => date.hour >= 17;
  }
  return null;
}

function getIndiaSlotTime(value) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return { hour: Number(values.hour), minute: Number(values.minute) };
}

function formatAppointmentTime(value) {
  const formatted = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
  return `${formatted} IST`;
}

function getReplyLanguage(message) {
  if (/[\u0900-\u097f]/.test(message)) return 'hi';
  if (/\b(mujhe|mujh|mera|meri|mere|hai|hoon|hun|nahi|nahin|kal|bukhar|dard|sar|chahiye|haan|subah|baje|bachcha|theek|sahi|tabiyat)\b/i.test(message)) {
    return 'hinglish';
  }
  return 'en';
}

function getSchedulingLanguage(message, history) {
  const isUiSelection = /^I would like to select slot [0-9a-f-]{36} with doctor [0-9a-f-]{36}\.$/i.test(message.trim());
  if (isUiSelection) {
    const previousMessage = [...history].reverse().find((item) => item.role === 'user');
    if (previousMessage) return getReplyLanguage(previousMessage.content);
  }
  return getReplyLanguage(message);
}

function getConfirmationReply(language, doctorName, specialty, startsAt) {
  const appointmentTime = formatAppointmentTime(startsAt);
  if (language === 'hi') return `कृपया पुष्टि करें: ${doctorName} (${specialty}), ${appointmentTime}।`;
  if (language === 'hinglish') return `Confirm karein: ${doctorName} (${specialty}), ${appointmentTime}.`;
  return `Please confirm: ${doctorName} (${specialty}), ${appointmentTime}.`;
}

function getEmergencyReply(message) {
  if (/[\u0900-\u097f]/.test(message)) {
    return 'यह आपातकाल हो सकता है। कृपया तुरंत स्थानीय आपातकालीन सेवाओं को कॉल करें। अपॉइंटमेंट का इंतज़ार न करें।';
  }
  if (/\b(saans|seene|chhaati|khoon|munh|kamzori)\b/i.test(message)) {
    return 'Yeh emergency ho sakti hai. Abhi local emergency services ko call karein; appointment ka intezar na karein.';
  }
  return emergencyReply;
}

function createChatService({
  pool,
  doctorService,
  appointmentService,
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.LLM_MODEL,
  geminiClient
}) {
  const client = geminiClient || (apiKey ? new GoogleGenAI({ apiKey }) : null);

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
      clinic: selected.clinic,
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
    const selection = message.match(/slot\s+([0-9a-f-]{36}).*doctor\s+([0-9a-f-]{36})/i);
    if (selection) {
      try {
        const selected = await appointmentService.validateSelection({ slotId: selection[1], doctorId: selection[2] });
        context.pendingBooking = {
          doctorId: selection[2],
          slotId: selection[1],
          doctorName: selected.doctor_name,
          clinic: selected.clinic,
          specialty: selected.specialty,
          startsAt: selected.starts_at,
          language: getSchedulingLanguage(message, history)
        };
        return {
          handled: true,
          reply: getConfirmationReply(context.pendingBooking.language, selected.doctor_name, selected.specialty, selected.starts_at),
          doctors: [{
            id: selected.doctor_id,
            name: selected.doctor_name,
            specialty: selected.specialty,
            clinic: selected.clinic
          }],
          slots: []
        };
      } catch (error) {
        if (error.status === 409) {
          return {
            handled: true,
            reply: 'That appointment time is no longer available. I can help you find another slot.',
            doctors: [],
            slots: []
          };
        }
        throw error;
      }
    }

    const userHistory = history.filter((item) => item.role === 'user').map((item) => item.content);
    const currentDate = getPreferredDate(message);
    const timePreference = getPreferredTime(message);
    const schedulingFollowUp = Boolean(
      currentDate
      || timePreference
      || /\b(doctor|appointment|book|slot|available|availability|specialist|another time)\b/i.test(message)
    );
    const currentSpecialty = inferSpecialty(message);
    const specialty = currentSpecialty
      || (schedulingFollowUp
        ? [...userHistory].reverse().map(inferSpecialty).find(Boolean)
        : null);

    if (!specialty && context.pendingBooking) {
      const language = getReplyLanguage(message);
      return {
        handled: true,
        reply: language === 'hi'
          ? `${context.pendingBooking.doctorName} के साथ एक अपॉइंटमेंट पुष्टि के लिए बाकी है। कृपया पुष्टि करें या दूसरा समय चुनें।`
          : language === 'hinglish'
            ? `${context.pendingBooking.doctorName} ke saath appointment confirmation ke liye pending hai. Confirm karein ya doosra time chunein.`
            : `I have a pending appointment with ${context.pendingBooking.doctorName}. Please confirm it or choose another time.`,
        doctors: [],
        slots: []
      };
    }
    if (!specialty) {
      const language = getReplyLanguage(message);
      return {
        handled: false,
        reply: language === 'hi'
          ? 'आप किस लक्षण या विशेषज्ञता के लिए अपॉइंटमेंट ढूंढना चाहेंगे?'
          : language === 'hinglish'
            ? 'Aap kis symptom ya specialty ke liye appointment dhoondh rahe hain?'
            : 'What symptoms or specialty would you like help with?',
        doctors: [],
        slots: []
      };
    }

    const historyDate = currentSpecialty ? null : getPreferredDate(userHistory.join(' '));
    const date = currentDate || historyDate || getTodayInIndia();
    const isDateSpecified = Boolean(currentDate || historyDate);
    const days = isDateSpecified ? 1 : 7;
    const doctors = await doctorService.search({ specialty });
    const candidates = await Promise.all(doctors.slice(0, 2).map(async (doctor) => ({
      doctor,
      slots: await doctorService.getUpcomingSlots({
        doctorId: doctor.id,
        startDate: date,
        days
      })
    })));
    const available = candidates.filter((candidate) => candidate.slots.length > 0);
    const allSlots = available
      .flatMap(({ slots: doctorSlots }) => doctorSlots)
      .sort((left, right) => new Date(left.starts_at) - new Date(right.starts_at));
    const slots = allSlots.slice(0, 5);
    context.doctors = available.map(({ doctor }) => doctor);
    context.slots = slots;

    const requestedSpecificTime = Boolean(currentDate || timePreference);
    if (requestedSpecificTime) {
      const matchingSlot = allSlots.find((slot) => !timePreference || timePreference(getIndiaSlotTime(slot.starts_at)));
      if (matchingSlot) {
        context.pendingBooking = {
          doctorId: matchingSlot.doctor_id,
          slotId: matchingSlot.id,
          doctorName: matchingSlot.doctor_name,
          clinic: matchingSlot.clinic,
          specialty: matchingSlot.specialty,
          startsAt: matchingSlot.starts_at,
          language: getReplyLanguage(message)
        };
        context.doctors = available
          .filter(({ doctor }) => doctor.id === matchingSlot.doctor_id)
          .map(({ doctor }) => doctor);
        context.slots = [matchingSlot];
        return {
          handled: true,
          reply: getConfirmationReply(
            context.pendingBooking.language,
            matchingSlot.doctor_name,
            specialty,
            matchingSlot.starts_at
          ),
          doctors: context.doctors,
          slots: context.slots
        };
      }
    }

    const language = getReplyLanguage(message);
    const vaguePain = /\b(pain|ache)\b/i.test(message)
      && !/\b(stomach|back|body|head|chest|joint|tooth|ear|throat)\b/i.test(message);
    const needsClarification = /\b(not feeling well|not well|feel unwell|feeling sick|something wrong|something feels wrong|don't feel right|don't feel well|feel bad|feel off|feel strange|not okay|theek nahi|thik nahi|tabiyat kharab|tabiyat sahi nahi)\b/i.test(message)
      || /ठीक नहीं|अस्वस्थ/.test(message)
      || vaguePain
      || (/\bdard\b/i.test(message) && !/\b(sar|pet|kamar|gala|daant)\b/i.test(message))
      || (/दर्द/.test(message) && !/सिर|पेट|पीठ|शरीर|गला|दांत/.test(message));
    const availabilityWindow = isDateSpecified
      ? date
      : language === 'hi'
        ? 'अगले 7 दिनों'
        : language === 'hinglish'
          ? 'agle 7 din'
          : 'the next 7 days';
    const reply = needsClarification
      ? language === 'hi'
        ? `General Physician से शुरुआत करना उचित रहेगा। आपको कौन-से लक्षण हैं? मैंने ${availabilityWindow} के लिए उपलब्ध समय देखे हैं।`
        : language === 'hinglish'
          ? `General Physician se shuru karna sahi rahega. Aapko kya symptoms hain? Maine ${availabilityWindow} ke slots dekh liye hain.`
          : `A General Physician is a suitable starting point. What symptoms are you experiencing? I searched availability for ${availabilityWindow}.`
      : slots.length
        ? language === 'hi'
          ? `${specialty} आपके लिए उपयुक्त विशेषज्ञता है। ${availabilityWindow} के उपलब्ध अपॉइंटमेंट ये हैं।`
          : language === 'hinglish'
            ? `${specialty} aapke liye sahi specialty hai. ${availabilityWindow} ke available appointments yeh hain.`
            : `A ${specialty} is the suitable specialty to consult. Here are upcoming appointments for ${availabilityWindow}.`
        : language === 'hi'
          ? `${specialty} उपयुक्त विशेषज्ञता है, लेकिन ${availabilityWindow} के लिए कोई समय उपलब्ध नहीं मिला।`
          : language === 'hinglish'
            ? `${specialty} sahi specialty hai, lekin ${availabilityWindow} mein koi available slot nahi mila.`
            : `A ${specialty} is the suitable specialty to consult, but I couldn't find available appointments for ${availabilityWindow}.`;
    return {
      handled: true,
      reply,
      doctors: context.doctors,
      slots
    };
  }

  async function getLlmReply(message, history, context) {
    const contents = [...history, { role: 'user', content: message }]
      .slice(-12)
      .map((item) => ({
        role: item.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: item.content }]
      }));
    const config = {
      maxOutputTokens: 700,
      systemInstruction: systemPrompt,
      tools: [{ functionDeclarations: toolDefinitions }]
    };
    let response = await client.models.generateContent({
      model,
      contents,
      config
    });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const modelContent = response.candidates?.[0]?.content;
      const functionCalls = modelContent?.parts?.filter((part) => part.functionCall).map((part) => part.functionCall) || [];
      if (functionCalls.length === 0) break;
      contents.push(modelContent);
      const functionResponses = [];
      for (const call of functionCalls) {
        try {
          functionResponses.push({
            functionResponse: {
              name: call.name,
              response: await executeTool(call.name, call.args, context)
            }
          });
        } catch (error) {
          functionResponses.push({
            functionResponse: {
              name: call.name,
              response: {
                error: error.status ? error.message : 'The requested scheduling action could not be completed.'
              }
            }
          });
        }
      }
      contents.push({ role: 'user', parts: functionResponses });
      response = await client.models.generateContent({
        model,
        contents,
        config
      });
    }
    return response.candidates?.[0]?.content?.parts
      ?.filter((part) => part.text)
      .map((part) => part.text)
      .join('\n')
      .trim() || '';
  }

  return {
    async handle({ sessionId, userId, message }) {
      const session = await getSession(sessionId, userId);
      const history = Array.isArray(session.history) ? session.history : [];
      let pendingBooking = session.pending_booking || null;

      if (detectEmergency(message)) {
        pendingBooking = null;
        const reply = getEmergencyReply(message);
        const nextHistory = [...history, { role: 'user', content: message }, { role: 'assistant', content: reply }].slice(-12);
        await saveSession({ sessionId, userId, history: nextHistory, pendingBooking });
        return { reply, emergency: true, doctors: [], slots: [], pendingBooking };
      }

      if (pendingBooking && isCancellation(message)) {
        pendingBooking = null;
        const language = getReplyLanguage(message) === 'en'
          ? session.pending_booking?.language || 'en'
          : getReplyLanguage(message);
        const reply = language === 'hi'
          ? 'पुष्टि लंबित अपॉइंटमेंट रद्द कर दिया गया है। कोई बुकिंग नहीं हुई। क्या आप दूसरा समय देखना चाहेंगे?'
          : language === 'hinglish'
            ? 'Pending appointment cancel kar diya hai. Booking nahi hui. Kya aap doosra time dekhna chahenge?'
            : 'I cancelled the pending request. No appointment was booked. Would you like to look for another time?';
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
        const doctorName = pendingBooking.doctorName || pendingBooking.doctor_name;
        const appointmentTime = formatAppointmentTime(pendingBooking.startsAt || pendingBooking.starts_at);
        const language = getReplyLanguage(message) === 'en'
          ? pendingBooking.language || 'en'
          : getReplyLanguage(message);
        const reply = language === 'hi'
          ? `बुक हो गया: ${doctorName}, ${appointmentTime}।`
          : language === 'hinglish'
            ? `Appointment book ho gaya: ${doctorName}, ${appointmentTime}.`
            : `Booked: ${doctorName}, ${appointmentTime}.`;
        pendingBooking = null;
        await saveSession({
          sessionId,
          userId,
          history: [...history, { role: 'user', content: message }, { role: 'assistant', content: reply }].slice(-12),
          pendingBooking
        });
        return { reply, emergency: false, doctors: [], slots: [], appointment, pendingBooking };
      }

      if (!pendingBooking && isExplicitConfirmation(message)) {
        const language = getReplyLanguage(message);
        const reply = language === 'hi'
          ? 'पुष्टि के लिए कोई अपॉइंटमेंट लंबित नहीं है। पहले उपलब्ध समय चुनें।'
          : language === 'hinglish'
            ? 'Confirmation ke liye koi appointment pending nahi hai. Pehle available slot chunein.'
            : 'There is no appointment waiting for confirmation. Please choose an available slot first.';
        await saveSession({
          sessionId,
          userId,
          history: [...history, { role: 'user', content: message }, { role: 'assistant', content: reply }].slice(-12),
          pendingBooking
        });
        return { reply, emergency: false, doctors: [], slots: [], pendingBooking };
      }

      const context = { userId, explicitConfirmation: isExplicitConfirmation(message), pendingBooking, appointment: null };
      const workflow = await ruleBasedReply(message, history, context);
      let reply = workflow.reply;
      context.doctors = workflow.doctors;
      context.slots = workflow.slots;
      if (!workflow.handled && client) {
        try {
          reply = await getLlmReply(message, history, context);
        } catch (error) {
          if (!isQuotaError(error)) throw error;
          reply = 'The AI assistant has reached its current usage limit. Please try again later.';
        }
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
  validateToolInput,
  isQuotaError
};
