const mongoose = require('mongoose');
const { Schema } = mongoose;

const ledgerEntrySchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    currency: { type: String, enum: ['NGN', 'USDT'], required: true },

    type: {
      type: String,
      enum: [
        'fund',            // wallet funded (Paystack DVA or crypto deposit)
        'reserve',         // funds locked when a giveaway is created
        'release',         // reserved funds returned (cancelled/expired giveaway)
        'payout',          // funds paid out to a claimant, debited from reserved
        'refund',          // payout failed after debit, funds restored
        'platform_fee',    // fee charged to host
      ],
      required: true,
    },

    amount: { type: Number, required: true }, // always positive; `direction` gives sign
    direction: { type: String, enum: ['credit', 'debit'], required: true },

    referenceType: {
      type: String,
      enum: ['Giveaway', 'Claim', 'PaystackTransaction', 'CryptoDeposit'],
      required: true,
    },
    referenceId: { type: Schema.Types.ObjectId, required: true },

    balanceAfter: { type: Number, required: true }, // snapshot for fast audit reads
  },
  { timestamps: true }
);

// Ledger rows are never updated or deleted in application code — only inserted.
ledgerEntrySchema.index({ user: 1, currency: 1, createdAt: -1 });

module.exports = mongoose.model('LedgerEntry', ledgerEntrySchema);
