import axios from 'axios';

export interface IOxaPayInvoiceParams {
  amountUsdt: number;
  userId: string;
  chain: 'TRC20' | 'BEP20';
  email?: string;
}

export interface IOxaPayInvoiceResult {
  trackId: number;
  payAddress: string;
  qrCode?: string;
  payLink?: string;
  amount: number;
  currency: string;
  network: string;
  expiredAt?: number;
}

export class OxaPayService {
  private static baseUrl = 'https://api.oxapay.com';

  private static getMerchantKey(): string {
    const key = process.env.OXAPAY_MERCHANT_KEY;
    if (!key || key === 'YOUR_OXAPAY_MERCHANT_KEY_HERE') {
      throw new Error(
        'OXAPAY_MERCHANT_KEY is not configured in server/.env. Please add your merchant key from oxapay.com.'
      );
    }
    return key;
  }

  /**
   * Create an in-modal White-Label payment address or hosted invoice.
   * If white-label request succeeds, returns the exact payment address & QR code
   * so users never have to leave the Sprinkl dashboard.
   */
  static async createDepositInvoice(params: IOxaPayInvoiceParams): Promise<IOxaPayInvoiceResult> {
    const merchantKey = this.getMerchantKey();
    const domain = process.env.DOMAIN || 'https://sprinkl.biz';
    const callbackUrl = `${domain}/api/webhooks/oxapay`;
    const orderId = `USDT_DEP_${params.userId}_${Date.now()}`;

    try {
      // 1. Attempt White-Label request (direct address & QR generation)
      const res = await axios.post(`${this.baseUrl}/merchants/request/whitelabel`, {
        merchant: merchantKey,
        amount: params.amountUsdt,
        currency: 'USDT',
        feeCurrency: 'USDT',      // auto-select USDT on OxaPay checkout
        network: params.chain, // TRC20 or BEP20
        orderId,
        callbackUrl,
        email: params.email,
        description: `Sprinkl USDT Deposit for ${params.userId}`,
      });

      if (res.data && res.data.result === 100) {
        return {
          trackId: res.data.trackId,
          payAddress: res.data.payAddress || res.data.address,
          qrCode: res.data.qrCode,
          payLink: res.data.payLink,
          amount: res.data.amount || params.amountUsdt,
          currency: 'USDT',
          network: params.chain,
          expiredAt: res.data.expiredAt,
        };
      }

      // 2. Fallback to standard merchant invoice if whitelabel not enabled
      console.warn(
        '[OxaPay] Whitelabel returned non-100 code, falling back to standard invoice:',
        res.data?.message
      );

      const standardRes = await axios.post(`${this.baseUrl}/merchants/request`, {
        merchant: merchantKey,
        amount: params.amountUsdt,
        currency: 'USDT',
        feeCurrency: 'USDT',      // auto-select USDT on OxaPay checkout
        network: params.chain,
        orderId,
        callbackUrl,
        returnUrl: `${domain}/dashboard`,
        email: params.email,
        description: `Sprinkl USDT Deposit for ${params.userId}`,
      });

      if (standardRes.data && standardRes.data.result === 100) {
        return {
          trackId: standardRes.data.trackId,
          payAddress: standardRes.data.payAddress || '',
          payLink: standardRes.data.payLink,
          amount: standardRes.data.amount || params.amountUsdt,
          currency: 'USDT',
          network: params.chain,
          expiredAt: standardRes.data.expiredAt,
        };
      }

      throw new Error(standardRes.data?.message || 'Failed to create OxaPay invoice');
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || 'OxaPay API request failed';
      console.error('[OxaPay Error]:', msg);
      throw new Error(`OxaPay error: ${msg}`);
    }
  }

  /**
   * Verify an OxaPay payment status manually if needed.
   */
  static async checkPaymentStatus(trackId: number | string) {
    const merchantKey = this.getMerchantKey();
    const res = await axios.post(`${this.baseUrl}/merchants/inquiry`, {
      merchant: merchantKey,
      trackId,
    });
    return res.data;
  }
}

export default OxaPayService;
