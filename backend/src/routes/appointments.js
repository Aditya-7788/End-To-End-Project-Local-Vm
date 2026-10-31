const express = require('express');
const { z } = require('zod');

function createAppointmentsRouter({ appointmentService, authMiddleware }) {
  const router = express.Router();
  router.use(authMiddleware);

  router.post('/', async (req, res, next) => {
    const parsed = z.object({
      doctorId: z.string().uuid(),
      slotId: z.string().uuid(),
      confirmed: z.literal(true)
    }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'A valid doctor, slot, and explicit confirmation are required.' });
    try {
      const appointment = await appointmentService.book({
        userId: req.user.id,
        doctorId: parsed.data.doctorId,
        slotId: parsed.data.slotId
      });
      return res.status(201).json({ appointment });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/me', async (req, res, next) => {
    try {
      return res.json({ appointments: await appointmentService.listForUser(req.user.id) });
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    const parsed = z.string().uuid().safeParse(req.params.id);
    if (!parsed.success) return res.status(400).json({ error: 'Provide a valid appointment ID.' });
    try {
      const cancelled = await appointmentService.cancel({ userId: req.user.id, appointmentId: parsed.data });
      if (!cancelled) return res.status(404).json({ error: 'Appointment not found.' });
      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createAppointmentsRouter };
