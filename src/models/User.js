const mongoose = require('mongoose');
const { Schema } = mongoose;

const userSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    phone: { type: String, trim: true },
    passwordHash: { type: String, required: true, select: false },

    role: {
      type: String,
      enum: ['host', 'admin'],
      default: 'host',
    },

    emailVerified: { type: Boolean, default: false },

    kyc: {
      status: {
        type: String,
        enum: ['none', 'pending', 'verified', 'rejected'],
        default: 'none',
      },
      // Payout volume above which manual review is triggered, per
      // compliance guidance — configurable, not hardcoded.
      payoutReviewThreshold: { type: Number, default: 500000 }, // kobo
    },

    // Crypto deposit addresses generated for this host, keyed by chain.
    cryptoDepositAddresses: [
      {
        chain: { type: String, enum: ['TRC20', 'BEP20'] },
        address: { type: String, trim: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],

    paystackCustomerCode: { type: String, trim: true },
    paystackDvaAccountNumber: { type: String, trim: true },
    paystackDvaBankName: { type: String, trim: true },

    refreshTokenHash: { type: String, select: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
