const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { randomUUID } = require('node:crypto');
const { createAuthMiddleware } = require('./middleware/auth');
const { errorHandler } = require('./middleware/error-handler');
const { registry, bookingResults, requestMetrics } = require('./middleware/metrics');
const { createHealthController } = require('./controllers/health');
const { createAuthService } = require('./services/auth-service');
const { createDoctorService } = require('./services/doctor-service');
const { createAppointmentService } = require('./services/appointment-service');
const { createChatService } = require('./services/chat-service');
const { createAuthRouter } = require('./routes/auth');
const { createDoctorsRouter } = require('./routes/doctors');
const { createAppointmentsRouter } = require('./routes/appointments');
const { createChatRouter } = require('./routes/chat');

function createApp({
  pool,
  jwtSecret = process.env.JWT_SECRET,
  corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173',
  geminiClient,
  chatService: injectedChatService,
  geminiApiKey,
  model
}) {
  if (!pool) throw new Error('A database pool is required.');
  if (!jwtSecret || jwtSecret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters.');

  const app = express();
  const authMiddleware = createAuthMiddleware(jwtSecret);
  const authService = createAuthService(pool, { jwtSecret });
  const doctorService = createDoctorService(pool);
  const appointmentService = createAppointmentService(pool, bookingResults);
  const chatService = injectedChatService || createChatService({
    pool,
    doctorService,
    appointmentService,
    geminiClient,
    apiKey: geminiApiKey,
    model
  });
  const healthController = createHealthController(pool);
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Try again later.' }
  });
  const chatLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 15,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many chat requests. Please wait a moment.' }
  });

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: corsOrigin.split(',').map((origin) => origin.trim()), credentials: false }));
  app.use((req, res, next) => {
    req.id = randomUUID();
    const started = Date.now();
    res.on('finish', () => {
      const payload = JSON.stringify({
        level: res.statusCode >= 500 ? 'error' : 'info',
        requestId: req.id,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - started
      });
      (res.statusCode >= 500 ? console.error : console.log)(payload);
    });
    req.log = {
      error: (data, message) => console.error(JSON.stringify({ level: 'error', requestId: req.id, message, error: data.err?.message }))
    };
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.use(requestMetrics);

  app.get('/health', healthController.live);
  app.get('/ready', healthController.ready);
  app.get('/metrics', async (req, res, next) => {
    try {
      res.set('Content-Type', registry.contentType);
      return res.end(await registry.metrics());
    } catch (error) {
      return next(error);
    }
  });

  app.use('/api/auth', createAuthRouter({ authService, authLimiter }));
  app.use('/api/doctors', createDoctorsRouter({ doctorService }));
  app.use('/api/appointments', createAppointmentsRouter({ appointmentService, authMiddleware }));
  app.use('/api/chat', createChatRouter({ chatService, authMiddleware, chatLimiter }));
  app.use((req, res) => res.status(404).json({ error: 'Route not found.' }));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
