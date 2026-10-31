const express = require('express');
const { z } = require('zod');

const credentialsSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(128)
}).strict();

function createAuthRouter({ authService, authLimiter }) {
  const router = express.Router();
  router.use(authLimiter);

  router.post('/register', async (req, res, next) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Provide a valid email and a password of 10 to 128 characters.' });
    try {
      return res.status(201).json(await authService.register(parsed.data));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/login', async (req, res, next) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Provide a valid email and password.' });
    try {
      return res.json(await authService.login(parsed.data));
    } catch (error) {
      return next(error);
    }
  });
  return router;
}

module.exports = { createAuthRouter };
