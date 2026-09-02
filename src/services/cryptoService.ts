import TronWeb from 'tronweb';
import { ethers } from 'ethers';

// USDT TRC20 Contract address on Tron mainnet
const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

// USDT BEP20 Contract address on BSC mainnet
const USDT_BEP20_CONTRACT = '0x55d398326f99059fF775485246999027B3197955';

// BSC Mainnet RPC
const BSC_RPC_URL = 'https://bsc-dataseed1.binance.org/';

// ERC20/BEP20 minimal ABI for transfer
const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address owner) view returns (uint256)',
];

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

  // ─── TRC20 HELPERS ──────────────────────────────────────────────────
  private static getTronWeb(): TronWeb {
    const privateKey = process.env.TRON_HOT_WALLET_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('TRON_HOT_WALLET_PRIVATE_KEY is not configured in .env');
    }

    const tronWeb = new TronWeb({
      fullHost: 'https://api.trongrid.io',
      headers: process.env.TRON_GRID_API_KEY
        ? { 'TRON-PRO-API-KEY': process.env.TRON_GRID_API_KEY }
        : {},
      privateKey,
    });

    return tronWeb;
  }

  private static async sendTrc20Usdt(toAddress: string, amountSmallestUnit: number) {
    const tronWeb = this.getTronWeb();
    const rawAmount = Math.floor(amountSmallestUnit);

    if (rawAmount <= 0) {
      throw new Error(`Invalid USDT amount to send: ${rawAmount}`);
    }

    try {
      const contract = await tronWeb.contract().at(USDT_TRC20_CONTRACT);

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
        txHash: txId as string,
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

  // ─── BEP20 HELPERS ──────────────────────────────────────────────────
  private static getBscWallet(): ethers.Wallet {
    const privateKey = process.env.BSC_HOT_WALLET_PRIVATE_KEY;
    if (!privateKey || privateKey === 'YOUR_BSC_PRIVATE_KEY_HERE') {
      throw new Error(
        'BSC_HOT_WALLET_PRIVATE_KEY is not configured in .env. Set the private key of your BSC hot wallet to enable BEP20 payouts.'
      );
    }

    const provider = new ethers.JsonRpcProvider(BSC_RPC_URL);
    const wallet = new ethers.Wallet(
      privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`,
      provider
    );
    return wallet;
  }

  private static async sendBep20Usdt(toAddress: string, amountSmallestUnit: number) {
    const wallet = this.getBscWallet();
    const rawAmount = BigInt(Math.floor(amountSmallestUnit));

    if (rawAmount <= 0n) {
      throw new Error(`Invalid USDT amount to send: ${rawAmount}`);
    }

    try {
      const contract = new ethers.Contract(USDT_BEP20_CONTRACT, ERC20_ABI, wallet);

      // Check hot wallet USDT balance first
      const balance: bigint = await contract.balanceOf(wallet.address);
      if (balance < rawAmount) {
        const balanceReadable = ethers.formatUnits(balance, 18);
        const neededReadable = ethers.formatUnits(rawAmount, 18);
        throw new Error(
          `BSC hot wallet has insufficient USDT balance. Has: ${balanceReadable} USDT, needs: ${neededReadable} USDT. Fund ${wallet.address} on BSC.`
        );
      }

      // Estimate gas then send
      const tx = await contract.transfer(toAddress, rawAmount, {
        gasLimit: 100_000n,
      });

      console.log(`[CryptoService] BEP20 USDT sent. TxHash: ${tx.hash}, amount: ${rawAmount}, to: ${toAddress}`);

      return {
        success: true,
        txHash: tx.hash as string,
        chain: 'BEP20' as const,
        amount: Number(rawAmount),
        destination: toAddress,
        explorerUrl: `https://bscscan.com/tx/${tx.hash}`,
      };
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error(`[CryptoService] BEP20 USDT send failed: ${msg}`);
      throw new Error(`BEP20 USDT transfer failed: ${msg}`);
    }
  }

  // ─── PUBLIC PAYOUT ENTRY POINT ──────────────────────────────────────
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
      return await this.sendTrc20Usdt(destinationAddress, amountUsdtInteger);
    } else if (chain === 'BEP20') {
      return await this.sendBep20Usdt(destinationAddress, amountUsdtInteger);
    }

    throw new Error(`Unsupported chain: ${chain}`);
  }
}

export default CryptoService;
