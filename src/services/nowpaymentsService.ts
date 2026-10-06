import axios from 'axios';
import crypto from 'crypto';

export interface INowPaymentsInvoiceParams {
  amountUsdt: number;
  userId: string;
  chain: 'TRC20' | 'BEP20';
  email?: string;
}

export interface INowPaymentsInvoiceResult {
  paymentId: string;
  payAddress: string;
  qrCode?: string;
  payLink?: string;
  amount: number;
  currency: string;
  network: string;
  status: string;
  createdAt?: string;
}

/**
 * NOWPayments currency ticker mapping:
 * TRC20 -> usdttrc20 (Tether on Tron)
 * BEP20 -> usdtbsc   (Tether on Binance Smart Chain)
 */
const CHAIN_TO_NOWPAYMENTS_TICKER: Record<string, string> = {
  TRC20: 'usdttrc20',
  BEP20: 'usdtbsc',
};

export class NowPaymentsService {
  private static getBaseUrl(): string {
    return process.env.NOWPAYMENTS_ENV === 'sandbox'
      ? 'https://api-sandbox.nowpayments.io/v1'
      : 'https://api.nowpayments.io/v1';
  }

  private static getApiKey(): string {
    const key = process.env.NOWPAYMENTS_API_KEY;
    if (!key || key.includes('YOUR_')) {
      throw new Error(
        'NOWPAYMENTS_API_KEY is not configured in server/.env. Please generate your API key at https://account.nowpayments.io or https://account-sandbox.nowpayments.io.'
      );
    }
    return key;
  }

  /**
   * Create an invoice/payment with a direct deposit address and QR code
   */
  static async createDepositInvoice(
    params: INowPaymentsInvoiceParams
  ): Promise<INowPaymentsInvoiceResult> {
    const apiKey = this.getApiKey();
    const payCurrency = CHAIN_TO_NOWPAYMENTS_TICKER[params.chain] || 'usdttrc20';
    const orderId = `USDT_DEP_${params.userId}_${Date.now()}`;
    const callbackUrl = `https://api.sprinkl.biz/api/webhooks/nowpayments`;

    try {
      const response = await axios.post(
        `${this.getBaseUrl()}/payment`,
        {
          price_amount: params.amountUsdt,
          price_currency: 'usd',
          pay_amount: params.amountUsdt,
          pay_currency: payCurrency,
          ipn_callback_url: callbackUrl,
          order_id: orderId,
          order_description: `Sprinkl USDT Deposit for ${params.userId}`,
          case: 'success',
        },
        {
          headers: {
            'x-api-key': apiKey,
            'Content-Type': 'application/json',
          },
        }
      );

      const d = response.data;
      const payAddress = d.pay_address || '';
      const qrCode = payAddress
        ? `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(payAddress)}`
        : undefined;

      return {
        paymentId: String(d.payment_id),
        payAddress,
        qrCode,
        amount: Number(d.pay_amount || params.amountUsdt),
        currency: 'USDT',
        network: params.chain,
        status: d.payment_status || 'waiting',
        createdAt: d.created_at,
      };
    } catch (err: any) {
      const errorMsg =
        err.response?.data?.message ||
        err.response?.data?.error ||
        err.message ||
        'NOWPayments API request failed';
      console.error('[NOWPayments Invoice Error]:', errorMsg, err.response?.data);
      throw new Error(`NOWPayments error: ${errorMsg}`);
    }
  }

  /**
   * Check payment status by Payment ID
   */
  static async checkPaymentStatus(paymentId: string | number) {
    const apiKey = this.getApiKey();
    try {
      const response = await axios.get(`${this.getBaseUrl()}/payment/${paymentId}`, {
        headers: {
          'x-api-key': apiKey,
        },
      });
      return response.data;
    } catch (err: any) {
      console.error('[NOWPayments Check Status Error]:', err.response?.data || err.message);
      return null;
    }
  }

