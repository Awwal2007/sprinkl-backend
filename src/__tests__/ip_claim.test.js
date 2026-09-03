const { getClientIp } = require('../../dist/controllers/claimController');

describe('Client IP Extraction & Anti-Duplicate Normalization', () => {
  it('should extract client IP from x-forwarded-for header (first IP in list)', () => {
    const req = {
      headers: {
        'x-forwarded-for': '198.51.100.25, 10.0.0.1, 10.0.0.2',
      },
      socket: {},
    };

    expect(getClientIp(req)).toBe('198.51.100.25');
  });

  it('should extract client IP from cf-connecting-ip (Cloudflare)', () => {
    const req = {
      headers: {
        'cf-connecting-ip': '203.0.113.42',
      },
      socket: {},
    };

    expect(getClientIp(req)).toBe('203.0.113.42');
  });

  it('should strip IPv6-mapped IPv4 prefix (::ffff:)', () => {
    const req = {
      headers: {},
      ip: '::ffff:192.0.2.1',
      socket: {},
    };

    expect(getClientIp(req)).toBe('192.0.2.1');
  });

  it('should fallback to direct socket address if no proxy headers', () => {
    const req = {
      headers: {},
      socket: { remoteAddress: '203.0.113.99' },
    };

    expect(getClientIp(req)).toBe('203.0.113.99');
  });
});
