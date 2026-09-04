import { Request } from 'express';

/**
 * Extracts normalized client IP address considering proxy headers
 * (Cloudflare, reverse proxies like Nginx/Caddy, x-forwarded-for)
 * and strips IPv6-mapped IPv4 prefix if present.
 */
export const getClientIp = (req: Request | any): string => {
  if (!req) return '';

  let ip = '';
  const headers = req.headers || {};
  const forwarded = headers['x-forwarded-for'];

  if (typeof forwarded === 'string') {
    ip = forwarded.split(',')[0].trim();
  } else if (Array.isArray(forwarded) && forwarded.length > 0) {
    ip = String(forwarded[0]).trim();
  } else if (typeof headers['cf-connecting-ip'] === 'string') {
    ip = headers['cf-connecting-ip'].trim();
  } else if (typeof headers['x-real-ip'] === 'string') {
    ip = headers['x-real-ip'].trim();
  } else {
    ip = req.ip || req.socket?.remoteAddress || '';
  }

  // Strip IPv6-mapped IPv4 prefix if present (::ffff:1.2.3.4 -> 1.2.3.4)
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }

  return ip.trim();
};
