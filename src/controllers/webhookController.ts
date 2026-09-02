import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import User from '../models/User';
import Transaction from '../models/Transaction';
import LedgerService from '../services/ledgerService';

export const handleFlutterwaveWebhook = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const secretHash = process.env.FLUTTERWAVE_SECRET_HASH || 'sprinkl_flw_secret_2026';
    const signature = req.headers['verif-hash'];

    if (signature && signature !== secretHash) {
      return res.status(401).send('Invalid signature');
    }

    const payload = req.body;

    if (payload.event === 'charge.completed' && payload.data && payload.data.status === 'successful') {
      const { amount, customer, tx_ref } = payload.data;
      const email = customer.email;

      const user = await User.findOne({ email });
      if (user) {
        const existingTx = await Transaction.findOne({ provider: 'flutterwave', providerReference: tx_ref });
        if (!existingTx) {
          const amountKobo = Math.round(amount * 100);
          const tx = await Transaction.create({
            user: user._id,
            provider: 'flutterwave',
            providerReference: tx_ref,
            direction: 'inbound',
            currency: 'NGN',
            amount: amountKobo,
            status: 'success',
            rawPayload: payload,
          });

          await LedgerService.creditWallet({
            userId: user._id,
            currency: 'NGN',
            amount: amountKobo,
            referenceType: 'PaystackTransaction',
            referenceId: tx._id,
          });
        }
      }
    }

    return res.status(200).send('Webhook received');
  } catch (err) {
    console.error('[Flutterwave Webhook Error]', err);
    return res.status(500).send('Webhook error');
  }
};

export const handlePaystackWebhook = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const event = req.body;

    if (event.event === 'charge.success') {
      const { amount, customer, reference } = event.data;
      const email = customer.email;

      const user = await User.findOne({ email });
      if (user) {
        const existingTx = await Transaction.findOne({ provider: 'paystack', providerReference: reference });
        if (!existingTx) {
          const tx = await Transaction.create({
            user: user._id,
            provider: 'paystack',
            providerReference: reference,
            direction: 'inbound',
            currency: 'NGN',
            amount,
            status: 'success',
            rawPayload: event,
          });

          await LedgerService.creditWallet({
            userId: user._id,
            currency: 'NGN',
            amount,
            referenceType: 'PaystackTransaction',
            referenceId: tx._id,
          });
        }
      }
    }

    return res.status(200).send('Webhook processed');
  } catch (err) {
    console.error('[Paystack Webhook Error]', err);
    return res.status(500).send('Webhook error');
  }
};

export const handleCryptoDepositWebhook = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, txHash, chain, amountUsdtInteger } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const existingTx = await Transaction.findOne({ providerReference: txHash });
    if (existingTx) return res.json({ message: 'Deposit already processed' });

    const tx = await Transaction.create({
      user: user._id,
      provider: chain === 'TRC20' ? 'tron' : 'bsc',
      providerReference: txHash,
      direction: 'inbound',
      currency: 'USDT',
      amount: amountUsdtInteger,
      status: 'success',
      rawPayload: req.body,
    });

    await LedgerService.creditWallet({
      userId: user._id,
      currency: 'USDT',
      amount: amountUsdtInteger,
      referenceType: 'CryptoDeposit',
      referenceId: tx._id,
    });

    return res.json({ message: 'Crypto deposit processed successfully' });
  } catch (err) {
    next(err);
  }
};
