const express = require('express');
const { z } = require('zod');

function createChatRouter({ chatService, authMiddleware, chatLimiter }) {
  const router = express.Router();
  router.use(authMiddleware, chatLimiter);
  router.post('/', async (req, res, next) => {
    const parsed = z.object({
      sessionId: z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/),
      message: z.string().trim().min(1).max(2000)
    }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Provide a valid session ID and a message up to 2000 characters.' });
    try {
      return res.json(await chatService.handle({
        ...parsed.data,
        userId: req.user.id
      }));
    } catch (error) {
      return next(error);
    }
  });
  return router;
}

module.exports = { createChatRouter };
