import rateLimit from 'express-rate-limit';
import { Request } from 'express';
import { getClientIp } from '../utils/ipHelper';

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again later.' },
});

export const claimLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const ip = getClientIp(req);
    // Key by IP address and giveaway slug so rate-limiting and attempts are scoped per giveaway
    const slug = req.params?.slug || (req.body && req.body.slug) || 'global';
    return `${ip}:${slug}`;
  },
  message: { error: 'Too many claim attempts for this giveaway from your network. Please try again in 15 minutes.' },
});

