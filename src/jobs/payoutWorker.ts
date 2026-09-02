import Claim from '../models/Claim';
import Giveaway from '../models/Giveaway';
import Transaction from '../models/Transaction';
import LedgerService from '../services/ledgerService';
import flutterwaveService from '../services/flutterwaveService';
import cryptoService from '../services/cryptoService';

export class PayoutWorker {
  static async processPayout(claimId: string) {
    const claim = await Claim.findById(claimId).populate('giveaway');
    if (!claim) {
      console.error(`[PayoutWorker] Claim not found: ${claimId}`);
      return;
    }

    if (claim.status === 'paid') {
      console.log(`[PayoutWorker] Claim ${claimId} already paid, skipping.`);
      return claim;
    }

    claim.status = 'processing';
    await claim.save();

    const giveaway: any = claim.giveaway;
    const hostId = giveaway.host;

    try {
      let payoutRef: string | undefined = undefined;
      let rawResponse: any = null;
      let providerName: 'flutterwave' | 'tron' | 'bsc' = 'flutterwave';

      if (claim.currency === 'NGN') {
        providerName = 'flutterwave';
        const res = await flutterwaveService.initiateTransfer({
          amountKobo: claim.amount,
          bankCode: claim.destination.bankCode || '',
          accountNumber: claim.destination.accountNumber || '',
          accountName: claim.destination.resolvedAccountName || claim.claimantName,
          reason: `Sprinkl: ${giveaway.title}`,
          reference: claim.idempotencyKey,
        });

        payoutRef = res.transferCode || res.reference;
        rawResponse = res;
      } else if (claim.currency === 'USDT') {
        providerName = claim.destination.chain === 'BEP20' ? 'bsc' : 'tron';
        const res = await cryptoService.sendUsdtPayout({
          destinationAddress: claim.destination.walletAddress || '',
          amountUsdtInteger: claim.amount,
          chain: claim.destination.chain || 'TRC20',
          reference: claim.idempotencyKey,
        });

        payoutRef = res.txHash;
        rawResponse = res;
      }

      claim.status = 'paid';
      claim.payoutReference = payoutRef;
      await claim.save();

      await LedgerService.debitPayout({
        userId: hostId,
        currency: claim.currency,
        amount: claim.amount,
        claimId: claim._id,
      });

      await Transaction.create({
        user: hostId,
        relatedClaim: claim._id,
        provider: providerName,
        providerReference: payoutRef || claim.idempotencyKey,
        direction: 'outbound',
        currency: claim.currency,
        amount: claim.amount,
        status: 'success',
        rawPayload: rawResponse,
      });

      await Giveaway.findByIdAndUpdate(giveaway._id, {
        $inc: { 'stats.totalDistributed': claim.amount },
      });

      if (giveaway.slotsClaimed >= giveaway.totalSlots) {
        await Giveaway.findByIdAndUpdate(giveaway._id, { status: 'completed' });
      }

      console.log(`[PayoutWorker] Claim ${claimId} successfully paid! Ref: ${payoutRef}`);
      return claim;
    } catch (err: any) {
      console.error(`[PayoutWorker] Payout failed for Claim ${claimId}:`, err.message);

      claim.status = 'failed';
      claim.failureReason = err.message;
      await claim.save();

      await Giveaway.findByIdAndUpdate(giveaway._id, {
        $inc: { 'stats.failedClaimAttempts': 1 },
      });

      throw err;
    }
  }

  static async enqueuePayout(claimId: string) {
    setImmediate(async () => {
      try {
        await PayoutWorker.processPayout(claimId);
      } catch (e: any) {
        console.error(`[PayoutWorker Background Queue Error]`, e.message);
      }
    });
  }
}

export default PayoutWorker;
