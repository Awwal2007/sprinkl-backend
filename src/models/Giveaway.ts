import { Schema, model, Document, Types } from 'mongoose';

export type GiveawayStatus =
  | 'draft'
  | 'active'
  | 'paused'
  | 'completed'
  | 'expired'
  | 'cancelled';

export interface IGiveawaySettings {
  restrictFirstTimeClaimantsOnly?: boolean;
  requirePhoneOtp?: boolean;
  successMessage?: string;
}

export interface IGiveawayStats {
  totalDistributed: number;
  failedClaimAttempts: number;
}

export interface IGiveaway extends Document {
  _id: Types.ObjectId;
  host: Types.ObjectId;
  title: string;
  description?: string;
  coverImageUrl?: string;
  slug: string;
  currency: 'NGN' | 'USDT';
  amountPerRecipient: number;
  totalSlots: number;
  slotsClaimed: number;
  totalReservedAmount: number;
  platformFee: number;
  status: GiveawayStatus;
  expiresAt?: Date | null;
  settings?: IGiveawaySettings;
  stats: IGiveawayStats;
  slotsRemaining: number;
  createdAt: Date;
  updatedAt: Date;
}

const giveawaySchema = new Schema<IGiveaway>(
  {
    host: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 2000 },
    coverImageUrl: { type: String, trim: true },

    slug: { type: String, required: true, unique: true, index: true },

    currency: { type: String, enum: ['NGN', 'USDT'], required: true },

    amountPerRecipient: { type: Number, required: true, min: 1 },
    totalSlots: { type: Number, required: true, min: 1 },
    slotsClaimed: { type: Number, default: 0, min: 0 },

    totalReservedAmount: { type: Number, required: true },
    platformFee: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ['draft', 'active', 'paused', 'completed', 'expired', 'cancelled'],
      default: 'active',
      index: true,
    },

    expiresAt: { type: Date, default: null },

    settings: {
      restrictFirstTimeClaimantsOnly: { type: Boolean, default: false },
      requirePhoneOtp: { type: Boolean, default: false },
      successMessage: { type: String, trim: true, maxlength: 300 },
    },

    stats: {
      totalDistributed: { type: Number, default: 0 },
      failedClaimAttempts: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

giveawaySchema.index({ host: 1, status: 1, createdAt: -1 });

giveawaySchema.pre('validate', function (next) {
  if (this.slotsClaimed > this.totalSlots) {
    return next(new Error('slotsClaimed cannot exceed totalSlots'));
  }
  next();
});

giveawaySchema.virtual('slotsRemaining').get(function () {
  return this.totalSlots - this.slotsClaimed;
});

giveawaySchema.set('toJSON', { virtuals: true });

export default model<IGiveaway>('Giveaway', giveawaySchema);
