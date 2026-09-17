import axios from 'axios';

export interface IOxaPayInvoiceParams {
  amountUsdt: number;
  userId: string;
  chain: 'TRC20' | 'BEP20';
  email?: string;
}

export interface IOxaPayInvoiceResult {
  trackId: string;
  payAddress: string;
  qrCode?: string;
  payLink?: string;
  amount: number;
  currency: string;
  network: string;
  expiredAt?: number;
}

/**
 * Maps Sprinkl chain identifiers to OxaPay v1 network names.
 * OxaPay v1 API uses full network names as returned by /api/currencies.
 */
const CHAIN_TO_OXAPAY_NETWORK: Record<string, string> = {
  TRC20: 'Tron',
  BEP20: 'BSC',
};

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
   * Create a White-Label deposit address using the OxaPay v1 API.
   * This returns a direct payment address + QR code for the exact network chosen
   * in Sprinkl, so users never need to leave the dashboard or re-select a network.
   *
   * Network mapping:
   *   TRC20 → Tron (Tron Network, USDT-TRC20)
   *   BEP20 → BSC  (Binance Smart Chain, USDT-BEP20)
   */
  static async createDepositInvoice(params: IOxaPayInvoiceParams): Promise<IOxaPayInvoiceResult> {
    const merchantKey = this.getMerchantKey();
    const domain = process.env.DOMAIN || 'https://sprinkl.biz';
    const callbackUrl = `https://api.sprinkl.biz/api/webhooks/oxapay`;
    const orderId = `USDT_DEP_${params.userId}_${Date.now()}`;

    // Map Sprinkl chain name to OxaPay v1 network identifier
    const oxaNetwork = CHAIN_TO_OXAPAY_NETWORK[params.chain] || params.chain;

    try {
      // Use OxaPay v1 White-Label endpoint — returns a direct pay address + QR code
      // with the network pre-selected, no redirect needed.
      const res = await axios.post(
        `${this.baseUrl}/v1/payment/white-label`,
        {
          amount: params.amountUsdt,
          pay_currency: 'USDT',
          currency: 'USDT',
          network: oxaNetwork,
          lifetime: 60,
          order_id: orderId,
          callback_url: callbackUrl,
          return_url: `${domain}/dashboard`,
          email: params.email || '',
          description: `Sprinkl USDT Deposit for ${params.userId}`,
        },
        {
          headers: {
            merchant_api_key: merchantKey,
            'Content-Type': 'application/json',
          },
        }
      );

      if (res.data?.status === 200 && res.data?.data?.track_id) {
        const d = res.data.data;
        return {
          trackId: String(d.track_id),
          payAddress: d.address || '',
          qrCode: d.qr_code,
          amount: d.pay_amount || d.amount || params.amountUsdt,
          currency: 'USDT',
          network: params.chain, // Return original Sprinkl chain name (TRC20/BEP20)
          expiredAt: d.expired_at,
        };
      }

      throw new Error(
        res.data?.message || `OxaPay white-label returned unexpected status: ${res.data?.status}`
      );
    } catch (err: any) {
      const msg =
        err.response?.data?.message ||
        err.response?.data?.error ||
        err.message ||
        'OxaPay API request failed';
      console.error('[OxaPay Error]:', msg, err.response?.data);
      throw new Error(`OxaPay error: ${msg}`);
    }
  }

  /**
   * Verify an OxaPay payment status using the legacy inquiry endpoint.
   * Works for both legacy invoice track IDs and v1 white-label track IDs.
   */
  static async checkPaymentStatus(trackId: number | string) {
    const merchantKey = this.getMerchantKey();
    const res = await axios.post(`${this.baseUrl}/merchants/inquiry`, {
      merchant: merchantKey,
      trackId,
    });
    return res.data;
  }

  /**
   * Robust error message extraction for OxaPay API responses.
   * OxaPay v1 returns HTTP 400 with a generic message and specific details
   * inside error: { type, key, message } or error: { [field]: 'reason' }.
   */
  private static extractErrorMessage(err: any): string {
    const data = err.response?.data;
    if (!data) return err.message || 'OxaPay API request failed';

    // 1. OxaPay specific error object
    if (data.error) {
      if (typeof data.error === 'string' && data.error.trim()) {
        return data.error;
      }
      if (typeof data.error === 'object') {
        // Standard OxaPay error schema: { type, key, message }
        if (data.error.message) {
          return data.error.key ? `${data.error.key}: ${data.error.message}` : data.error.message;
        }
        // Map of fields: { [field]: string | string[] }
        const entries = Object.entries(data.error);
        if (entries.length > 0) {
          return entries
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : (typeof v === 'object' && v ? JSON.stringify(v) : v)}`)
            .join(' | ');
        }
      }
    }

    // 2. Validation errors array/map
    if (data.errors && typeof data.errors === 'object') {
      const entries = Object.entries(data.errors);
      if (entries.length > 0) {
        return entries
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
          .join(' | ');
      }
    }

    // 3. Informative custom message (if not the generic boilerplate)
    const genericMsg = 'There was an issue with the submitted data. Please verify your input and try again.';
    if (data.message && data.message !== genericMsg) {
      return data.message;
    }

    // 4. Fallback with payload representation
    if (data.message) {
      const detail = data.error && Object.keys(data.error).length > 0 ? JSON.stringify(data.error) : JSON.stringify(data);
      return `${data.message} Detail: ${detail}`;
    }

    return JSON.stringify(data);
  }

  /**
   * Send a crypto payout using OxaPay v1 Payout API.
   * Disburses USDT directly from the merchant's OxaPay balance without
   * requiring on-chain private keys or gas funds.
   */
  static async sendPayout(params: {
    address: string;
    amountUsdt: number;
    chain: 'TRC20' | 'BEP20';
    description?: string;
  }): Promise<{ trackId: string; txHash: string; status: string; explorerUrl: string }> {
    const payoutKey = process.env.OXAPAY_PAYOUT_API_KEY;
    if (!payoutKey) {
      throw new Error(
        'OXAPAY_PAYOUT_API_KEY is not configured in .env. Generate a Payout API key in your OxaPay dashboard.'
      );
    }

    const network = CHAIN_TO_OXAPAY_NETWORK[params.chain] || params.chain;
    const cleanAmount = Number(params.amountUsdt.toFixed(6));
    const cleanAddress = params.address.trim();

    console.log(
      `[OxaPay Payout] Sending ${cleanAmount} USDT to ${cleanAddress} on network "${network}" (${params.chain})`
    );

    try {
      const res = await axios.post(
        `${this.baseUrl}/v1/payout`,
        {
          address: cleanAddress,
          currency: 'USDT',
          amount: cleanAmount,
          network,
          description: params.description || 'Sprinkl Giveaway Payout',
        },
        {
          headers: {
            payout_api_key: payoutKey,
            'Content-Type': 'application/json',
          },
        }
      );

      if (res.data?.status === 200 && res.data?.data) {
        const d = res.data.data;
        const trackId = String(d.track_id || d.id || '');
        const txHash = d.tx_hash || d.txId || trackId;
        const explorerUrl =
          params.chain === 'TRC20'
            ? `https://tronscan.org/#/transaction/${txHash}`
            : `https://bscscan.com/tx/${txHash}`;

        console.log(`[OxaPay Payout Success] TrackId: ${trackId}, Tx: ${txHash}`);

        return {
          trackId,
          txHash,
          status: d.status || 'processing',
          explorerUrl,
        };
      }

      const extractedMsg = this.extractErrorMessage({ response: res });
      throw new Error(extractedMsg || `OxaPay payout returned status: ${res.data?.status}`);
    } catch (err: any) {
      const detailedMsg = this.extractErrorMessage(err);
      console.error('[OxaPay Payout Error]:', {
        extractedError: detailedMsg,
        httpStatus: err.response?.status,
        responseData: err.response?.data,
        submittedPayload: {
          address: cleanAddress,
          currency: 'USDT',
          amount: cleanAmount,
          network,
        },
      });
      throw new Error(`OxaPay payout failed: ${detailedMsg}`);
    }
  }
}

export default OxaPayService;
