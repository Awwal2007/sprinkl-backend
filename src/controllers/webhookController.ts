import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import User from '../models/User';
import Admin from '../models/Admin';
import Transaction from '../models/Transaction';
import Claim from '../models/Claim';
import Giveaway from '../models/Giveaway';
import LedgerEntry from '../models/LedgerEntry';
import LedgerService from '../services/ledgerService';
import NowPaymentsService from '../services/nowpaymentsService';
import CryptoDepositService from '../services/cryptoDepositService';

export const handleFlutterwaveWebhook = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const secretHash = process.env.FLUTTERWAVE_SECRET_HASH;
    const signature = req.headers['verif-hash'];

    if (!secretHash || !signature || typeof signature !== 'string') {
      console.warn('[Flutterwave Webhook] Rejected: Missing signature or FLUTTERWAVE_SECRET_HASH');
      return res.status(401).send('Unauthorized webhook request');
    }

    const sigBuf = Buffer.from(signature);
    const secretBuf = Buffer.from(secretHash);
    if (sigBuf.length !== secretBuf.length || !crypto.timingSafeEqual(sigBuf, secretBuf)) {
      console.warn('[Flutterwave Webhook] Rejected: Invalid signature');
      return res.status(401).send('Invalid signature');
    }

    const payload = req.body;

    if (payload.event === 'charge.completed' && payload.data && payload.data.status === 'successful') {
      const { amount, customer, tx_ref, id } = payload.data;
      const email = customer?.email;
      const accountNumber = payload.data.account_number || payload.data.account?.account_number;
      const flwRef = payload.data.flw_ref;

      // Find user by email, DVA account number, customer reference, or extracted ID from tx_ref
      const queryConditions: any[] = [];
      if (email) queryConditions.push({ email });
      if (accountNumber) queryConditions.push({ paystackDvaAccountNumber: accountNumber });
      if (flwRef) queryConditions.push({ paystackCustomerCode: flwRef });

      if (tx_ref && typeof tx_ref === 'string' && tx_ref.startsWith('DEP_')) {
        const parts = tx_ref.split('_');
        if (parts[1] && parts[1].length === 24) {
          queryConditions.push({ _id: parts[1] });
        }
      }

      let user: any = queryConditions.length > 0 ? await User.findOne({ $or: queryConditions }) : null;
      if (!user && queryConditions.length > 0) {
        user = await Admin.findOne({ $or: queryConditions });
      }
      if (user) {
        const ref = tx_ref || String(id);
        const existingTx = await Transaction.findOne({ provider: 'flutterwave', providerReference: ref });
        if (!existingTx) {
          const amountKobo = Math.round(amount * 100);
          const tx = await Transaction.create({
            user: user._id,
            provider: 'flutterwave',
            providerReference: ref,
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

          console.log(`[Flutterwave Webhook] Credited ₦${amount} to user ${user.email} (ref: ${ref})`);
        }
      } else {
        console.warn('[Flutterwave Webhook] User not identified for deposit:', payload.data);
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
              const beneficiaryName =
                claim.destination?.resolvedAccountName ||
                claim.claimantName ||
                (claim.currency === 'AIRTIME' ? `${claim.destination?.network || 'VTU'} (${claim.destination?.phoneNumber})` : 'Claimant');
              const beneficiaryAccount =
                claim.currency === 'AIRTIME'
                  ? claim.destination?.phoneNumber || 'N/A'
                  : claim.destination?.accountNumber || claim.destination?.walletAddress || 'N/A';
              const beneficiaryBank =
                claim.currency === 'AIRTIME'
                  ? claim.destination?.network || 'VTU Airtime'
                  : claim.destination?.bankName || claim.destination?.chain || 'N/A';
              const ledgerCurrency = claim.currency === 'AIRTIME' ? 'NGN' : claim.currency;
              await LedgerService.debitPayout({
                userId: hostId,
                currency: ledgerCurrency,
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

            // Restore the giveaway slot and deduct from distributed stats
            if (giveaway) {
              await Giveaway.findByIdAndUpdate(giveaway._id, {
                $inc: {
                  slotsClaimed: -1,
                  'stats.failedClaimAttempts': 1,
                  'stats.totalDistributed': -claim.amount,
                },
                $set: { status: 'active' },
              });
            }

            // Write a failed ledger entry for the host's history
            if (hostId) {
              try {
                const ledgerCurrency = claim.currency === 'AIRTIME' ? 'NGN' : claim.currency;
                const wallet = await LedgerService.getOrCreateWallet(hostId, ledgerCurrency);
                const beneficiaryName =
                  claim.destination?.resolvedAccountName ||
                  claim.claimantName ||
                  (claim.currency === 'AIRTIME' ? `${claim.destination?.network || 'VTU'} (${claim.destination?.phoneNumber})` : 'Claimant');
                const beneficiaryAccount =
                  claim.currency === 'AIRTIME'
                    ? claim.destination?.phoneNumber || 'N/A'
                    : claim.destination?.accountNumber || claim.destination?.walletAddress || 'N/A';
                const beneficiaryBank =
                  claim.currency === 'AIRTIME'
                    ? claim.destination?.network || 'VTU Airtime'
                    : claim.destination?.bankName || claim.destination?.chain || 'N/A';

                await LedgerEntry.create({
                  user: hostId,
                  currency: ledgerCurrency,
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
    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
    const signature = req.headers['x-paystack-signature'];

    if (!paystackSecret || !signature || typeof signature !== 'string') {
      console.warn('[Paystack Webhook] Rejected: Missing signature or PAYSTACK_SECRET_KEY');
      return res.status(401).send('Unauthorized webhook request');
    }

    const rawBody = JSON.stringify(req.body);
    const computedHash = crypto.createHmac('sha512', paystackSecret).update(rawBody).digest('hex');
    const computedBuf = Buffer.from(computedHash);
    const sigBuf = Buffer.from(signature);

    if (computedBuf.length !== sigBuf.length || !crypto.timingSafeEqual(computedBuf, sigBuf)) {
      console.warn('[Paystack Webhook] Rejected: Invalid signature');
      return res.status(401).send('Invalid signature');
    }

    const event = req.body;

    if (event.event === 'charge.success') {
      const { amount, customer, reference } = event.data;
      const email = customer?.email;

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



export const handleNowPaymentsWebhook = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = req.body || {};
    const receivedSig = req.headers['x-nowpayments-sig'];
    console.log('[NOWPayments Webhook Received]:', JSON.stringify(payload));

    const isValid = NowPaymentsService.verifyIpnSignature(payload, receivedSig);
    if (!isValid) {
      console.warn('[NOWPayments Webhook] Invalid IPN signature');
      return res.status(401).send('Invalid signature');
    }

    const paymentId = String(payload.payment_id || '');
    const status = (payload.payment_status || '').toString().toLowerCase();
    // Gross amount: prefer actually_paid, then pay_amount, then price_amount
    const amountGross = Number(payload.actually_paid || payload.pay_amount || payload.price_amount || 0);
    const orderId = payload.order_id || '';
    const currency = payload.pay_currency || 'usdt';

    // Support finished, confirmed, sending, and partially_paid!
    const isPaid =
      status === 'finished' || status === 'confirmed' || status === 'sending' || status === 'partially_paid';

    if (isPaid && amountGross > 0) {
      const result = await CryptoDepositService.processCredit({
        provider: 'nowpayments',
        providerReference: paymentId,
        amountUsdtGross: amountGross,
        rawPayload: payload,
        orderId,
        network: currency,
      });

      if (!result.success) {
        console.warn(`[NOWPayments Webhook Error]: ${result.error}`);
      }
    } else if (status === 'failed' || status === 'expired') {
      await Transaction.findOneAndUpdate(
        { provider: 'nowpayments', providerReference: paymentId, status: { $ne: 'success' } },
        { status: 'failed', rawPayload: payload }
      );
    }

    return res.status(200).send('OK');
  } catch (err) {
    console.error('[NOWPayments Webhook Error]:', err);
    return res.status(200).send('Error processed');
  }
};
