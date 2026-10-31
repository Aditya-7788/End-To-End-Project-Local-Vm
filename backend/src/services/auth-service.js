const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('node:crypto');

function createAuthService(pool, { jwtSecret, tokenExpiresIn = '12h' }) {
  return {
    async register({ email, password }) {
      const passwordHash = await bcrypt.hash(password, 12);
      const id = randomUUID();
      try {
        const { rows } = await pool.query(
          'INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3) RETURNING id, email',
          [id, email.toLowerCase(), passwordHash]
        );
        return { user: rows[0], token: jwt.sign({ sub: id }, jwtSecret, { expiresIn: tokenExpiresIn }) };
      } catch (error) {
        if (error.code === '23505') {
          const conflict = new Error('An account with this email already exists.');
          conflict.status = 409;
          throw conflict;
        }
        throw error;
      }
    },

    async login({ email, password }) {
      const { rows } = await pool.query(
        'SELECT id, email, password_hash FROM users WHERE lower(email) = lower($1)',
        [email]
      );
      const user = rows[0];
      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        const unauthorized = new Error('Email or password is incorrect.');
        unauthorized.status = 401;
        throw unauthorized;
      }
      return {
        user: { id: user.id, email: user.email },
        token: jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: tokenExpiresIn })
      };
    }
  };
}

module.exports = { createAuthService };
