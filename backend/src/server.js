const { createApp } = require('./app');
const { initializeDatabase } = require('./db/initialize');
const { loadConfig } = require('./config');

let pool;
async function start() {
  const config = loadConfig();
  ({ pool } = require('./db/pool'));
  const port = config.PORT;
  await initializeDatabase(pool);
  const app = createApp({
    pool,
    jwtSecret: config.JWT_SECRET,
    corsOrigin: config.CORS_ORIGIN,
    apiKey: config.ANTHROPIC_API_KEY,
    model: config.LLM_MODEL
  });
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(JSON.stringify({ level: 'info', message: 'CareFlow API listening', port }));
  });

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(JSON.stringify({ level: 'info', message: 'Graceful shutdown started', signal }));
    const timeout = setTimeout(() => {
      console.error(JSON.stringify({ level: 'error', message: 'Graceful shutdown timed out' }));
      process.exit(1);
    }, 10000);
    timeout.unref();
    server.close(async (error) => {
      if (error) {
        console.error(JSON.stringify({ level: 'error', message: 'HTTP server close failed', error: error.message }));
        process.exitCode = 1;
      }
      try {
        await pool.end();
      } catch (poolError) {
        console.error(JSON.stringify({ level: 'error', message: 'Database pool close failed', error: poolError.message }));
        process.exitCode = 1;
      }
      clearTimeout(timeout);
    });
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  return server;
}

start().catch(async (error) => {
  console.error(JSON.stringify({ level: 'error', message: 'Application startup failed', error: error.message }));
  process.exitCode = 1;
  if (!pool) return;
  try {
    await pool.end();
  } catch (closeError) {
    console.error(JSON.stringify({ level: 'error', message: 'Database cleanup failed', error: closeError.message }));
  }
});
