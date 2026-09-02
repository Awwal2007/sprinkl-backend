const Claim = require('../models/Claim');
const Giveaway = require('../models/Giveaway');
const Transaction = require('../models/Transaction');
const LedgerService = require('../services/ledgerService');
const paystackService = require('../services/paystackService');
const cryptoService = require('../services/cryptoService');

class PayoutWorker {
  /**
   * Process payout for a single Claim
   */
  static async processPayout(claimId) {
    const claim = await Claim.findById(claimId).populate('giveaway');
    if (!claim) {
      console.error(`[PayoutWorker] Claim not found: ${claimId}`);
      return;
    }

    // Idempotency check: if already paid or processing, skip
    if (claim.status === 'paid') {
      console.log(`[PayoutWorker] Claim ${claimId} already paid, skipping.`);
      return claim;
    }

    claim.status = 'processing';
    await claim.save();

    const giveaway = claim.giveaway;
    const hostId = giveaway.host;

    try {
      let payoutRef = null;
      let rawResponse = null;
      let providerName = 'paystack';

      if (claim.currency === 'NGN') {
        providerName = 'paystack';
        // Execute Paystack Transfer
        const res = await paystackService.initiateTransfer({
          amountKobo: claim.amount,
          bankCode: claim.destination.bankCode,
          accountNumber: claim.destination.accountNumber,
          accountName: claim.destination.resolvedAccountName || claim.claimantName,
          reason: `GiveHub: ${giveaway.title}`,
          reference: claim.idempotencyKey,
        });

        payoutRef = res.transferCode || res.reference;
        rawResponse = res;
      } else if (claim.currency === 'USDT') {
        providerName = claim.destination.chain === 'BEP20' ? 'bsc' : 'tron';
        // Execute Crypto Outbound Transfer
        const res = await cryptoService.sendUsdtPayout({
          destinationAddress: claim.destination.walletAddress,
          amountUsdtInteger: claim.amount,
          chain: claim.destination.chain || 'TRC20',
          reference: claim.idempotencyKey,
        });

        payoutRef = res.txHash;
        rawResponse = res;
      }

      // Mark Claim as paid
      claim.status = 'paid';
      claim.payoutReference = payoutRef;
      await claim.save();

      // Record Ledger Payout Debit
      await LedgerService.debitPayout({
        userId: hostId,
        currency: claim.currency,
        amount: claim.amount,
        claimId: claim._id,
      });

      // Record Provider Audit Transaction
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

      // Update Giveaway stats
      await Giveaway.findByIdAndUpdate(giveaway._id, {
        $inc: { 'stats.totalDistributed': claim.amount },
      });

      // Check if giveaway completed
      if (giveaway.slotsClaimed >= giveaway.totalSlots) {
        await Giveaway.findByIdAndUpdate(giveaway._id, { status: 'completed' });
      }

      console.log(`[PayoutWorker] Claim ${claimId} successfully paid! Ref: ${payoutRef}`);
      return claim;
    } catch (err) {
      console.error(`[PayoutWorker] Payout failed for Claim ${claimId}:`, err.message);

      claim.status = 'failed';
      claim.failureReason = err.message;
      await claim.save();

      // Increment failed claim attempts stat on Giveaway
      await Giveaway.findByIdAndUpdate(giveaway._id, {
        $inc: { 'stats.failedClaimAttempts': 1 },
      });

      throw err;
    }
  }

  /**
   * Queue job helper (processes synchronously or async)
   */
  static async enqueuePayout(claimId) {
    // Immediate execution for instant feedback, can be swapped with BullMQ queue
    setImmediate(async () => {
      try {
        await PayoutWorker.processPayout(claimId);
      } catch (e) {
        console.error(`[PayoutWorker Background Queue Error]`, e.message);
      }
    });
  }
}

module.exports = PayoutWorker;
