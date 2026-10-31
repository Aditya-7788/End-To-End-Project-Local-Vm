function createDoctorService(pool) {
  return {
    async search({ specialty, date }) {
      const values = [];
      const filters = [];
      if (specialty) {
        values.push(`%${specialty}%`);
        filters.push(`specialty ILIKE $${values.length}`);
      }
      let query = 'SELECT id, name, specialty, clinic, bio FROM doctors';
      if (filters.length) query += ` WHERE ${filters.join(' AND ')}`;
      query += ' ORDER BY specialty, name LIMIT 20';
      const { rows } = await pool.query(query, values);
      if (!date) return rows;
      const slots = await this.getSlots({ doctorId: null, date });
      const slotDoctors = new Set(slots.map((slot) => slot.doctor_id));
      return rows.filter((doctor) => slotDoctors.has(doctor.id));
    },

    async list({ specialty }) {
      const { rows } = await pool.query(
        `SELECT id, name, specialty, clinic, bio
         FROM doctors
         WHERE ($1::text IS NULL OR specialty ILIKE $2)
         ORDER BY specialty, name`,
        [specialty || null, specialty ? `%${specialty}%` : null]
      );
      return rows;
    },

    async getSlots({ doctorId, date }) {
      const start = new Date(`${date}T00:00:00.000Z`);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      const { rows } = await pool.query(
        `SELECT s.id, s.doctor_id, s.starts_at
         FROM slots s
         WHERE s.available = TRUE
           AND ($1::uuid IS NULL OR s.doctor_id = $1)
           AND s.starts_at >= $2::timestamptz
           AND s.starts_at < $3::timestamptz
         ORDER BY s.starts_at
         LIMIT 100`,
        [doctorId || null, start.toISOString(), end.toISOString()]
      );
      return rows;
    },

    async getUpcomingSlots({ doctorId, startDate, days = 7, now = new Date() }) {
      const start = new Date(`${startDate}T00:00:00.000Z`);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + days);
      const from = new Date(Math.max(start.getTime(), now.getTime()));
      const { rows } = await pool.query(
        `SELECT s.id, s.doctor_id, s.starts_at, d.name AS doctor_name, d.clinic, d.specialty
         FROM slots s
         JOIN doctors d ON d.id = s.doctor_id
         WHERE s.available = TRUE
           AND ($1::uuid IS NULL OR s.doctor_id = $1)
           AND s.starts_at >= $2::timestamptz
           AND s.starts_at < $3::timestamptz
         ORDER BY s.starts_at
         LIMIT 100`,
        [doctorId || null, from.toISOString(), end.toISOString()]
      );
      return rows;
    },

    async getDoctor(doctorId) {
      const { rows } = await pool.query(
        'SELECT id, name, specialty, clinic, bio FROM doctors WHERE id = $1',
        [doctorId]
      );
      return rows[0] || null;
    }
  };
}

module.exports = { createDoctorService };
