const { detectCarrier } = require('../../dist/controllers/claimController');
const flutterwaveService = require('../../dist/services/flutterwaveService').default || require('../../dist/services/flutterwaveService');

describe('VTU Card & Airtime Carrier Detection', () => {
  it('should auto-detect MTN prefixes correctly', () => {
    expect(detectCarrier('08031234567')).toBe('MTN');
    expect(detectCarrier('08061234567')).toBe('MTN');
    expect(detectCarrier('07031234567')).toBe('MTN');
    expect(detectCarrier('07061234567')).toBe('MTN');
    expect(detectCarrier('08131234567')).toBe('MTN');
    expect(detectCarrier('08161234567')).toBe('MTN');
    expect(detectCarrier('09031234567')).toBe('MTN');
    expect(detectCarrier('09061234567')).toBe('MTN');
  });

  it('should auto-detect Airtel prefixes correctly', () => {
    expect(detectCarrier('08021234567')).toBe('AIRTEL');
    expect(detectCarrier('08081234567')).toBe('AIRTEL');
    expect(detectCarrier('07081234567')).toBe('AIRTEL');
    expect(detectCarrier('08121234567')).toBe('AIRTEL');
    expect(detectCarrier('09021234567')).toBe('AIRTEL');
    expect(detectCarrier('09011234567')).toBe('AIRTEL');
  });

  it('should auto-detect Glo prefixes correctly', () => {
    expect(detectCarrier('08051234567')).toBe('GLO');
    expect(detectCarrier('08071234567')).toBe('GLO');
    expect(detectCarrier('07051234567')).toBe('GLO');
    expect(detectCarrier('08151234567')).toBe('GLO');
    expect(detectCarrier('08111234567')).toBe('GLO');
  });

  it('should auto-detect 9mobile prefixes correctly', () => {
    expect(detectCarrier('08091234567')).toBe('9MOBILE');
    expect(detectCarrier('08171234567')).toBe('9MOBILE');
    expect(detectCarrier('08181234567')).toBe('9MOBILE');
    expect(detectCarrier('09091234567')).toBe('9MOBILE');
  });

  it('should handle +234 and 234 international country code formats', () => {
    let clean1 = '+2348031234567'.replace(/[^0-9+]/g, '');
    if (clean1.startsWith('+234')) clean1 = '0' + clean1.slice(4);
    expect(detectCarrier(clean1)).toBe('MTN');

    let clean2 = '2348021234567'.replace(/[^0-9]/g, '');
    if (clean2.startsWith('234') && clean2.length === 13) clean2 = '0' + clean2.slice(3);
    expect(detectCarrier(clean2)).toBe('AIRTEL');
  });

  it('should return null for unknown prefixes', () => {
    expect(detectCarrier('01234567890')).toBeNull();
  });

  it('should successfully execute sandbox airtime payout simulation without live API keys', async () => {
    const res = await flutterwaveService.sendAirtimePayout({
      phoneNumber: '08031234567',
      amountNaira: 100,
      network: 'MTN',
      reference: 'TEST_VTU_123',
    });

    expect(res).toBeDefined();
    expect(res.status).toBe('success');
    expect(res.phoneNumber).toBe('08031234567');
    expect(res.network).toBe('MTN');
    expect(res.reference).toBe('TEST_VTU_123');
  });
});
