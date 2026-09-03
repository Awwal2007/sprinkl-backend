import { Schema, model, Document, Types } from 'mongoose';

export type ClaimStatus =
  | 'pending'
  | 'processing'
  | 'paid'
  | 'failed'
  | 'rejected_duplicate';

export interface IClaimDestination {
  bankCode?: string;
  bankName?: string;
  accountNumber?: string;
  resolvedAccountName?: string;
  chain?: 'TRC20' | 'BEP20' | null;
  walletAddress?: string;
  normalized: string;
}

export interface IClaimMeta {
  ipAddress?: string;
  userAgent?: string;
  deviceFingerprint?: string;
  captchaVerified?: boolean;
  otpVerified?: boolean;
}

export interface IClaim extends Document {
  _id: Types.ObjectId;
  giveaway: Types.ObjectId;
  claimantName: string;
  claimantContact?: {
    email?: string;
    phone?: string;
  };
  currency: 'NGN' | 'USDT';
  destination: IClaimDestination;
  amount: number;
  status: ClaimStatus;
  idempotencyKey: string;
  payoutReference?: string;
  failureReason?: string;
  meta: IClaimMeta;
  createdAt: Date;
  updatedAt: Date;
}

const claimSchema = new Schema<IClaim>(
  {
    giveaway: { type: Schema.Types.ObjectId, ref: 'Giveaway', required: true, index: true },

    claimantName: { type: String, default: 'Sprinkl Claimant', trim: true, maxlength: 120 },
    claimantContact: {
      email: { type: String, trim: true, lowercase: true },
      phone: { type: String, trim: true },
    },

    currency: { type: String, enum: ['NGN', 'USDT'], required: true },

    destination: {
      bankCode: { type: String, trim: true },
      bankName: { type: String, trim: true },
      accountNumber: { type: String, trim: true },
      resolvedAccountName: { type: String, trim: true },

      chain: { type: String, enum: ['TRC20', 'BEP20', null], default: null },
      walletAddress: { type: String, trim: true },

      normalized: { type: String, required: true },
    },

    amount: { type: Number, required: true },

    status: {
      type: String,
      enum: ['pending', 'processing', 'paid', 'failed', 'rejected_duplicate'],
      default: 'pending',
      index: true,
    },

    idempotencyKey: { type: String, required: true, unique: true },

    payoutReference: { type: String, trim: true },
    failureReason: { type: String, trim: true },

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

claimSchema.index({ giveaway: 1, 'destination.normalized': 1 }, { unique: true });
claimSchema.index({ giveaway: 1, 'meta.ipAddress': 1 });
claimSchema.index({ 'destination.normalized': 1, status: 1 });

export default model<IClaim>('Claim', claimSchema);
