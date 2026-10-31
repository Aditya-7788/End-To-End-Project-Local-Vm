function createHealthController(pool) {
  return {
    live(req, res) {
      return res.json({ status: 'ok' });
    },

    async ready(req, res) {
      try {
        await pool.query('SELECT 1');
        return res.json({ status: 'ready' });
      } catch (error) {
        req.log.error({ err: error }, 'Readiness database check failed');
        return res.status(503).json({ status: 'not_ready' });
      }
    }
  };
}

module.exports = { createHealthController };
