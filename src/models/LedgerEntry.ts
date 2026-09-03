import { Schema, model, Document, Types } from 'mongoose';

export type LedgerEntryType =
  | 'fund'
  | 'reserve'
  | 'release'
  | 'payout'
  | 'refund'
  | 'platform_fee'
  | 'cancel';

export type LedgerEntryStatus =
  | 'paid'
  | 'success'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'processing'
  | 'pending';

export interface ILedgerEntry extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  currency: 'NGN' | 'USDT';
  type: LedgerEntryType;
  status: LedgerEntryStatus;
  amount: number;
  direction: 'credit' | 'debit';
  referenceType: 'Giveaway' | 'Claim' | 'FlutterwaveTransaction' | 'PaystackTransaction' | 'CryptoDeposit';
  referenceId: Types.ObjectId;
  balanceAfter: number;
  beneficiaryName?: string;
  beneficiaryAccount?: string;
  beneficiaryBank?: string;
  note?: string;
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
        'cancel',
      ],
      required: true,
    },

    status: {
      type: String,
      enum: ['paid', 'success', 'completed', 'failed', 'cancelled', 'processing', 'pending'],
      default: 'paid',
    },

    amount: { type: Number, required: true },
    direction: { type: String, enum: ['credit', 'debit'], required: true },

    referenceType: {
      type: String,
      enum: ['Giveaway', 'Claim', 'FlutterwaveTransaction', 'PaystackTransaction', 'CryptoDeposit'],
      required: true,
    },
    referenceId: { type: Schema.Types.ObjectId, required: true },

    balanceAfter: { type: Number, required: true },

    beneficiaryName: { type: String },
    beneficiaryAccount: { type: String },
    beneficiaryBank: { type: String },
    note: { type: String },
  },
  { timestamps: true }
);

ledgerEntrySchema.index({ user: 1, currency: 1, createdAt: -1 });

export default model<ILedgerEntry>('LedgerEntry', ledgerEntrySchema);
