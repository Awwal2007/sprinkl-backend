const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Giveaway
 * Represents a single giveaway campaign created by a Host.
 * All monetary amounts are stored in the smallest unit of the currency
 * (kobo for NGN, and 6-decimal integer units for USDT) to avoid floating-point rounding bugs.
 */
const giveawaySchema = new Schema(
  {
    host: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 2000 },
    coverImageUrl: { type: String, trim: true },

    // Publicly shareable identifier used in the /g/:slug route.
    // Generated server-side — never derived from title alone.
    slug: { type: String, required: true, unique: true, index: true },

    currency: { type: String, enum: ['NGN', 'USDT'], required: true },

    // Stored in smallest unit (kobo for NGN, smallest USDT unit for USDT).
    amountPerRecipient: { type: Number, required: true, min: 1 },
    totalSlots: { type: Number, required: true, min: 1 },
    slotsClaimed: { type: Number, default: 0, min: 0 },

    // Total cost reserved from the host's wallet at creation time
    // (amountPerRecipient * totalSlots + platformFee).
    totalReservedAmount: { type: Number, required: true },
    platformFee: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ['draft', 'active', 'paused', 'completed', 'expired', 'cancelled'],
      default: 'active',
      index: true,
    },

    expiresAt: { type: Date, default: null },

    // Per-giveaway anti-abuse configuration, set by the host at creation.
    settings: {
      restrictFirstTimeClaimantsOnly: { type: Boolean, default: false },
      requirePhoneOtp: { type: Boolean, default: false },
      successMessage: { type: String, trim: true, maxlength: 300 },
    },

    // Denormalized counters kept in sync via application logic / transactions
    stats: {
      totalDistributed: { type: Number, default: 0 },
      failedClaimAttempts: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

// A host's dashboard commonly filters "my giveaways by status, newest first".
giveawaySchema.index({ host: 1, status: 1, createdAt: -1 });

// Defense-in-depth check
giveawaySchema.pre('validate', function (next) {
  if (this.slotsClaimed > this.totalSlots) {
    return next(new Error('slotsClaimed cannot exceed totalSlots'));
  }
  next();
});

giveawaySchema.virtual('slotsRemaining').get(function () {
  return this.totalSlots - this.slotsClaimed;
});

giveawaySchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Giveaway', giveawaySchema);
