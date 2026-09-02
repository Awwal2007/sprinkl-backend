import mongoose, { ClientSession, Types } from 'mongoose';
import WalletAccount, { IWalletAccount } from '../models/WalletAccount';
import LedgerEntry, { LedgerEntryType } from '../models/LedgerEntry';

export interface ICreditWalletParams {
  userId: Types.ObjectId | string;
  currency: 'NGN' | 'USDT';
  amount: number;
  referenceType: 'Giveaway' | 'Claim' | 'PaystackTransaction' | 'CryptoDeposit';
  referenceId: Types.ObjectId | string;
}

export interface IReserveFundsParams {
  userId: Types.ObjectId | string;
  currency: 'NGN' | 'USDT';
  amount: number;
  giveawayId: Types.ObjectId | string;
}

export interface IPayoutParams {
  userId: Types.ObjectId | string;
  currency: 'NGN' | 'USDT';
  amount: number;
  claimId: Types.ObjectId | string;
}

export class LedgerService {
  /**
   * Get or create a WalletAccount for a user & currency
   */
  static async getOrCreateWallet(
    userId: Types.ObjectId | string,
    currency: 'NGN' | 'USDT',
    session: ClientSession | null = null
  ): Promise<IWalletAccount> {
    let wallet = await WalletAccount.findOne({ user: userId, currency }).session(session);
    if (!wallet) {
      wallet = new WalletAccount({ user: userId, currency, available: 0, reserved: 0 });
      await wallet.save({ session });
    }
    return wallet;
  }

  /**
   * Credit user wallet (e.g. Flutterwave DVA webhook or USDT deposit)
   */
  static async creditWallet(
    params: ICreditWalletParams,
    externalSession: ClientSession | null = null
  ): Promise<IWalletAccount> {
    const session = externalSession || (await mongoose.startSession());
    const isLocalSession = !externalSession;
    if (isLocalSession) session.startTransaction();

    try {
      const wallet = await this.getOrCreateWallet(params.userId, params.currency, session);

      wallet.available += params.amount;
      wallet.version += 1;
      await wallet.save({ session });

      const ledgerEntry = new LedgerEntry({
        user: params.userId,
        currency: params.currency,
        type: 'fund' as LedgerEntryType,
        amount: params.amount,
        direction: 'credit',
        referenceType: params.referenceType,
        referenceId: params.referenceId,
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
  static async reserveForGiveaway(
    params: IReserveFundsParams,
    externalSession: ClientSession | null = null
  ): Promise<IWalletAccount> {
    const session = externalSession || (await mongoose.startSession());
    const isLocalSession = !externalSession;
    if (isLocalSession) session.startTransaction();

    try {
      const wallet = await this.getOrCreateWallet(params.userId, params.currency, session);

      if (wallet.available < params.amount) {
        throw new Error(
          `Insufficient ${params.currency} balance. Required: ${params.amount}, Available: ${wallet.available}`
        );
      }

      wallet.available -= params.amount;
      wallet.reserved += params.amount;
      wallet.version += 1;
      await wallet.save({ session });

      const ledgerEntry = new LedgerEntry({
        user: params.userId,
        currency: params.currency,
        type: 'reserve' as LedgerEntryType,
        amount: params.amount,
        direction: 'debit',
        referenceType: 'Giveaway',
        referenceId: params.giveawayId,
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
  static async releaseReservedFunds(
    params: IReserveFundsParams,
    externalSession: ClientSession | null = null
  ): Promise<IWalletAccount> {
    const session = externalSession || (await mongoose.startSession());
    const isLocalSession = !externalSession;
    if (isLocalSession) session.startTransaction();

    try {
      const wallet = await this.getOrCreateWallet(params.userId, params.currency, session);

      const releaseAmount = Math.min(wallet.reserved, params.amount);
      wallet.reserved -= releaseAmount;
      wallet.available += releaseAmount;
      wallet.version += 1;
      await wallet.save({ session });

      const ledgerEntry = new LedgerEntry({
        user: params.userId,
        currency: params.currency,
        type: 'release' as LedgerEntryType,
        amount: releaseAmount,
        direction: 'credit',
        referenceType: 'Giveaway',
        referenceId: params.giveawayId,
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
  static async debitPayout(
    params: IPayoutParams,
    externalSession: ClientSession | null = null
  ): Promise<IWalletAccount> {
    const session = externalSession || (await mongoose.startSession());
    const isLocalSession = !externalSession;
    if (isLocalSession) session.startTransaction();

    try {
      const wallet = await this.getOrCreateWallet(params.userId, params.currency, session);

      wallet.reserved = Math.max(0, wallet.reserved - params.amount);
      wallet.version += 1;
      await wallet.save({ session });

      const ledgerEntry = new LedgerEntry({
        user: params.userId,
        currency: params.currency,
        type: 'payout' as LedgerEntryType,
        amount: params.amount,
        direction: 'debit',
        referenceType: 'Claim',
        referenceId: params.claimId,
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
  static async reconcileUserWallet(userId: Types.ObjectId | string, currency: 'NGN' | 'USDT') {
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

export default LedgerService;
