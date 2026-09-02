const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * One WalletAccount per (user, currency) pair. `available` is what the
 * host can spend right now; `reserved` is funds locked against active
 * giveaways. available + reserved should always reconcile against the
 * sum of that user's LedgerEntry rows for this currency — treat any
 * drift between the cached balance here and the ledger sum as a bug
 * to alert on, not something to silently trust.
 */
const walletAccountSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    currency: { type: String, enum: ['NGN', 'USDT'], required: true },

    available: { type: Number, default: 0, min: 0 }, // smallest unit (kobo or USDT 6-dec integer)
    reserved: { type: Number, default: 0, min: 0 },

    version: { type: Number, default: 0 }, // optimistic-lock guard for concurrent updates
  },
  { timestamps: true }
);

walletAccountSchema.index({ user: 1, currency: 1 }, { unique: true });

module.exports = mongoose.model('WalletAccount', walletAccountSchema);
