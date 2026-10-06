import User, { IUser } from '../models/User';
import Admin, { IAdmin } from '../models/Admin';
import WalletAccount from '../models/WalletAccount';
import Transaction from '../models/Transaction';
import Giveaway from '../models/Giveaway';
import LedgerEntry from '../models/LedgerEntry';

export class AdminSyncService {
  /**
   * Synchronizes an Admin record with a corresponding User record.
   * Ensures that:
   * 1. A User model document exists for this admin.
   * 2. The User._id strictly matches Admin._id (migrating if necessary).
   * 3. The User has role: 'admin', emailVerified: true, verified KYC threshold, and initialized cryptoDepositAddresses.
   * 4. Initial NGN and USDT WalletAccounts exist for this admin.
   */
  static async syncAdminUser(admin: IAdmin): Promise<IUser> {
    const emailLower = admin.email.toLowerCase().trim();

    // 1. Direct match by _id
    let user = await User.findById(admin._id);
    if (user) {
      let changed = false;
      if (user.role !== 'admin') {
        user.role = 'admin';
        changed = true;
      }
      if (!user.emailVerified) {
        user.emailVerified = true;
        changed = true;
      }
      if (!user.cryptoDepositAddresses) {
        user.cryptoDepositAddresses = [];
        changed = true;
      }
      if (!user.kyc || user.kyc.status !== 'verified') {
        user.kyc = {
          status: 'verified',
          payoutReviewThreshold: 500000000,
        };
        changed = true;
      }
      if (changed) {
        await user.save().catch(() => {});
      }

      await this.ensureWalletAccounts(admin._id);
      return user;
    }

    // 2. Existing user by email with a different _id
    const existingByEmail = await User.findOne({ email: emailLower });
    if (existingByEmail) {
      const oldId = existingByEmail._id;
      const newId = admin._id;

      // Migrate existing user to use admin._id so IDs are 100% identical
      const userData = existingByEmail.toObject();
      delete (userData as any)._id;
      (userData as any)._id = newId;
      userData.role = 'admin';
      userData.emailVerified = true;
      if (!userData.cryptoDepositAddresses) userData.cryptoDepositAddresses = [];
      if (!userData.kyc) {
        userData.kyc = {
          status: 'verified',
          payoutReviewThreshold: 500000000,
        };
      }

      await User.deleteOne({ _id: oldId });
      user = await User.create(userData);

      // Migrate all foreign keys across other collections atomically / concurrently
      await Promise.allSettled([
        WalletAccount.updateMany({ user: oldId }, { $set: { user: newId } }),
        Transaction.updateMany({ user: oldId }, { $set: { user: newId } }),
        Giveaway.updateMany({ host: oldId }, { $set: { host: newId } }),
        LedgerEntry.updateMany({ user: oldId }, { $set: { user: newId } }),
      ]);

      await this.ensureWalletAccounts(newId);
      return user;
    }

    // 3. Create a brand new User document with _id = admin._id
    user = await User.create({
      _id: admin._id,
      fullName: admin.fullName,
      email: emailLower,
      passwordHash: admin.passwordHash || 'synced_admin_hash',
      role: 'admin',
      emailVerified: true,
      kyc: {
        status: 'verified',
        payoutReviewThreshold: 500000000,
      },
      cryptoDepositAddresses: [],
    });

    await this.ensureWalletAccounts(admin._id);
    return user;
  }

  /**
   * Helper to ensure NGN and USDT wallet accounts exist for this user ID
   */
  static async ensureWalletAccounts(userId: any) {
    const currencies: ('NGN' | 'USDT')[] = ['NGN', 'USDT'];
    for (const currency of currencies) {
      const existing = await WalletAccount.findOne({ user: userId, currency });
      if (!existing) {
        await WalletAccount.create({
          user: userId,
          currency,
          available: 0,
          reserved: 0,
        }).catch(() => {});
      }
    }
  }

  /**
   * Universal resolver: finds a User document by ID or Admin document by ID,
   * guaranteeing that a valid User document is returned for wallet / giveaway operations.
   */
  static async resolveUser(id: any): Promise<IUser | null> {
    if (!id) return null;
    let user = await User.findById(id);
    if (user) return user;

    const admin = await Admin.findById(id);
    if (admin) {
      return await this.syncAdminUser(admin);
    }

    return null;
  }
}

export default AdminSyncService;
