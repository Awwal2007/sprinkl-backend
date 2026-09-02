const mongoose = require('mongoose');
const WalletAccount = require('../models/WalletAccount');
const LedgerEntry = require('../models/LedgerEntry');

class LedgerService {
  /**
   * Get or create a WalletAccount for a user & currency
   */
  static async getOrCreateWallet(userId, currency, session = null) {
    let wallet = await WalletAccount.findOne({ user: userId, currency }).session(session);
    if (!wallet) {
      wallet = new WalletAccount({ user: userId, currency, available: 0, reserved: 0 });
      await wallet.save({ session });
    }
    return wallet;
  }

  /**
   * Credit user wallet (e.g. Paystack DVA webhook or USDT deposit)
   */
  static async creditWallet({ userId, currency, amount, referenceType, referenceId }, externalSession = null) {
    const session = externalSession || await mongoose.startSession();
    const isLocalSession = !externalSession;
    if (isLocalSession) session.startTransaction();

    try {
      const wallet = await this.getOrCreateWallet(userId, currency, session);

      wallet.available += amount;
      wallet.version += 1;
      await wallet.save({ session });

      const ledgerEntry = new LedgerEntry({
        user: userId,
        currency,
        type: 'fund',
        amount,
        direction: 'credit',
        referenceType,
        referenceId,
        balanceAfter: wallet.available + wallet.reserved,
      });

      await ledgerEntry.save({ session });

      if (isLocalSession) await session.commitTransaction();
      return wallet;
    } catch (err) {
      if (isLocalSession) await session.abortTransaction();
      throw err;
    } finally {
      if (isLocalSession) session.endSession();
    }
  }

  /**
   * Reserve funds for a newly created Giveaway.
   * Lock funds from available -> reserved.
   */
  static async reserveForGiveaway({ userId, currency, amount, giveawayId }, externalSession = null) {
    const session = externalSession || await mongoose.startSession();
    const isLocalSession = !externalSession;
    if (isLocalSession) session.startTransaction();

    try {
      const wallet = await this.getOrCreateWallet(userId, currency, session);

      if (wallet.available < amount) {
        throw new Error(`Insufficient ${currency} balance. Required: ${amount}, Available: ${wallet.available}`);
      }

      wallet.available -= amount;
      wallet.reserved += amount;
      wallet.version += 1;
      await wallet.save({ session });

      const ledgerEntry = new LedgerEntry({
        user: userId,
        currency,
        type: 'reserve',
        amount,
        direction: 'debit',
        referenceType: 'Giveaway',
        referenceId: giveawayId,
        balanceAfter: wallet.available + wallet.reserved,
      });

      await ledgerEntry.save({ session });

      if (isLocalSession) await session.commitTransaction();
      return wallet;
    } catch (err) {
      if (isLocalSession) await session.abortTransaction();
      throw err;
    } finally {
      if (isLocalSession) session.endSession();
    }
  }

  /**
   * Release reserved funds back to available (e.g. Giveaway cancelled or expired)
   */
  static async releaseReservedFunds({ userId, currency, amount, giveawayId }, externalSession = null) {
    const session = externalSession || await mongoose.startSession();
    const isLocalSession = !externalSession;
    if (isLocalSession) session.startTransaction();

    try {
      const wallet = await this.getOrCreateWallet(userId, currency, session);

      const releaseAmount = Math.min(wallet.reserved, amount);
      wallet.reserved -= releaseAmount;
      wallet.available += releaseAmount;
      wallet.version += 1;
      await wallet.save({ session });

      const ledgerEntry = new LedgerEntry({
        user: userId,
        currency,
        type: 'release',
        amount: releaseAmount,
        direction: 'credit',
        referenceType: 'Giveaway',
        referenceId: giveawayId,
        balanceAfter: wallet.available + wallet.reserved,
      });

      await ledgerEntry.save({ session });

      if (isLocalSession) await session.commitTransaction();
      return wallet;
    } catch (err) {
      if (isLocalSession) await session.abortTransaction();
      throw err;
    } finally {
      if (isLocalSession) session.endSession();
    }
  }

  /**
   * Debit reserved funds upon successful claim payout
   */
  static async debitPayout({ userId, currency, amount, claimId }, externalSession = null) {
    const session = externalSession || await mongoose.startSession();
    const isLocalSession = !externalSession;
    if (isLocalSession) session.startTransaction();

    try {
      const wallet = await this.getOrCreateWallet(userId, currency, session);

      wallet.reserved = Math.max(0, wallet.reserved - amount);
      wallet.version += 1;
      await wallet.save({ session });

      const ledgerEntry = new LedgerEntry({
        user: userId,
        currency,
        type: 'payout',
        amount,
        direction: 'debit',
        referenceType: 'Claim',
        referenceId: claimId,
        balanceAfter: wallet.available + wallet.reserved,
      });

      await ledgerEntry.save({ session });

      if (isLocalSession) await session.commitTransaction();
      return wallet;
    } catch (err) {
      if (isLocalSession) await session.abortTransaction();
      throw err;
    } finally {
      if (isLocalSession) session.endSession();
    }
  }

  /**
   * Reconcile cached balance vs LedgerEntry sum for audit integrity check
   */
  static async reconcileUserWallet(userId, currency) {
    const wallet = await WalletAccount.findOne({ user: userId, currency });
    if (!wallet) return { valid: true, cachedTotal: 0, ledgerTotal: 0, drift: 0 };

    const entries = await LedgerEntry.find({ user: userId, currency });
    let ledgerTotal = 0;
    for (const entry of entries) {
      if (entry.direction === 'credit') {
        ledgerTotal += entry.amount;
      } else if (entry.direction === 'debit') {
        ledgerTotal -= entry.amount;
      }
    }

    const cachedTotal = wallet.available + wallet.reserved;
    const drift = cachedTotal - ledgerTotal;

    return {
      valid: drift === 0,
      cachedTotal,
      ledgerTotal,
      drift,
    };
  }
}

module.exports = LedgerService;
