const { randomUUID } = require('node:crypto');

function createAppointmentService(pool, bookingMetrics = { inc: () => {} }) {
  return {
    async validateSelection({ doctorId, slotId }) {
      const { rows } = await pool.query(
        `SELECT s.id AS slot_id, s.starts_at, d.id AS doctor_id, d.name AS doctor_name, d.specialty, d.clinic
         FROM slots s
         JOIN doctors d ON d.id = s.doctor_id
         WHERE s.id = $1 AND s.doctor_id = $2 AND s.available = TRUE`,
        [slotId, doctorId]
      );
      if (!rows[0]) {
        const unavailable = new Error('That appointment slot is not available.');
        unavailable.status = 409;
        throw unavailable;
      }
      return rows[0];
    },

    async book({ userId, doctorId, slotId }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: slots } = await client.query(
          `SELECT id FROM slots
           WHERE id = $1 AND doctor_id = $2 AND available = TRUE
           FOR UPDATE`,
          [slotId, doctorId]
        );
        if (!slots[0]) {
          const unavailable = new Error('That appointment slot is no longer available.');
          unavailable.status = 409;
          throw unavailable;
        }

        const id = randomUUID();
        const { rows } = await client.query(
          'INSERT INTO appointments (id, user_id, slot_id) VALUES ($1, $2, $3) RETURNING id, user_id, slot_id, created_at',
          [id, userId, slotId]
        );
        await client.query('UPDATE slots SET available = FALSE WHERE id = $1', [slotId]);
        await client.query('COMMIT');
        bookingMetrics.inc({ result: 'success' });
        return rows[0];
      } catch (error) {
        await client.query('ROLLBACK');
        bookingMetrics.inc({ result: 'failure' });
        if (error.code === '23505') {
          const conflict = new Error('That appointment slot has already been booked.');
          conflict.status = 409;
          throw conflict;
        }
        throw error;
      } finally {
        client.release();
      }
    },

    async listForUser(userId) {
      const { rows } = await pool.query(
        `SELECT a.id, a.created_at, s.id AS slot_id, s.starts_at,
                d.id AS doctor_id, d.name AS doctor_name, d.specialty, d.clinic
         FROM appointments a
         JOIN slots s ON s.id = a.slot_id
         JOIN doctors d ON d.id = s.doctor_id
         WHERE a.user_id = $1
         ORDER BY s.starts_at`,
        [userId]
      );
      return rows;
    },

    async cancel({ userId, appointmentId }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `DELETE FROM appointments
           WHERE id = $1 AND user_id = $2
           RETURNING slot_id`,
          [appointmentId, userId]
        );
        if (!rows[0]) {
          await client.query('ROLLBACK');
          return false;
        }
        await client.query('UPDATE slots SET available = TRUE WHERE id = $1', [rows[0].slot_id]);
        await client.query('COMMIT');
        return true;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

module.exports = { createAppointmentService };
