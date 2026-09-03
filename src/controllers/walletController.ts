import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import LedgerService from '../services/ledgerService';
import LedgerEntry from '../models/LedgerEntry';
import WalletAccount from '../models/WalletAccount';
import flutterwaveService from '../services/flutterwaveService';
import cryptoService from '../services/cryptoService';
import oxapayService from '../services/oxapayService';
import Transaction from '../models/Transaction';
import { AuthRequest } from '../middleware/auth';
import Giveaway from '../models/Giveaway';

export const getWallet = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!._id;

    const ngnWallet = await LedgerService.getOrCreateWallet(userId, 'NGN');
    const usdtWallet = await LedgerService.getOrCreateWallet(userId, 'USDT');

    const giveawayCount = await Giveaway.countDocuments({ host: userId });
    const isPromo = giveawayCount < 3;
    const remainingPromoCount = Math.max(0, 3 - giveawayCount);
    const feePercentage = isPromo ? 2.5 : 5.0;

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
      feeTier: {
        giveawayCount,
        isPromo,
        remainingPromoCount,
        feePercentage,
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
      if (!dvaInfo) {
        return res.status(502).json({ error: 'Could not create dedicated bank account. Please try again.' });
      }
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

export const initializeFlutterwaveDeposit = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { amountNaira } = req.body;
    const amount = parseFloat(amountNaira);
    if (!amount || amount < 3000) {
      return res.status(400).json({ error: 'Minimum deposit is ₦3,000.' });
    }

    const user = req.user!;
    const txRef = `DEP_${user._id}_${Date.now()}`;
    const flwSecret = process.env.FLUTTERWAVE_SECRET_KEY;

    if (!flwSecret) {
      return res.status(500).json({ error: 'Flutterwave gateway not configured.' });
    }

    const axios = (await import('axios')).default;
    const flwRes = await axios.post(
      'https://api.flutterwave.com/v3/payments',
      {
        tx_ref: txRef,
        amount,
        currency: 'NGN',
        redirect_url: `${process.env.DOMAIN || 'https://sprinkl.biz'}/dashboard?funded=true`,
        customer: {
          email: user.email,
          name: user.fullName,
          phonenumber: user.phone || '08000000000',
        },
        customizations: {
          title: 'Sprinkl Wallet Deposit',
          description: `Fund ₦${amount.toLocaleString()} into your host balance`,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${flwSecret}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (flwRes.data && flwRes.data.status === 'success') {
      return res.json({
        paymentLink: flwRes.data.data.link,
      });
    }

    return res.status(400).json({
      error: flwRes.data?.message || 'Failed to initialize Flutterwave payment.',
    });
  } catch (err: any) {
    console.error('[Flutterwave Init Error]', err.response?.data || err.message);
    return res.status(500).json({
      error: err.response?.data?.message || err.message || 'Payment initialization failed.',
    });
  }
};

export const simulateFundNgn = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { amountNaira } = req.body;
    if (!amountNaira || amountNaira <= 0) {
      return res.status(400).json({ error: 'Amount in Naira must be greater than 0' });
    }
    if (amountNaira < 3000) {
      return res.status(400).json({ error: 'Minimum NGN deposit is ₦3,000.' });
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
      referenceType: 'FlutterwaveTransaction',
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

    // Always derive from configured hot wallet — never serve stale cached fake addresses
    let address: string;
    try {
      address = cryptoService.generateDepositAddress(user._id.toString(), chain);
    } catch (configErr: any) {
      return res.status(503).json({
        error: `${chain} deposits are currently unavailable: ${configErr.message}`,
      });
    }

    // Persist so we have a record, but always override with the real env address
    const existing = user.cryptoDepositAddresses.find((a) => a.chain === chain);
    if (!existing) {
      user.cryptoDepositAddresses.push({ chain, address, createdAt: new Date() });
      await user.save();
    } else if (existing.address !== address) {
      // Update stale/fake cached address
      existing.address = address;
      await user.save();
    }

    return res.json({
      chain,
      address,
    });
  } catch (err) {
    next(err);
  }
};

export const createOxaPayDepositInvoice = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { amountUsdt, chain = 'TRC20' } = req.body;
    const user = req.user!;

    if (!amountUsdt || Number(amountUsdt) < 1) {
      return res.status(400).json({ error: 'Minimum USDT deposit amount is $1' });
    }

    const invoice = await oxapayService.createDepositInvoice({
      amountUsdt: Number(amountUsdt),
      userId: user._id.toString(),
      chain,
      email: user.email,
    });

    return res.json({
      invoice,
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to create crypto deposit invoice' });
  }
};

export const simulateFundUsdt = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { amountUsdt, chain = 'TRC20' } = req.body;
    if (!amountUsdt || amountUsdt <= 0) {
      return res.status(400).json({ error: 'USDT amount must be greater than 0' });
    }
    if (amountUsdt < 2) {
      return res.status(400).json({ error: 'Minimum USDT deposit is $2.' });
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

export const releaseReservedFundsToAvailable = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const currency = (req.body.currency || 'NGN').toUpperCase() as 'NGN' | 'USDT';
    const userId = req.user!._id;

    // 1. Find all active/paused giveaways for this user in this currency and close them
    const activeGiveaways = await Giveaway.find({
      host: userId,
      currency,
      status: { $in: ['active', 'paused'] },
    }).session(session);

    let totalCalculatedUnspent = 0;

    for (const g of activeGiveaways) {
      const unclaimed = Math.max(0, g.totalSlots - g.slotsClaimed);
      const unspent = unclaimed * g.amountPerRecipient;
      if (unspent > 0) {
        totalCalculatedUnspent += unspent;
      }
      g.status = 'cancelled';
      await g.save({ session });
    }

    // 2. Fetch or initialize the user's wallet
    let wallet = await WalletAccount.findOne({ user: userId, currency }).session(session);
    if (!wallet) {
      wallet = new WalletAccount({ user: userId, currency, available: 0, reserved: 0 });
    }

    const currentReserved = wallet.reserved || 0;
    if (currentReserved <= 0) {
      await session.abortTransaction();
      return res.status(400).json({ error: `You have no reserved ${currency} funds to transfer.` });
    }

    // Transfer the reserved funds directly to available
    const amountToTransfer = currentReserved;
    wallet.reserved = 0;
    wallet.available += amountToTransfer;
    await wallet.save({ session });

    // Record ledger entry with all required schema fields
    const refId = activeGiveaways[0]?._id || new mongoose.Types.ObjectId();
    await LedgerEntry.create(
      [
        {
          user: userId,
          currency,
          type: 'release',
          direction: 'credit',
          amount: amountToTransfer,
          referenceType: 'Giveaway',
          referenceId: refId,
          balanceAfter: wallet.available + wallet.reserved,
        },
      ],
      { session }
    );

    await session.commitTransaction();

    const formattedAmount =
      currency === 'NGN'
        ? `₦${(amountToTransfer / 100).toLocaleString()}`
        : `${(amountToTransfer / 1000000).toLocaleString()} USDT`;

    return res.json({
      message: `Successfully transferred ${formattedAmount} back to your main available balance!`,
      wallet: {
        available: wallet.available,
        reserved: wallet.reserved,
      },
    });
  } catch (err) {
    await session.abortTransaction();
    next(err);
  } finally {
    session.endSession();
  }
};
