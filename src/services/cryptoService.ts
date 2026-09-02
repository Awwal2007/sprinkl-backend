import TronWeb from 'tronweb';

// USDT TRC20 Contract address on Tron mainnet
const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

// USDT decimals for TRC20 is 6
const USDT_DECIMALS = 6;

export class CryptoService {
  static validateAddress(address: string, chain: 'TRC20' | 'BEP20' = 'TRC20'): boolean {
    if (!address || typeof address !== 'string') return false;
    const cleanAddr = address.trim();

    if (chain === 'TRC20') {
      return /^T[a-zA-Z0-9]{33}$/.test(cleanAddr);
    } else if (chain === 'BEP20') {
      return /^0x[a-fA-F0-9]{40}$/.test(cleanAddr);
    }

    return false;
  }

  static normalizeAddress(address: string, chain: 'TRC20' | 'BEP20' = 'TRC20'): string {
    const clean = (address || '').trim();
    if (chain === 'BEP20') {
      return clean.toLowerCase();
    }
    return clean;
  }

  static generateDepositAddress(userId: string, chain: 'TRC20' | 'BEP20' = 'TRC20'): string {
    if (chain === 'TRC20') {
      const addr = process.env.TRON_HOT_WALLET_ADDRESS;
      if (!addr || !this.validateAddress(addr, 'TRC20')) {
        throw new Error(
          'TRON hot wallet address is not configured or invalid. Set TRON_HOT_WALLET_ADDRESS in .env before accepting crypto deposits.'
        );
      }
      return addr;
    } else {
      const addr = process.env.BSC_HOT_WALLET_ADDRESS;
      if (!addr || !this.validateAddress(addr, 'BEP20')) {
        throw new Error(
          'BSC hot wallet address is not configured or invalid. Set BSC_HOT_WALLET_ADDRESS in .env before accepting BEP20 deposits.'
        );
      }
      return addr;
    }
  }

  private static getTronWeb(): TronWeb {
    const privateKey = process.env.TRON_HOT_WALLET_PRIVATE_KEY;
    const fullHost = 'https://api.trongrid.io';
    const apiKey = process.env.TRON_GRID_API_KEY;

    if (!privateKey) {
      throw new Error('TRON_HOT_WALLET_PRIVATE_KEY is not configured in .env');
    }

    const tronWeb = new TronWeb({
      fullHost,
      headers: apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {},
      privateKey,
    });

    return tronWeb;
  }

  static async sendUsdtPayout({
    destinationAddress,
    amountUsdtInteger,
    chain = 'TRC20',
    reference,
  }: {
    destinationAddress: string;
    amountUsdtInteger: number;
    chain?: 'TRC20' | 'BEP20';
    reference?: string;
  }) {
    if (!this.validateAddress(destinationAddress, chain)) {
      throw new Error(`Invalid ${chain} wallet address: ${destinationAddress}`);
    }

    if (chain === 'TRC20') {
      return await this.sendTrc20Usdt(destinationAddress, amountUsdtInteger, reference);
    } else if (chain === 'BEP20') {
      // BSC payouts: not yet implemented — requires ethers.js and BSC hot wallet setup
      throw new Error(
        'BEP20 USDT payouts are not yet configured. Please use TRC20 giveaways or contact support.'
      );
    }

    throw new Error(`Unsupported chain: ${chain}`);
  }

  private static async sendTrc20Usdt(
    toAddress: string,
    amountUsdtSmallestUnit: number,
    reference?: string
  ) {
    const tronWeb = this.getTronWeb();

    // The amount passed in is already in the 6-decimal format (e.g. 1 USDT = 1,000,000)
    const rawAmount = Math.floor(amountUsdtSmallestUnit);

    if (rawAmount <= 0) {
      throw new Error(`Invalid USDT amount to send: ${rawAmount}`);
    }

    try {
      // Get the TRC20 contract instance
      const contract = await tronWeb.contract().at(USDT_TRC20_CONTRACT);

      // Call the ERC20/TRC20 transfer function
      const txId = await contract.transfer(toAddress, rawAmount).send({
        feeLimit: 100_000_000, // 100 TRX fee limit for energy/bandwidth
        callValue: 0,
        shouldPollResponse: false,
      });

      if (!txId) {
        throw new Error('Tron transfer returned no transaction ID');
      }

      console.log(`[CryptoService] TRC20 USDT sent. TxID: ${txId}, amount: ${rawAmount}, to: ${toAddress}`);

      return {
        success: true,
        txHash: txId,
        chain: 'TRC20' as const,
        amount: rawAmount,
        destination: toAddress,
        explorerUrl: `https://tronscan.org/#/transaction/${txId}`,
      };
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error(`[CryptoService] TRC20 USDT send failed: ${msg}`);
      throw new Error(`TRC20 USDT transfer failed: ${msg}`);
    }
  }
}

export default CryptoService;
