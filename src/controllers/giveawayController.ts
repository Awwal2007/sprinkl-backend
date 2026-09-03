import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import Giveaway from '../models/Giveaway';
import Claim from '../models/Claim';
import LedgerService from '../services/ledgerService';
import WalletAccount from '../models/WalletAccount';
import { AuthRequest } from '../middleware/auth';

const createGiveawaySchema = z.object({
  title: z.string().min(3).max(120),
  description: z.string().max(2000).optional(),
  coverImageUrl: z.string().optional(),
  currency: z.enum(['NGN', 'USDT']),
  amountPerRecipient: z.number().positive(),
  totalSlots: z.number().int().min(1),
  expiresAt: z.string().optional(),
  settings: z
    .object({
      restrictFirstTimeClaimantsOnly: z.boolean().default(false),
      requirePhoneOtp: z.boolean().default(false),
      successMessage: z.string().max(300).optional(),
    })
    .optional(),
});

export const createGiveaway = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const data = createGiveawaySchema.parse(req.body);
    const userId = req.user!._id;

    let amountPerRecipientSmallest = 0;
    if (data.currency === 'NGN') {
      amountPerRecipientSmallest = Math.round(data.amountPerRecipient * 100);
    } else {
      amountPerRecipientSmallest = Math.round(data.amountPerRecipient * 1000000);
    }

    // A. Minimum Amount Per Winner Check
    if (data.currency === 'NGN' && data.amountPerRecipient < 300) {
      await session.abortTransaction();
      return res.status(400).json({
        error: 'Minimum payout per winner is ₦300 NGN.',
      });
    }
    if (data.currency === 'USDT' && data.amountPerRecipient < 0.2) {
      await session.abortTransaction();
      return res.status(400).json({
        error: 'Minimum payout per winner is $0.20 USDT to cover blockchain transfer gas.',
      });
    }

    // B. Platform Fee & Whale Tier Logic
    // - New Creator Privilege: First 3 giveaways charged only 2.5% (floor: ₦250 / $0.50 USDT)
    // - Standard: 5.0% (floor: ₦500 / $1.00 USDT)
    // - Whale Tier: >= ₦1,000,000 ($1,000 USDT) drops fee to 3.0%, capped at ₦35,000 ($35 USDT max)
    const pastGiveawaysCount = await Giveaway.countDocuments({ host: userId }).session(session);
    const isPromo = pastGiveawaysCount < 3;
    let feeRate = isPromo ? 0.025 : 0.05;

    const giftPoolSmallest = amountPerRecipientSmallest * data.totalSlots;
    let minFee = 0;
    let maxFee = Infinity;
    let isWhaleTier = false;

    if (data.currency === 'NGN') {
      minFee = isPromo ? 25000 : 50000; // ₦250 or ₦500 floor
      if (giftPoolSmallest >= 100000000) { // >= ₦1,000,000
        isWhaleTier = true;
        feeRate = 0.03;
        maxFee = 3500000; // Capped at ₦35,000 max
      }
    } else {
      minFee = isPromo ? 500000 : 1000000; // $0.50 or $1.00 USDT floor
      if (giftPoolSmallest >= 1000000000) { // >= $1,000 USDT
        isWhaleTier = true;
        feeRate = 0.03;
        maxFee = 35000000; // Capped at $35 USDT max
      }
    }

    let platformFee = Math.round(giftPoolSmallest * feeRate);
    platformFee = Math.max(minFee, platformFee);
    platformFee = Math.min(maxFee, platformFee);
    const totalRequired = giftPoolSmallest + platformFee;

    // Check host's available balance
    const wallet = await LedgerService.getOrCreateWallet(userId, data.currency, session);
    if (wallet.available < totalRequired) {
      await session.abortTransaction();
      const factor = data.currency === 'NGN' ? 100 : 1000000;
      return res.status(400).json({
        error: `Insufficient ${data.currency} balance. Total required: ${(totalRequired / factor).toLocaleString()} (Gift: ${(giftPoolSmallest / factor).toLocaleString()} + Fee: ${(platformFee / factor).toLocaleString()}), Available: ${(wallet.available / factor).toLocaleString()}`,
      });
    }

    const slug = nanoid(10);
    const giveawayIdPlaceholder = new mongoose.Types.ObjectId();

    // 1. Reserve exact gift pool for claimant payouts
    await LedgerService.reserveForGiveaway(
      {
        userId,
        currency: data.currency,
        amount: giftPoolSmallest,
        giveawayId: giveawayIdPlaceholder,
      },
      session
    );

    // 2. Collect platform fee from available balance
    if (platformFee > 0) {
      await LedgerService.deductPlatformFee(
        {
          userId,
          currency: data.currency,
          amount: platformFee,
          giveawayId: giveawayIdPlaceholder,
        },
        session
      );
    }

    const giveaway = new Giveaway({
      _id: giveawayIdPlaceholder,
      host: userId,
      title: data.title,
      description: data.description || '',
      coverImageUrl: data.coverImageUrl || '',
      slug,
      currency: data.currency,
      amountPerRecipient: amountPerRecipientSmallest,
      totalSlots: data.totalSlots,
      totalReservedAmount: giftPoolSmallest,
      platformFee,
      status: 'active',
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      settings: data.settings || {},
    });

    await giveaway.save({ session });

    await session.commitTransaction();

    return res.status(201).json({
      message: 'Giveaway created successfully',
      giveaway: {
        id: giveaway._id,
        slug: giveaway.slug,
        title: giveaway.title,
        currency: giveaway.currency,
        amountPerRecipient: data.amountPerRecipient,
        totalSlots: giveaway.totalSlots,
        totalReservedAmount: giveaway.totalReservedAmount,
        platformFee: giveaway.platformFee,
        feeRatePercent: feeRate * 100,
        isPromo,
        isWhaleTier,
        status: giveaway.status,
        publicUrl: `${process.env.DOMAIN || 'https://sprinkl.biz'}/g/${giveaway.slug}`,
      },
    });
  } catch (err: any) {
    await session.abortTransaction();
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: err.errors[0].message });
    }
    next(err);
  } finally {
    session.endSession();
  }
};

