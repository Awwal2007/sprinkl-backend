import { Schema, model, Document, Types } from 'mongoose';

export interface ICryptoDepositAddress {
  chain: 'TRC20' | 'BEP20';
  address: string;
  createdAt: Date;
}

export interface IUser extends Document {
  _id: Types.ObjectId;
  fullName: string;
  email: string;
  phone?: string;
  passwordHash: string;
  role: 'host' | 'admin';
  emailVerified: boolean;
  verificationToken?: string;
  verificationTokenExpires?: Date;
  passwordResetToken?: string;
  passwordResetExpires?: Date;
  kyc: {
    status: 'none' | 'pending' | 'verified' | 'rejected';
    payoutReviewThreshold: number;
  };
  cryptoDepositAddresses: ICryptoDepositAddress[];
  paystackCustomerCode?: string;
  paystackDvaAccountNumber?: string;
  paystackDvaBankName?: string;
  refreshTokenHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
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
    verificationToken: { type: String, select: false },
    verificationTokenExpires: { type: Date, select: false },
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },

    kyc: {
      status: {
        type: String,
        enum: ['none', 'pending', 'verified', 'rejected'],
        default: 'none',
      },
      payoutReviewThreshold: { type: Number, default: 500000 },
    },

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

export default model<IUser>('User', userSchema);
