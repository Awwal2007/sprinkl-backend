import { Schema, model, Document, Types } from 'mongoose';

export interface IAdminCryptoAddress {
  chain: 'TRC20' | 'BEP20';
  address: string;
  createdAt: Date;
}

export interface IAdmin extends Document {
  _id: Types.ObjectId;
  fullName: string;
  email: string;
  phone?: string;
  passwordHash: string;
  role: 'superadmin' | 'admin' | 'moderator';
  isActive: boolean;
  cryptoDepositAddresses: IAdminCryptoAddress[];
  paystackCustomerCode?: string;
  paystackDvaAccountNumber?: string;
  paystackDvaBankName?: string;
  kyc?: {
    status: 'verified';
    payoutReviewThreshold: number;
  };
  isOnline?: boolean;
  loginOtpHash?: string;
  loginOtpExpires?: Date;
  lastLoginAt?: Date;
  lastActiveAt?: Date;
  refreshTokenHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

const adminSchema = new Schema<IAdmin>(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: ['superadmin', 'admin', 'moderator'],
      default: 'admin',
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    cryptoDepositAddresses: [
      {
        chain: { type: String, enum: ['TRC20', 'BEP20'] },
        address: { type: String },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    paystackCustomerCode: { type: String },
    paystackDvaAccountNumber: { type: String },
    paystackDvaBankName: { type: String },
    kyc: {
      status: { type: String, default: 'verified' },
      payoutReviewThreshold: { type: Number, default: 500000000 },
    },
    isOnline: {
      type: Boolean,
      default: false,
    },
    loginOtpHash: {
      type: String,
      select: false,
    },
    loginOtpExpires: {
      type: Date,
      select: false,
    },
    lastLoginAt: {
      type: Date,
    },
    lastActiveAt: {
      type: Date,
      default: Date.now,
    },
    refreshTokenHash: {
      type: String,
      select: false,
    },
  },
  { timestamps: true }
);

export default model<IAdmin>('Admin', adminSchema);
