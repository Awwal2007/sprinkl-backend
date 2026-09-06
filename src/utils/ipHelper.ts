import { Request } from 'express';

/**
 * Strips port and IPv6-mapped IPv4 prefix (::ffff:1.2.3.4 -> 1.2.3.4)
 */
export const cleanIp = (rawIp: string): string => {
  if (!rawIp) return '';
  let ip = rawIp.trim();

  // Strip IPv6-mapped IPv4 prefix if present
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }

  // If IPv4 with port (e.g., 1.2.3.4:5678), remove port
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/.test(ip)) {
    ip = ip.split(':')[0];
  }

  return ip.trim();
};

/**
 * Extracts normalized client IP address considering proxy headers
 * (Cloudflare cf-connecting-ip, reverse proxies like Nginx/Caddy, x-forwarded-for)
 */
export const getClientIp = (req: Request | any): string => {
  if (!req) return '';

  const headers = req.headers || {};

  // 1. Cloudflare provides the validated true client IP in cf-connecting-ip
  if (typeof headers['cf-connecting-ip'] === 'string' && headers['cf-connecting-ip'].trim()) {
    return cleanIp(headers['cf-connecting-ip']);
  }

  // 2. X-Real-IP set by standard reverse proxies (Nginx / Caddy)
  if (typeof headers['x-real-ip'] === 'string' && headers['x-real-ip'].trim()) {
    return cleanIp(headers['x-real-ip']);
  }

  // 3. X-Forwarded-For: first IP in the comma-separated list is the original client
  const forwarded = headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    const first = forwarded.split(',')[0].trim();
    if (first) return cleanIp(first);
  } else if (Array.isArray(forwarded) && forwarded.length > 0) {
    const first = String(forwarded[0]).trim();
    if (first) return cleanIp(first);
  }

  // 4. Fallback to Express request IP or socket remoteAddress
  const socketIp = req.ip || req.socket?.remoteAddress || '';
  return cleanIp(socketIp);
};

/**
 * Determines whether an IP is loopback or local private network
 * (127.0.0.1, ::1, 192.168.*, 10.*, 172.16-31.*, link-local)
 */
export const isLocalOrPrivateIp = (rawIp: string): boolean => {
  if (!rawIp) return true;
  const ip = cleanIp(rawIp);

  if (
    ip === '::1' ||
    ip === '127.0.0.1' ||
    ip === 'localhost' ||
    ip === '::' ||
    ip.startsWith('fe80:') ||
    ip.startsWith('fc00:') ||
    ip.startsWith('fd00:') ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)
  ) {
    return true;
  }

  return false;
};
