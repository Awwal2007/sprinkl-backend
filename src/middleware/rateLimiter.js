const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // max 20 login/signup requests per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again later.' },
});

const claimLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // max 10 claims per IP per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many claim attempts from this IP address. Please try again later.' },
});

module.exports = { authLimiter, claimLimiter };
