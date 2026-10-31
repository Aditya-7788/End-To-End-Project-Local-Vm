const client = require('prom-client');

const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

const httpRequests = new client.Counter({
  name: 'careflow_http_requests_total',
  help: 'Total number of HTTP requests.',
  labelNames: ['method', 'route', 'status'],
  registers: [registry]
});

const httpDuration = new client.Histogram({
  name: 'careflow_http_request_duration_seconds',
  help: 'HTTP request duration in seconds.',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry]
});

const bookingResults = new client.Counter({
  name: 'careflow_booking_results_total',
  help: 'Successful and failed appointment booking attempts.',
  labelNames: ['result'],
  registers: [registry]
});

function requestMetrics(req, res, next) {
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    const labels = {
      method: req.method,
      route: req.route?.path || req.path,
      status: String(res.statusCode)
    };
    httpRequests.inc(labels);
    end(labels);
  });
  next();
}

module.exports = { registry, bookingResults, requestMetrics };