  /**
   * Recursively sorts object keys alphabetically (required for NOWPayments IPN HMAC-SHA512 verification).
   */
  private static sortObjectRecursive(obj: any): any {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
      return obj;
    }
    const sortedKeys = Object.keys(obj).sort();
    const result: Record<string, any> = {};
    for (const key of sortedKeys) {
      result[key] = this.sortObjectRecursive(obj[key]);
    }
    return result;
  }

  /**
   * Verify NOWPayments HMAC-SHA512 IPN signature
   */
  static verifyIpnSignature(
    payload: Record<string, any>,
    receivedSig?: string | string[]
  ): boolean {
    const secret = process.env.NOWPAYMENTS_IPN_SECRET;
    if (!secret) {
      console.error('[NOWPayments IPN] NOWPAYMENTS_IPN_SECRET is not configured in .env! Rejecting webhook for safety.');
      return false;
    }

    if (!receivedSig) return false;
    const sig = Array.isArray(receivedSig) ? receivedSig[0] : receivedSig;

    try {
      const sortedObj = this.sortObjectRecursive(payload);
      const jsonStr = JSON.stringify(sortedObj);
      const hmac = crypto.createHmac('sha512', secret);
      hmac.update(jsonStr);
      const calculatedSig = hmac.digest('hex');
      const calcBuf = Buffer.from(calculatedSig.toLowerCase());
      const recBuf = Buffer.from(sig.toLowerCase());

      return calcBuf.length === recBuf.length && crypto.timingSafeEqual(calcBuf, recBuf);
    } catch (err) {
      console.error('[NOWPayments IPN Signature Error]:', err);
      return false;
    }
  }

  private static cachedJwtToken: { token: string; expiresAt: number } | null = null;

  /**
   * Authenticate with NOWPayments to obtain a Bearer JWT token required for Payouts
   */
  static async getAuthToken(): Promise<string> {
    const email = process.env.NOWPAYMENTS_EMAIL;
    const password = process.env.NOWPAYMENTS_PASSWORD;

    if (!email || !password) {
      throw new Error(
        'NOWPayments Payouts require NOWPAYMENTS_EMAIL and NOWPAYMENTS_PASSWORD in server/.env to authenticate for Bearer JWT token. Add your NOWPayments account login credentials to .env.'
      );
    }

    const now = Date.now();
    // Cache token and refresh 30s before 5-minute expiry
    if (this.cachedJwtToken && this.cachedJwtToken.expiresAt > now + 30000) {
      return this.cachedJwtToken.token;
    }

    try {
      const res = await axios.post(
        `${this.getBaseUrl()}/auth`,
        {
          email: email.trim(),
          password: password.trim(),
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.getApiKey(),
          },
        }
      );

      const token = res.data?.token;
      if (!token) {
        throw new Error('NOWPayments /auth endpoint did not return a valid JWT token');
      }

      this.cachedJwtToken = {
        token,
        expiresAt: now + 4 * 60 * 1000, // 4 minutes
      };

      return token;
    } catch (err: any) {
      const msg = err.response?.data?.message || err.response?.data?.error || err.message;
      console.error('[NOWPayments Auth Error]:', msg, err.response?.data);
      throw new Error(`NOWPayments payout authentication failed: ${msg}`);
    }
  }

  /**
   * Base32 decode a secret key into binary buffer
   */
  private static base32Decode(str: string): Buffer {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const cleaned = str.toUpperCase().replace(/=+$/, '').replace(/[\s-]/g, '');
    let bits = '';
    for (let i = 0; i < cleaned.length; i++) {
      const val = alphabet.indexOf(cleaned[i]);
      if (val === -1) throw new Error(`Invalid base32 character: ${cleaned[i]}`);
      bits += val.toString(2).padStart(5, '0');
    }
    const bytes: number[] = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
      bytes.push(parseInt(bits.slice(i, i + 8), 2));
    }
    return Buffer.from(bytes);
  }

  /**
   * Generate RFC 6238 compliant 6-digit TOTP code for NOWPayments 2FA
   */
  static generate2FACode(secret: string): string {
    const key = this.base32Decode(secret.trim());
    const epoch = Math.floor(Date.now() / 1000);
    const counter = Math.floor(epoch / 30);
    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(BigInt(counter));
    const hmac = crypto.createHmac('sha1', key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0xf;
    const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000;
    return code.toString().padStart(6, '0');
  }

  /**
   * Verify an existing payout batch with a 2FA code (auto or manual)
   */
  static async verifyPayoutBatch(
    batchId: string | number,
    code: string
  ): Promise<any> {
    const apiKey = this.getApiKey();
    const jwtToken = await this.getAuthToken();
    const response = await axios.post(
      `${this.getBaseUrl()}/payout/${batchId}/verify`,
      { verification_code: code.trim() },
      {
        headers: {
          'x-api-key': apiKey,
          'Authorization': `Bearer ${jwtToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data;
  }

  /**
   * Send a payout / withdrawal from NOWPayments custody balance to a user address
   */
  static async sendPayout(params: {
    address: string;
    amountUsdt: number;
    chain: 'TRC20' | 'BEP20';
    description?: string;
  }): Promise<{
    payoutId: string;
    txHash?: string;
    status: string;
    explorerUrl: string;
    requiresEmailVerification: boolean;
  }> {
    const apiKey = this.getApiKey();
    const jwtToken = await this.getAuthToken();
    const currency = CHAIN_TO_NOWPAYMENTS_TICKER[params.chain] || 'usdttrc20';
    const cleanAmount = Number(params.amountUsdt.toFixed(6));
    const cleanAddress = params.address.trim();

    console.log(
      `[NOWPayments Payout] Submitting withdrawal of ${cleanAmount} USDT to ${cleanAddress} (${params.chain})`
    );

    try {
      const response = await axios.post(
        `${this.getBaseUrl()}/payout`,
        {
          withdrawals: [
            {
              address: cleanAddress,
              currency,
              amount: cleanAmount,
              ipn_callback_url: 'https://api.sprinkl.biz/api/webhooks/nowpayments',
            },
          ],
        },
        {
          headers: {
            'x-api-key': apiKey,
            'Authorization': `Bearer ${jwtToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const data = response.data;
      const withdrawal = Array.isArray(data.withdrawals) ? data.withdrawals[0] : data;
      const batchId = data.id || withdrawal?.batch_withdrawal_id || withdrawal?.id;
      const payoutId = String(withdrawal?.id || data.id || Date.now());
      const txHash = withdrawal?.batch_withdrawal_id || withdrawal?.hash || payoutId;
      const explorerUrl =
        params.chain === 'TRC20'
          ? `https://tronscan.org/#/transaction/${txHash}`
          : `https://bscscan.com/tx/${txHash}`;

      let status = (withdrawal?.status || data.status || 'creating').toLowerCase();
      let requiresEmailVerification = false;

      // ── AUTO-VERIFICATION WITH 2FA SECRET ─────────────────────────────────────
      const totpSecret = process.env.NOWPAYMENTS_2FA_SECRET;
      if (totpSecret && batchId) {
        try {
          const totpCode = this.generate2FACode(totpSecret);
          console.log(`[NOWPayments Payout] Auto-verifying batch ${batchId} via 2FA TOTP...`);
          await this.verifyPayoutBatch(batchId, totpCode);
          console.log(`[NOWPayments Payout] Batch ${batchId} successfully verified! Payout will execute automatically.`);
          status = 'processing';
          requiresEmailVerification = false;
        } catch (verifyErr: any) {
          console.warn(
            `[NOWPayments Payout] 2FA auto-verification failed:`,
            verifyErr.response?.data || verifyErr.message
          );
          // If auto-verify fails, fallback to email verification
          requiresEmailVerification = true;
        }
      } else {
        // If 2FA secret is not configured in .env, NOWPayments sends an email verification link
        console.warn(
          `[NOWPayments Payout] NOWPAYMENTS_2FA_SECRET is not configured in .env. NOWPayments has dispatched a withdrawal verification email to your registered email address.`
        );
        requiresEmailVerification = true;
      }

      return {
        payoutId,
        txHash,
        status,
        explorerUrl,
        requiresEmailVerification,
      };
    } catch (err: any) {
      let msg =
        err.response?.data?.message ||
        err.response?.data?.error ||
        err.message ||
        'Payout request failed';
      console.error('[NOWPayments Payout Error]:', msg, err.response?.data);
      if (typeof msg === 'string' && msg.toLowerCase().includes('not whitelisted')) {
        msg = `${msg}. (Action required: In your NOWPayments Dashboard under Settings > Payouts, disable "Address Whitelisting" or whitelist addresses so NOWPayments can disburse automated prize payouts to winners)`;
      }
      throw new Error(`NOWPayments payout failed: ${msg}`);
    }
  }
}

export default NowPaymentsService;
