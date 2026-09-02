const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Raw record of every external payment-provider interaction (Paystack or on-chain)
 */
const transactionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    relatedClaim: { type: Schema.Types.ObjectId, ref: 'Claim' },

    provider: { type: String, enum: ['paystack', 'tron', 'bsc'], required: true },
    providerReference: { type: String, required: true, index: true }, // tx hash / transfer_code

    direction: { type: String, enum: ['inbound', 'outbound'], required: true },
    currency: { type: String, enum: ['NGN', 'USDT'], required: true },
    amount: { type: Number, required: true },

    status: {
      type: String,
      enum: ['pending', 'success', 'failed', 'reversed'],
      default: 'pending',
    },

    rawPayload: { type: Schema.Types.Mixed }, // full webhook/API response for audit
  },
  { timestamps: true }
);

transactionSchema.index({ provider: 1, providerReference: 1 }, { unique: true });

module.exports = mongoose.model('Transaction', transactionSchema);
