import { Schema, model, Document, Types } from 'mongoose';

export type LedgerEntryType =
  | 'fund'
  | 'reserve'
  | 'release'
  | 'payout'
  | 'refund'
  | 'platform_fee';

export interface ILedgerEntry extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  currency: 'NGN' | 'USDT';
  type: LedgerEntryType;
  amount: number;
  direction: 'credit' | 'debit';
  referenceType: 'Giveaway' | 'Claim' | 'PaystackTransaction' | 'CryptoDeposit';
  referenceId: Types.ObjectId;
  balanceAfter: number;
  createdAt: Date;
  updatedAt: Date;
}

const ledgerEntrySchema = new Schema<ILedgerEntry>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    currency: { type: String, enum: ['NGN', 'USDT'], required: true },

    type: {
      type: String,
      enum: [
        'fund',
        'reserve',
        'release',
        'payout',
        'refund',
        'platform_fee',
      ],
      required: true,
    },

    amount: { type: Number, required: true },
    direction: { type: String, enum: ['credit', 'debit'], required: true },

    referenceType: {
      type: String,
      enum: ['Giveaway', 'Claim', 'PaystackTransaction', 'CryptoDeposit'],
      required: true,
    },
    referenceId: { type: Schema.Types.ObjectId, required: true },

    balanceAfter: { type: Number, required: true },
  },
  { timestamps: true }
);

ledgerEntrySchema.index({ user: 1, currency: 1, createdAt: -1 });

export default model<ILedgerEntry>('LedgerEntry', ledgerEntrySchema);
