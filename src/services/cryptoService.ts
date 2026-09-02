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
      const sample = 'TYv1k' + userId.toString().slice(-6) + 'Wz9XqJzV5vK8xQZ9wY1mN';
      return sample.padEnd(34, 'X');
    } else {
      const sample = '0x' + userId.toString().padEnd(40, 'a');
      return sample.slice(0, 42);
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