export const getHostGiveaways = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const giveaways = await Giveaway.find({ host: req.user!._id }).sort({ createdAt: -1 });
    return res.json({ giveaways });
  } catch (err) {
    next(err);
  }
};

export const getHostGiveawayById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const giveaway = await Giveaway.findOne({
      _id: req.params.id,
      host: req.user!._id,
    });

    if (!giveaway) {
      return res.status(404).json({ error: 'Giveaway not found' });
    }

    const claims = await Claim.find({ giveaway: giveaway._id })
      .sort({ createdAt: -1 })
      .limit(100);

    return res.json({ giveaway, claims });
  } catch (err) {
    next(err);
  }
};

export const cancelGiveaway = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const giveaway = await Giveaway.findOne({
      _id: req.params.id,
      host: req.user!._id,
      status: { $in: ['active', 'paused'] },
    }).session(session);

    if (!giveaway) {
      return res.status(404).json({ error: 'Active giveaway not found' });
    }

    // Count only successfully paid claims to calculate how much was actually disbursed
    const paidClaimsCount = await Claim.countDocuments({
      giveaway: giveaway._id,
      status: 'paid',
    }).session(session);

    // Amount actually disbursed from the reserved pool
    const amountDisbursed = paidClaimsCount * giveaway.amountPerRecipient;
    // Amount that should still be reserved = original pool minus what was paid out
    const theoreticalUnspent = Math.max(0, giveaway.totalReservedAmount - amountDisbursed);

    if (theoreticalUnspent > 0) {
      // Read actual wallet reserved to prevent over-releasing
      const wallet = await WalletAccount.findOne({
        user: req.user!._id,
        currency: giveaway.currency,
      }).session(session);

      const actualReserved = wallet?.reserved ?? 0;
      // Never release more than what the wallet actually has reserved
      const unspentAmount = Math.min(theoreticalUnspent, actualReserved);

      if (unspentAmount > 0) {
        const unclaimedSlots = Math.round(unspentAmount / giveaway.amountPerRecipient);
        await LedgerService.releaseReservedFunds(
          {
            userId: req.user!._id,
            currency: giveaway.currency,
            amount: unspentAmount,
            giveawayId: giveaway._id,
            status: 'cancelled',
            note: `Cancelled Giveaway "${giveaway.title}": ${unclaimedSlots} unclaimed slot(s) refunded`,
          },
          session
        );
      }

      giveaway.status = 'cancelled';
      await giveaway.save({ session });

      await session.commitTransaction();

      return res.json({
        message: 'Giveaway cancelled. Unspent funds released back to your wallet.',
        giveaway,
        refundedAmount: unspentAmount,
      });
    }

    // All slots were already paid — nothing to refund, just cancel
    giveaway.status = 'cancelled';
    await giveaway.save({ session });

    await session.commitTransaction();

    return res.json({
      message: 'Giveaway cancelled. No unspent funds to refund (all slots were paid).',
      giveaway,
      refundedAmount: 0,
    });
  } catch (err) {
    await session.abortTransaction();
    next(err);
  } finally {
    session.endSession();
  }
};
