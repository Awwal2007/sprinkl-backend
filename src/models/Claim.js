const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Claim
 * One document per attempted/successful claim against a Giveaway.
 * The unique compound index below is the hard, database-level guarantee
 * that a given destination (bank account or wallet address) can only be
 * paid once per giveaway — this must hold even under concurrent requests.
 */
const claimSchema = new Schema(
  {
    giveaway: { type: Schema.Types.ObjectId, ref: 'Giveaway', required: true, index: true },

    claimantName: { type: String, required: true, trim: true, maxlength: 120 },
    claimantContact: {
      email: { type: String, trim: true, lowercase: true },
      phone: { type: String, trim: true },
    },

    currency: { type: String, enum: ['NGN', 'USDT'], required: true },

    destination: {
      // NGN fields
      bankCode: { type: String, trim: true },
      bankName: { type: String, trim: true },
      accountNumber: { type: String, trim: true },
      resolvedAccountName: { type: String, trim: true }, // from Paystack resolve

      // USDT fields
      chain: { type: String, enum: ['TRC20', 'BEP20', null], default: null },
      walletAddress: { type: String, trim: true },

      // Normalized value used for the uniqueness index — computed at write time
      normalized: { type: String, required: true },
    },

    amount: { type: Number, required: true },

    status: {
      type: String,
      enum: ['pending', 'processing', 'paid', 'failed', 'rejected_duplicate'],
      default: 'pending',
      index: true,
    },

    // Guards against double-processing if a background job is retried.
    idempotencyKey: { type: String, required: true, unique: true },

    payoutReference: { type: String, trim: true }, // Paystack transfer_code, or on-chain tx hash
    failureReason: { type: String, trim: true },

    // Anti-abuse metadata captured at submission time for audit/fraud review.
    meta: {
      ipAddress: { type: String },
      userAgent: { type: String },
      deviceFingerprint: { type: String },
      captchaVerified: { type: Boolean, default: false },
      otpVerified: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

// Core anti-duplicate-claim guarantee: one destination can only ever claim once per giveaway.
claimSchema.index({ giveaway: 1, 'destination.normalized': 1 }, { unique: true });

// Platform-wide restriction lookup
claimSchema.index({ 'destination.normalized': 1, status: 1 });

module.exports = mongoose.model('Claim', claimSchema);
