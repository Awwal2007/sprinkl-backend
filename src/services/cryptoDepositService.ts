import mongoose, { Types } from 'mongoose';
import Transaction from '../models/Transaction';
import User from '../models/User';
import LedgerService from './ledgerService';
import AdminSyncService from './adminSyncService';

export interface IProcessDepositParams {
  provider: 'nowpayments' | 'oxapay';
  providerReference: string;
  amountUsdtGross: number;
  rawPayload: any;
  expectedUserId?: string; // Authenticated user ID (if triggered via API request)
  orderId?: string;
  network?: string;
}

export interface IProcessDepositResult {
  success: boolean;
  credited: boolean;
  alreadyCredited?: boolean;
  amount: number;
  error?: string;
  txId?: string;
  user?: any;
}

export class CryptoDepositService {
  /**
   * Atomically verifies ownership and credits a crypto deposit.
   * Guarantees:
   * 1. Strict ownership: User A cannot claim User B's payment ID.
   * 2. Idempotency: Webhook and user polling concurrent requests cannot double-credit.
   * 3. Atomicity: Database transaction rolls back if either Transaction update or Ledger credit fails.
   */
  static async processCredit(params: IProcessDepositParams): Promise<IProcessDepositResult> {
    const { provider, providerReference, amountUsdtGross, rawPayload, expectedUserId, orderId, network } = params;

    const cleanRef = String(providerReference).trim();
    if (!cleanRef) {
      return { success: false, credited: false, amount: 0, error: 'Invalid provider reference' };
    }

    if (!amountUsdtGross || amountUsdtGross <= 0) {
      return { success: false, credited: false, amount: 0, error: 'Deposit amount must be greater than zero' };
    }

    // ── 1. OWNERSHIP VERIFICATION ──────────────────────────────────────────
    // Find pre-existing transaction record (created when invoice was generated)
    let existingTx = await Transaction.findOne({
      provider,
      providerReference: cleanRef,
    });

    let targetUserId: Types.ObjectId | null = null;

    if (existingTx && existingTx.user) {
      // If an authenticated user is polling or manually resolving, ensure they own the transaction
      if (expectedUserId && existingTx.user.toString() !== expectedUserId.toString()) {
        console.warn(
          `[Security] Ownership mismatch for tx ${cleanRef}: expected ${expectedUserId}, got ${existingTx.user}`
        );
        return {
          success: false,
          credited: false,
          amount: 0,
          error: 'This payment belongs to a different account.',
        };
      }
      targetUserId = existingTx.user;

      // If already marked success, return balance without double-crediting
      if (existingTx.status === 'success') {
        const user = await AdminSyncService.resolveUser(existingTx.user);
        return {
          success: true,
          credited: true,
          alreadyCredited: true,
          amount: existingTx.amount / 1_000_000,
          txId: existingTx._id.toString(),
          user,
        };
      }
    } else {
      // No existing transaction in database yet (e.g. direct webhook or unindexed invoice)
      // Extract target user ID from orderId: USDT_DEP_{userId}_{timestamp}
      if (orderId && typeof orderId === 'string' && orderId.startsWith('USDT_DEP_')) {
        const parts = orderId.split('_');
        const extractedId = parts[2] || parts[1];
        if (extractedId && Types.ObjectId.isValid(extractedId)) {
          if (expectedUserId && extractedId !== expectedUserId.toString()) {
            return {
              success: false,
              credited: false,
              amount: 0,
              error: 'This payment belongs to a different account.',
            };
          }
          targetUserId = new Types.ObjectId(extractedId);
        }
      }

      if (!targetUserId && expectedUserId && Types.ObjectId.isValid(expectedUserId)) {
        targetUserId = new Types.ObjectId(expectedUserId);
      }

      if (!targetUserId) {
        console.warn(`[CryptoDeposit] Target user not resolvable for reference ${cleanRef}`);
        return {
          success: false,
          credited: false,
          amount: 0,
          error: 'User account not found for this deposit invoice.',
        };
      }
    }

    // Verify user exists in system (supports both standard users and admin accounts)
    const userDoc = await AdminSyncService.resolveUser(targetUserId);
    if (!userDoc) {
      return { success: false, credited: false, amount: 0, error: 'User account does not exist.' };
    }

    // ── 2. ATOMIC STATE TRANSITION & LEDGER CREDIT ─────────────────────────
    const amountUnits = Math.round(amountUsdtGross * 1_000_000);
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Atomically transition status from { $ne: 'success' } -> 'success'
      // Only ONE concurrent execution can match this update!
      let tx = await Transaction.findOneAndUpdate(
        {
          provider,
          providerReference: cleanRef,
          status: { $ne: 'success' },
        },
        {
          $set: {
            user: targetUserId,
            status: 'success',
            amount: amountUnits,
            currency: 'USDT',
            direction: 'inbound',
            rawPayload,
          },
        },
        { session, new: true, upsert: false }
      );

      // If null, it means:
      // A) Another concurrent thread already updated it to 'success' (race loser)
      // B) Or the transaction record did not exist at all in DB
      if (!tx) {
        const checkCurrent = await Transaction.findOne({
          provider,
          providerReference: cleanRef,
        }).session(session);

        if (checkCurrent && checkCurrent.status === 'success') {
          // Concurrent race loser: already credited
          await session.abortTransaction();
          return {
            success: true,
            credited: true,
            alreadyCredited: true,
            amount: checkCurrent.amount / 1_000_000,
            txId: checkCurrent._id.toString(),
            user: userDoc,
          };
        }

        // Fresh record: create atomically
        tx = new Transaction({
          user: targetUserId,
          provider,
          providerReference: cleanRef,
          direction: 'inbound',
          currency: 'USDT',
          amount: amountUnits,
          status: 'success',
          rawPayload,
        });
        await tx.save({ session });
      }

      // Credit the ledger inside the EXACT same session
      await LedgerService.creditWallet(
        {
          userId: targetUserId,
          currency: 'USDT',
          amount: amountUnits,
          referenceType: 'CryptoDeposit',
          referenceId: tx._id,
          note: `Gross USDT Deposit (${network || 'Crypto'}) via ${provider.toUpperCase()}`,
        },
        session
      );

      await session.commitTransaction();

      console.log(
        `[CryptoDeposit Success] Credited gross $${amountUsdtGross} USDT (${amountUnits} units) to user ${userDoc.email} [${cleanRef}]`
      );

      return {
        success: true,
        credited: true,
        alreadyCredited: false,
        amount: amountUsdtGross,
        txId: tx._id.toString(),
        user: userDoc,
      };
    } catch (err: any) {
      await session.abortTransaction();
      console.error(`[CryptoDeposit Error] Failed atomic credit for ${cleanRef}:`, err.message);

      // Duplicate key error code 11000 means a parallel process inserted the ledger entry
      if (err.code === 11000) {
        return {
          success: true,
          credited: true,
          alreadyCredited: true,
          amount: amountUsdtGross,
          user: userDoc,
        };
      }

      throw err;
    } finally {
      session.endSession();
    }
  }
}

export default CryptoDepositService;
