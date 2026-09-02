import { Schema, model, Document, Types } from 'mongoose';

export interface IWalletAccount extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  currency: 'NGN' | 'USDT';
  available: number;
  reserved: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const walletAccountSchema = new Schema<IWalletAccount>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    currency: { type: String, enum: ['NGN', 'USDT'], required: true },

    available: { type: Number, default: 0, min: 0 },
    reserved: { type: Number, default: 0, min: 0 },

    version: { type: Number, default: 0 },
  },
  { timestamps: true }
);

walletAccountSchema.index({ user: 1, currency: 1 }, { unique: true });

export default model<IWalletAccount>('WalletAccount', walletAccountSchema);
