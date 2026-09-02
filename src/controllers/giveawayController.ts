import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import Giveaway from '../models/Giveaway';
import Claim from '../models/Claim';
import LedgerService from '../services/ledgerService';
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

    const platformFee = 0;
    const totalReservedAmount = amountPerRecipientSmallest * data.totalSlots + platformFee;

    const slug = nanoid(10);
    const giveawayIdPlaceholder = new mongoose.Types.ObjectId();

    await LedgerService.reserveForGiveaway(
      {
        userId,
        currency: data.currency,
        amount: totalReservedAmount,
        giveawayId: giveawayIdPlaceholder,
      },
      session
    );

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
      totalReservedAmount,
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

    const unclaimedSlots = giveaway.totalSlots - giveaway.slotsClaimed;
    const unspentAmount = unclaimedSlots * giveaway.amountPerRecipient;

    if (unspentAmount > 0) {
      await LedgerService.releaseReservedFunds(
        {
          userId: req.user!._id,
          currency: giveaway.currency,
          amount: unspentAmount,
          giveawayId: giveaway._id,
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
  } catch (err) {
    await session.abortTransaction();
    next(err);
  } finally {
    session.endSession();
  }
};
