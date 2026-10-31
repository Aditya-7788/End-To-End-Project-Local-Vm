const { randomUUID } = require('node:crypto');

const doctors = [
  ['Dr. Asha Mehta', 'General Physician', 'CareFlow Family Clinic', 'Primary care and general health consultations.'],
  ['Dr. Kabir Shah', 'General Physician', 'CareFlow Family Clinic', 'Family medicine and preventive care.'],
  ['Dr. Neha Kulkarni', 'Cardiology', 'Heartwise Clinic', 'Cardiology consultations and heart health follow-up.'],
  ['Dr. Arjun Rao', 'Cardiology', 'Heartwise Clinic', 'Adult cardiology and routine cardiac reviews.'],
  ['Dr. Isha Verma', 'Neurology', 'Mind & Nerve Clinic', 'Neurology consultations and headache assessment.'],
  ['Dr. Rohan Das', 'Neurology', 'Mind & Nerve Clinic', 'Neurology and follow-up appointments.'],
  ['Dr. Meera Nair', 'Dermatology', 'Clear Skin Clinic', 'General dermatology consultations.'],
  ['Dr. Vivaan Joshi', 'Dermatology', 'Clear Skin Clinic', 'Skin health and dermatology follow-up.'],
  ['Dr. Sana Khan', 'Pediatrics', 'Little Steps Clinic', 'Pediatric consultations for children.'],
  ['Dr. Dev Patel', 'Pediatrics', 'Little Steps Clinic', 'Child health and routine pediatric care.']
];

async function seedDoctorsAndSlots(pool, now = new Date()) {
  const doctorValues = [];
  const doctorRows = doctors.map((doctor) => {
    const offset = doctorValues.length;
    doctorValues.push(randomUUID(), ...doctor);
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`;
  });
  await pool.query(
    `INSERT INTO doctors (id, name, specialty, clinic, bio)
     VALUES ${doctorRows.join(', ')}
     ON CONFLICT (name) DO NOTHING`,
    doctorValues
  );

  const { rows } = await pool.query('SELECT id FROM doctors ORDER BY name');
  const slotValues = [];
  const slotRows = [];
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const localDate = Object.fromEntries(dateParts.map(({ type, value }) => [type, value]));
  const firstDay = new Date(`${localDate.year}-${localDate.month}-${localDate.day}T00:00:00.000Z`);
  for (const doctor of rows) {
    for (let day = 0; day < 7; day += 1) {
      for (const hour of [9, 10, 11, 14, 15, 16]) {
        const clinicDate = new Date(firstDay);
        clinicDate.setUTCDate(clinicDate.getUTCDate() + day);
        const startsAt = new Date(Date.UTC(
          clinicDate.getUTCFullYear(),
          clinicDate.getUTCMonth(),
          clinicDate.getUTCDate(),
          hour
        ) - 330 * 60 * 1000);
        const offset = slotValues.length;
        slotValues.push(randomUUID(), doctor.id, startsAt.toISOString());
        slotRows.push(`($${offset + 1}, $${offset + 2}, $${offset + 3})`);
      }
    }
  }
  await pool.query(
    `INSERT INTO slots (id, doctor_id, starts_at)
     VALUES ${slotRows.join(', ')}
     ON CONFLICT (doctor_id, starts_at) DO NOTHING`,
    slotValues
  );
}

module.exports = { seedDoctorsAndSlots };
