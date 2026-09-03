import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import User from '../models/User';
import Transaction from '../models/Transaction';
import Claim from '../models/Claim';
import Giveaway from '../models/Giveaway';
import LedgerEntry from '../models/LedgerEntry';
import LedgerService from '../services/ledgerService';

export const handleFlutterwaveWebhook = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const secretHash = process.env.FLUTTERWAVE_SECRET_HASH || 'sprinkl_flw_secret_2026';
    const signature = req.headers['verif-hash'];

    if (secretHash && signature !== secretHash) {
      console.warn('[Flutterwave Webhook] Invalid signature received:', signature);
      return res.status(401).send('Invalid signature');
    }

    const payload = req.body;

    if (payload.event === 'charge.completed' && payload.data && payload.data.status === 'successful') {
      const { amount, customer, tx_ref } = payload.data;
      const email = customer?.email;
      const accountNumber = payload.data.account_number || payload.data.account?.account_number;
      const flwRef = payload.data.flw_ref;

      // Find user by email or DVA account number or customer reference
      const queryConditions: any[] = [];
      if (email) queryConditions.push({ email });
      if (accountNumber) queryConditions.push({ paystackDvaAccountNumber: accountNumber });
      if (flwRef) queryConditions.push({ paystackCustomerCode: flwRef });

      const user = queryConditions.length > 0 ? await User.findOne({ $or: queryConditions }) : null;
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
            referenceType: 'FlutterwaveTransaction',
            referenceId: tx._id,
          });
        }
      }
    }

    if (payload.event === 'transfer.completed' && payload.data) {
      const { status, reference, complete_message, id } = payload.data;
      console.log(`[Flutterwave Webhook] Transfer ${id} status: ${status}, ref: ${reference}`);

      // Sanitize reference lookup
      const claim = await Claim.findOne({
        $or: [
          { idempotencyKey: reference },
          { payoutReference: String(id) },
          { payoutReference: reference },
        ],
      }).populate('giveaway');

      if (claim) {
        const giveaway: any = claim.giveaway;
        const hostId = giveaway?.host;

        if (status === 'SUCCESSFUL' && claim.status !== 'paid') {
          claim.status = 'paid';
          claim.failureReason = undefined;
          await claim.save();

          // Write ledger debit if not already present
          if (hostId) {
            const existing = await LedgerEntry.findOne({ referenceType: 'Claim', referenceId: claim._id, status: 'paid' });
            if (!existing) {
              const beneficiaryName = claim.destination?.resolvedAccountName || claim.claimantName || 'Claimant';
              const beneficiaryAccount = claim.destination?.accountNumber || claim.destination?.walletAddress || 'N/A';
              const beneficiaryBank = claim.destination?.bankName || claim.destination?.chain || 'N/A';
              await LedgerService.debitPayout({
                userId: hostId,
                currency: claim.currency,
                amount: claim.amount,
                claimId: claim._id,
                beneficiaryName,
                beneficiaryAccount,
                beneficiaryBank,
                status: 'paid',
                note: `Payout confirmed by Flutterwave`,
              });
            }
          }
        } else if (status === 'FAILED') {
          // Only process the failure if the claim isn't already marked failed
          if (claim.status !== 'failed') {
            claim.status = 'failed';
            claim.failureReason = complete_message || 'Transfer disbursement failed on Flutterwave';
            if (claim.destination && claim.destination.normalized) {
              claim.destination.normalized = `FAILED_${Date.now()}_${claim.destination.normalized}`;
            }
            await claim.save();

            // Restore the giveaway slot
            if (giveaway) {
              await Giveaway.findByIdAndUpdate(giveaway._id, {
                $inc: { slotsClaimed: -1, 'stats.failedClaimAttempts': 1 },
                $set: { status: 'active' },
              });
            }

            // Write a failed ledger entry for the host's history
            if (hostId) {
              try {
                const wallet = await LedgerService.getOrCreateWallet(hostId, claim.currency);
                const beneficiaryName = claim.destination?.resolvedAccountName || claim.claimantName || 'Claimant';
                const beneficiaryAccount = claim.destination?.accountNumber || claim.destination?.walletAddress || 'N/A';
                const beneficiaryBank = claim.destination?.bankName || claim.destination?.chain || 'N/A';

                await LedgerEntry.create({
                  user: hostId,
                  currency: claim.currency,
                  type: 'payout',
                  status: 'failed',
                  amount: claim.amount,
                  direction: 'debit',
                  referenceType: 'Claim',
                  referenceId: claim._id,
                  balanceAfter: wallet.available + wallet.reserved,
                  beneficiaryName,
                  beneficiaryAccount,
                  beneficiaryBank,
                  note: `Failed Payout (Flutterwave): ${complete_message || 'Disbursement failed'}`,
                });
              } catch (ledgerErr) {
                console.error('[Webhook] Failed to write failed ledger entry:', ledgerErr);
              }
            }
          }
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

export const handleOxaPayWebhook = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = req.body;
    console.log('[OxaPay Webhook Received]:', JSON.stringify(payload));

    const { trackId, status, amount, orderId, txID, network } = payload;

    if (status === 'Paid' && orderId && amount) {
      // orderId format: USDT_DEP_{userId}_{timestamp}
      const parts = orderId.split('_');
      const userId = parts[2];

      const user = userId ? await User.findById(userId) : null;
      if (!user) {
        console.warn('[OxaPay Webhook] User not found for orderId:', orderId);
        return res.status(200).send('User not found');
      }

      const providerRef = String(trackId || txID || orderId);
      const existingTx = await Transaction.findOne({
        provider: 'oxapay',
        providerReference: providerRef,
      });

      if (existingTx) {
        console.log('[OxaPay Webhook] Deposit already credited for trackId:', trackId);
        return res.status(200).send('Already processed');
      }

      const amountUsdtUnits = Math.round(Number(amount) * 1000000);

      const tx = await Transaction.create({
        user: user._id,
        provider: 'oxapay',
        providerReference: providerRef,
        direction: 'inbound',
        currency: 'USDT',
        amount: amountUsdtUnits,
        status: 'success',
        rawPayload: payload,
      });

      await LedgerService.creditWallet({
        userId: user._id,
        currency: 'USDT',
        amount: amountUsdtUnits,
        referenceType: 'CryptoDeposit',
        referenceId: tx._id,
      });

      console.log(
        `[OxaPay Webhook] Successfully credited $${amount} USDT to user ${user.email} (${network})`
      );
    }

    return res.status(200).send('OK');
  } catch (err) {
    console.error('[OxaPay Webhook Error]:', err);
    return res.status(200).send('Error processed');
  }
};
