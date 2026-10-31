const jwt = require('jsonwebtoken');

function createAuthMiddleware(secret) {
  return function authenticate(req, res, next) {
    const header = req.get('authorization') || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    try {
      const payload = jwt.verify(token, secret);
      if (typeof payload.sub !== 'string') {
        return res.status(401).json({ error: 'Invalid authentication token.' });
      }
      req.user = { id: payload.sub };
      return next();
    } catch (error) {
      return res.status(401).json({ error: 'Invalid or expired authentication token.' });
    }
  };
}

module.exports = { createAuthMiddleware };
