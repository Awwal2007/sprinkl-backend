import Claim from '../models/Claim';
import Giveaway from '../models/Giveaway';
import Transaction from '../models/Transaction';
import LedgerEntry from '../models/LedgerEntry';
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

      const beneficiaryName =
        claim.destination?.resolvedAccountName ||
        claim.claimantName ||
        (claim.currency === 'USDT' ? 'Crypto Claimant' : 'Bank Claimant');
      const beneficiaryAccount =
        claim.destination?.accountNumber || claim.destination?.walletAddress || 'N/A';
      const beneficiaryBank =
        claim.destination?.bankName || claim.destination?.chain || 'N/A';

      await LedgerService.debitPayout({
        userId: hostId,
        currency: claim.currency,
        amount: claim.amount,
        claimId: claim._id,
        beneficiaryName,
        beneficiaryAccount,
        beneficiaryBank,
        status: 'paid',
        note: `Payout for "${giveaway.title}"`,
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

      console.log(`[PayoutWorker] Claim ${claimId} successfully paid to ${beneficiaryName}! Ref: ${payoutRef}`);
      return claim;
    } catch (err: any) {
      console.error(`[PayoutWorker] Payout failed for Claim ${claimId}:`, err.message);

      claim.status = 'failed';
      claim.failureReason = err.message;
      // Free the destination uniqueness lock so claimant can retry
      if (claim.destination && claim.destination.normalized) {
        claim.destination.normalized = `FAILED_${Date.now()}_${claim.destination.normalized}`;
      }
      await claim.save();

      // Return the slot to the giveaway so 1 slot is NOT permanently lost
      await Giveaway.findByIdAndUpdate(giveaway._id, {
        $inc: { slotsClaimed: -1, 'stats.failedClaimAttempts': 1 },
        $set: { status: 'active' },
      });

      // Record a failed ledger entry for transparency in host ledger history
      try {
        const beneficiaryName =
          claim.destination?.resolvedAccountName ||
          claim.claimantName ||
          (claim.currency === 'USDT' ? 'Crypto Claimant' : 'Bank Claimant');
        const beneficiaryAccount =
          claim.destination?.accountNumber || claim.destination?.walletAddress || 'N/A';
        const beneficiaryBank =
          claim.destination?.bankName || claim.destination?.chain || 'N/A';

        const wallet = await LedgerService.getOrCreateWallet(hostId, claim.currency);

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
          note: `Failed Payout: ${err.message || 'Disbursement failed'}`,
        });
      } catch (ledgerErr) {
        console.error('[PayoutWorker] Failed to write failed ledger record:', ledgerErr);
      }

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
