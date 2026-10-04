import { Request } from 'express';
import geoip from 'geoip-lite';
import { IUser, IKnownLocation } from '../models/User';
import emailService from './emailService';

export interface ILoginMetadata {
  ip: string;
  city: string;
  region: string;
  country: string;
  countryCode: string;
  device: string;
  browser: string;
  os: string;
}

class SecurityService {
  /**
   * Safely extract client IP address from request headers
   */
  getClientIp(req: Request): string {
    const cfIp = req.headers['cf-connecting-ip'];
    if (typeof cfIp === 'string' && cfIp.trim()) {
      return cfIp.trim();
    }

    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      const firstIp = forwarded.split(',')[0].trim();
      if (firstIp) return firstIp;
    }

    const realIp = req.headers['x-real-ip'];
    if (typeof realIp === 'string' && realIp.trim()) {
      return realIp.trim();
    }

    const remoteIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
    // Normalize localhost IPv6
    if (remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1') {
      return '127.0.0.1';
    }
    return remoteIp;
  }

  /**
   * Parse user agent string into browser, OS, and device type
   */
  parseUserAgent(uaString: string = ''): { browser: string; os: string; device: string } {
    const ua = uaString.toLowerCase();

    // OS detection
    let os = 'Unknown OS';
    if (ua.includes('windows nt 10.0')) os = 'Windows 10/11';
    else if (ua.includes('windows')) os = 'Windows';
    else if (ua.includes('macintosh') || ua.includes('mac os x')) os = 'macOS';
    else if (ua.includes('iphone')) os = 'iOS (iPhone)';
    else if (ua.includes('ipad')) os = 'iPadOS';
    else if (ua.includes('android')) os = 'Android';
    else if (ua.includes('linux')) os = 'Linux';

    // Browser detection
    let browser = 'Unknown Browser';
    if (ua.includes('edg/')) browser = 'Microsoft Edge';
    else if (ua.includes('chrome/') && !ua.includes('edg/')) browser = 'Google Chrome';
    else if (ua.includes('safari/') && !ua.includes('chrome/')) browser = 'Apple Safari';
    else if (ua.includes('firefox/')) browser = 'Mozilla Firefox';
    else if (ua.includes('opera/') || ua.includes('opr/')) browser = 'Opera';

    // Device type
    let device = 'Desktop';
    if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
      device = 'Mobile';
    } else if (ua.includes('tablet') || ua.includes('ipad')) {
      device = 'Tablet';
    }

    return { browser, os, device };
  }

  /**
   * Get location details from IP
   */
  getLocationFromIp(ip: string): { city: string; region: string; country: string; countryCode: string } {
    if (!ip || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
      return {
        city: 'Local Network',
        region: 'Internal',
        country: 'Localhost',
        countryCode: 'LOC',
      };
    }

    try {
      const geo = geoip.lookup(ip);
      if (geo) {
        return {
          city: geo.city || 'Unknown City',
          region: geo.region || 'Unknown Region',
          country: geo.country || 'Unknown Country',
          countryCode: geo.country || 'XX',
        };
      }
    } catch (e) {
      console.error('[SecurityService GeoIP Error]:', e);
    }

    return {
      city: 'Unknown City',
      region: 'Unknown Region',
      country: 'Unknown Country',
      countryCode: 'XX',
    };
  }

  /**
   * Extract comprehensive metadata from incoming request
   */
  getRequestMetadata(req: Request): ILoginMetadata {
    const ip = this.getClientIp(req);
    const uaString = req.headers['user-agent'] || '';
    const { browser, os, device } = this.parseUserAgent(uaString);
    const { city, region, country, countryCode } = this.getLocationFromIp(ip);

    return {
      ip,
      city,
      region,
      country,
      countryCode,
      device,
      browser,
      os,
    };
  }

  /**
   * Inspect login location against user's history and send security alert if unrecognized
   */
  async checkAndRecordLoginLocation(user: IUser, req: Request): Promise<{ isUnknown: boolean }> {
    try {
      const meta = this.getRequestMetadata(req);
      const known = user.knownLocations || [];

      // Check if location matches any previously recorded login location
      const isKnownLocation = known.some((loc) => {
        // If exact IP matches
        if (loc.ip === meta.ip && meta.ip !== '127.0.0.1') return true;

        // If same country and city match
        if (
          loc.countryCode &&
          meta.countryCode &&
          loc.countryCode !== 'XX' &&
          loc.countryCode !== 'LOC' &&
          loc.countryCode === meta.countryCode &&
          loc.city &&
          meta.city &&
          loc.city.toLowerCase() === meta.city.toLowerCase()
        ) {
          return true;
        }

        // If local development
        if (meta.countryCode === 'LOC' && loc.countryCode === 'LOC') {
          return true;
        }

        return false;
      });

      // If user has past locations and this current location is NOT known
      const isUnknown = known.length > 0 && !isKnownLocation;

      if (isUnknown) {
        console.warn(
          `[Security Alert] Unknown login location for user ${user.email}: ${meta.city}, ${meta.country} (${meta.ip}) [Device: ${meta.browser} on ${meta.os}]`
        );

        // Dispatch alert email immediately
        await emailService.sendUnknownLocationSecurityAlertEmail({
          email: user.email,
          fullName: user.fullName,
          ip: meta.ip,
          city: meta.city,
          region: meta.region,
          country: meta.country,
          browser: meta.browser,
          os: meta.os,
          device: meta.device,
          loginTime: new Date(),
        });
      }

      // Update or append location to knownLocations
      const existingIdx = known.findIndex(
        (loc) =>
          loc.ip === meta.ip ||
          (loc.countryCode &&
            meta.countryCode &&
            loc.countryCode === meta.countryCode &&
            loc.city?.toLowerCase() === meta.city.toLowerCase() &&
            meta.countryCode !== 'LOC')
      );

      if (existingIdx >= 0) {
        known[existingIdx].lastSeenAt = new Date();
        known[existingIdx].browser = meta.browser;
        known[existingIdx].os = meta.os;
        known[existingIdx].device = meta.device;
      } else {
        const newLocation: IKnownLocation = {
          ip: meta.ip,
          city: meta.city,
          region: meta.region,
          country: meta.country,
          countryCode: meta.countryCode,
          device: meta.device,
          browser: meta.browser,
          os: meta.os,
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
        };

        // Keep at most 20 known locations
        if (known.length >= 20) {
          known.shift();
        }
        known.push(newLocation);
      }

      user.knownLocations = known;
      await user.save();

      return { isUnknown };
    } catch (err) {
      console.error('[SecurityService Error]:', err);
      return { isUnknown: false };
    }
  }
}

export default new SecurityService();
