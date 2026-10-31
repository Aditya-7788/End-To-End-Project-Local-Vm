function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  req.log.error({ err: error, path: req.path }, 'Request failed');
  const status = Number.isInteger(error.status) ? error.status : 500;
  const message = status >= 500 ? 'An unexpected server error occurred.' : error.message;
  return res.status(status).json({ error: message });
}

module.exports = { errorHandler };
