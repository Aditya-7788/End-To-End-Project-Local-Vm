const express = require('express');
const { z } = require('zod');

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  (value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
);

function createDoctorsRouter({ doctorService }) {
  const router = express.Router();

  router.get('/', async (req, res, next) => {
    const parsed = z.object({ specialty: z.string().trim().min(2).max(80).optional() }).safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Specialty must be between 2 and 80 characters.' });
    try {
      return res.json({ doctors: await doctorService.list(parsed.data) });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id/slots', async (req, res, next) => {
    const parsed = z.object({ date: dateSchema }).safeParse(req.query);
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success || !parsed.success) {
      return res.status(400).json({ error: 'Provide a valid doctor ID and date in YYYY-MM-DD format.' });
    }
    try {
      const doctor = await doctorService.getDoctor(id.data);
      if (!doctor) return res.status(404).json({ error: 'Doctor not found.' });
      return res.json({ slots: await doctorService.getSlots({ doctorId: id.data, date: parsed.data.date }) });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createDoctorsRouter };
