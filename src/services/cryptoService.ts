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

    const prefix = chain === 'TRC20' ? 'tron_tx_' : 'bsc_tx_';
    const txHash = prefix + Date.now().toString(16) + '_' + Math.random().toString(36).substring(2, 12);

    return {
      success: true,
      txHash,
      chain,
      amount: amountUsdtInteger,
      destination: destinationAddress,
      blockNumber: Math.floor(60000000 + Math.random() * 1000000),
    };
  }
}

export default CryptoService;
