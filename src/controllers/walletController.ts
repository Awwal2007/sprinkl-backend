import { Response, NextFunction } from 'express';
import LedgerService from '../services/ledgerService';
import LedgerEntry from '../models/LedgerEntry';
import flutterwaveService from '../services/flutterwaveService';
import cryptoService from '../services/cryptoService';
import Transaction from '../models/Transaction';
import { AuthRequest } from '../middleware/auth';

export const getWallet = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!._id;

    const ngnWallet = await LedgerService.getOrCreateWallet(userId, 'NGN');
    const usdtWallet = await LedgerService.getOrCreateWallet(userId, 'USDT');

    const ledgerHistory = await LedgerEntry.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(20);

    return res.json({
      balances: {
        NGN: {
          available: ngnWallet.available,
          reserved: ngnWallet.reserved,
          total: ngnWallet.available + ngnWallet.reserved,
        },
        USDT: {
          available: usdtWallet.available,
          reserved: usdtWallet.reserved,
          total: usdtWallet.available + usdtWallet.reserved,
        },
      },
      dva: {
        accountNumber: req.user!.paystackDvaAccountNumber,
        bankName: req.user!.paystackDvaBankName,
      },
      cryptoAddresses: req.user!.cryptoDepositAddresses || [],
      ledgerHistory,
    });
  } catch (err) {
    next(err);
  }
};

export const setupNgnDva = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;

    if (!user.paystackDvaAccountNumber) {
      const dvaInfo = await flutterwaveService.createVirtualAccount(user);
      user.paystackDvaAccountNumber = dvaInfo.accountNumber;
      user.paystackDvaBankName = dvaInfo.bankName;
      user.paystackCustomerCode = dvaInfo.flwRef;
      await user.save();
    }

    return res.json({
      message: 'Dedicated Virtual Account active',
      dva: {
        accountNumber: user.paystackDvaAccountNumber,
        bankName: user.paystackDvaBankName,
      },
    });
  } catch (err) {
    next(err);
  }
};

export const simulateFundNgn = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { amountNaira } = req.body;
    if (!amountNaira || amountNaira <= 0) {
      return res.status(400).json({ error: 'Amount in Naira must be greater than 0' });
    }

    const amountKobo = Math.round(amountNaira * 100);

    const refId = 'FLW_DVA_' + Date.now();
    const tx = await Transaction.create({
      user: req.user!._id,
      provider: 'flutterwave',
      providerReference: refId,
      direction: 'inbound',
      currency: 'NGN',
      amount: amountKobo,
      status: 'success',
      rawPayload: { note: 'Simulated Flutterwave DVA Bank Transfer Deposit' },
    });

    const wallet = await LedgerService.creditWallet({
      userId: req.user!._id,
      currency: 'NGN',
      amount: amountKobo,
      referenceType: 'PaystackTransaction',
      referenceId: tx._id,
    });

    return res.json({
      message: `Successfully credited ₦${amountNaira.toLocaleString()} to NGN wallet`,
      wallet: {
        available: wallet.available,
        reserved: wallet.reserved,
      },
    });
  } catch (err) {
    next(err);
  }
};

export const getUsdtDepositAddress = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { chain = 'TRC20' } = req.body;
    const user = req.user!;

    let existing = user.cryptoDepositAddresses.find((a) => a.chain === chain);
    if (!existing) {
      const address = cryptoService.generateDepositAddress(user._id.toString(), chain);
      user.cryptoDepositAddresses.push({ chain, address, createdAt: new Date() });
      await user.save();
      existing = { chain, address, createdAt: new Date() };
    }

    return res.json({
      chain: existing.chain,
      address: existing.address,
    });
  } catch (err) {
    next(err);
  }
};

export const simulateFundUsdt = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { amountUsdt, chain = 'TRC20' } = req.body;
    if (!amountUsdt || amountUsdt <= 0) {
      return res.status(400).json({ error: 'USDT amount must be greater than 0' });
    }

    const amountUnits = Math.round(amountUsdt * 1000000);

    const txHash = (chain === 'TRC20' ? 'tron_dep_' : 'bsc_dep_') + Date.now().toString(16);
    const tx = await Transaction.create({
      user: req.user!._id,
      provider: chain === 'TRC20' ? 'tron' : 'bsc',
      providerReference: txHash,
      direction: 'inbound',
      currency: 'USDT',
      amount: amountUnits,
      status: 'success',
      rawPayload: { note: `Simulated ${chain} Crypto Deposit` },
    });

    const wallet = await LedgerService.creditWallet({
      userId: req.user!._id,
      currency: 'USDT',
      amount: amountUnits,
      referenceType: 'CryptoDeposit',
      referenceId: tx._id,
    });

    return res.json({
      message: `Successfully credited ${amountUsdt} USDT to USDT wallet`,
      wallet: {
        available: wallet.available,
        reserved: wallet.reserved,
      },
    });
  } catch (err) {
    next(err);
  }
};
