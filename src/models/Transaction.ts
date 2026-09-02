import { Schema, model, Document, Types } from 'mongoose';

export type TransactionProvider = 'flutterwave' | 'paystack' | 'tron' | 'bsc';
export type TransactionStatus = 'pending' | 'success' | 'failed' | 'reversed';

export interface ITransaction extends Document {
  _id: Types.ObjectId;
  user?: Types.ObjectId;
  relatedClaim?: Types.ObjectId;
  provider: TransactionProvider;
  providerReference: string;
  direction: 'inbound' | 'outbound';
  currency: 'NGN' | 'USDT';
  amount: number;
  status: TransactionStatus;
  rawPayload?: any;
  createdAt: Date;
  updatedAt: Date;
}

const transactionSchema = new Schema<ITransaction>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    relatedClaim: { type: Schema.Types.ObjectId, ref: 'Claim' },

    provider: {
      type: String,
      enum: ['flutterwave', 'paystack', 'tron', 'bsc'],
      required: true,
    },
    providerReference: { type: String, required: true, index: true },

    direction: { type: String, enum: ['inbound', 'outbound'], required: true },
    currency: { type: String, enum: ['NGN', 'USDT'], required: true },
    amount: { type: Number, required: true },

    status: {
      type: String,
      enum: ['pending', 'success', 'failed', 'reversed'],
      default: 'pending',
    },

    rawPayload: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

transactionSchema.index({ provider: 1, providerReference: 1 }, { unique: true });

export default model<ITransaction>('Transaction', transactionSchema);
