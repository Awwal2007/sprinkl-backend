import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import Giveaway from '../models/Giveaway';
import Claim from '../models/Claim';
import flutterwaveService from '../services/flutterwaveService';
import cryptoService from '../services/cryptoService';
import PayoutWorker from '../jobs/payoutWorker';
import { getClientIp } from '../utils/ipHelper';

export { getClientIp };

const claimSchema = z.object({
  claimantName: z.string().optional(),
  claimantEmail: z.string().email().optional().or(z.literal('')),
  claimantPhone: z.string().optional(),
  bankCode: z.string().optional(),
  bankName: z.string().optional(),
  accountNumber: z.string().optional(),
  resolvedAccountName: z.string().optional(),
  chain: z.enum(['TRC20', 'BEP20']).optional(),
  walletAddress: z.string().optional(),
  deviceFingerprint: z.string().optional(),
});

export const getPublicGiveaway = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const giveaway = await Giveaway.findOne({ slug: req.params.slug }).populate(
      'host',
      'fullName email'
    );

    if (!giveaway) {
      return res.status(404).json({ error: 'Giveaway not found' });
    }

    if (giveaway.expiresAt && new Date() > new Date(giveaway.expiresAt)) {
      if (giveaway.status !== 'completed' && giveaway.status !== 'cancelled') {
        giveaway.status = 'expired';
        await giveaway.save();
      }
    }

    const isFullyClaimed =
      giveaway.status === 'completed' || giveaway.slotsClaimed >= giveaway.totalSlots;

    return res.json({
      giveaway: {
        id: giveaway._id,
        slug: giveaway.slug,
        title: giveaway.title,
        description: giveaway.description,
        coverImageUrl: giveaway.coverImageUrl,
        currency: giveaway.currency,
        amountPerRecipient: giveaway.amountPerRecipient,
        totalSlots: giveaway.totalSlots,
        slotsClaimed: giveaway.slotsClaimed,
        slotsRemaining: Math.max(0, giveaway.totalSlots - giveaway.slotsClaimed),
        status: giveaway.status,
        isFullyClaimed,
        isCancelled: giveaway.status === 'cancelled',
        isExpired: giveaway.status === 'expired',
        expiresAt: giveaway.expiresAt,
        settings: giveaway.settings,
        hostName: (giveaway.host as any)?.fullName || 'Sprinkl Host',
        seo: {
          title: `${giveaway.title} | Sprinkl`,
          description: `Claim your share of ${giveaway.currency} from ${(giveaway.host as any)?.fullName || 'Sprinkl Host'}`,
          url: `${process.env.DOMAIN || 'https://sprinkl.biz'}/g/${giveaway.slug}`,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

export const getBanks = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const banks = await flutterwaveService.getBankList();
    return res.json({ banks });
  } catch (err) {
    next(err);
  }
};

export const resolveBank = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { accountNumber, bankCode } = req.body;
    if (!accountNumber || !bankCode) {
      return res.status(400).json({ error: 'Account number and bank code are required' });
    }

    const resolved = await flutterwaveService.resolveAccount(accountNumber, bankCode);
    return res.json({ resolved });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
};



export const submitClaim = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = claimSchema.parse(req.body);
    const slug = req.params.slug;

    const giveaway = await Giveaway.findOne({ slug, status: 'active' });
    if (!giveaway) {
      return res.status(404).json({ error: 'Active giveaway not found' });
    }

    if (giveaway.slotsClaimed >= giveaway.totalSlots) {
      return res.status(400).json({ error: 'All slots for this giveaway have been claimed!' });
    }

    let normalizedDestination = '';
    let destinationObj: any = {};

    if (giveaway.currency === 'NGN') {
      if (!data.accountNumber || !data.bankCode) {
        return res
          .status(400)
          .json({ error: 'Bank account number and bank choice are required for NGN claims' });
      }
      if (data.accountNumber.length !== 10) {
        return res.status(400).json({ error: 'Nigerian bank account numbers must be 10 digits' });
      }

      normalizedDestination = `${data.bankCode}:${data.accountNumber.trim()}`;
      destinationObj = {
        bankCode: data.bankCode.trim(),
        bankName: data.bankName || '',
        accountNumber: data.accountNumber.trim(),
        resolvedAccountName: data.resolvedAccountName || data.claimantName,
        normalized: normalizedDestination,
      };
    } else if (giveaway.currency === 'USDT') {
      const chain = data.chain || 'TRC20';
      if (!data.walletAddress) {
        return res.status(400).json({ error: 'USDT wallet address is required' });
      }

      if (!cryptoService.validateAddress(data.walletAddress, chain)) {
        return res.status(400).json({ error: `Invalid ${chain} USDT wallet address format` });
      }

      normalizedDestination = cryptoService.normalizeAddress(data.walletAddress, chain);
      destinationObj = {
        chain,
        walletAddress: data.walletAddress.trim(),
        normalized: normalizedDestination,
      };
    }

    // 1. Check duplicate claim by destination (bank account or wallet address)
    const existingClaimByDest = await Claim.findOne({
      giveaway: giveaway._id,
      'destination.normalized': normalizedDestination,
      status: { $in: ['pending', 'processing', 'paid'] },
    });
    if (existingClaimByDest) {
      return res.status(409).json({
        error:
          'You have already claimed this giveaway! Each bank account or wallet address can only claim once.',
      });
    }

    // 2. Check duplicate claim by IP address (enforce one claim per IP address per giveaway)
    const clientIp = getClientIp(req);
    if (clientIp) {
      const existingClaimByIp = await Claim.findOne({
        giveaway: giveaway._id,
        'meta.ipAddress': clientIp,
        status: { $in: ['pending', 'processing', 'paid'] },
      });
      if (existingClaimByIp) {
        return res.status(409).json({
          error:
            'You have already claimed this giveaway from this network or device! Each IP address can only claim once to prevent duplicate claims.',
        });
      }
    }

    if (giveaway.settings?.restrictFirstTimeClaimantsOnly) {
      const previousClaim = await Claim.findOne({
        'destination.normalized': normalizedDestination,
        status: { $in: ['paid', 'processing', 'pending'] },
      });
      if (previousClaim) {
        return res.status(400).json({
          error:
            'This host restricted claims to first-time platform users only. Your account/wallet has claimed before.',
        });
      }
    }

    const updatedGiveaway = await Giveaway.findOneAndUpdate(
      { _id: giveaway._id, status: 'active', slotsClaimed: { $lt: giveaway.totalSlots } },
      { $inc: { slotsClaimed: 1 } },
      { new: true }
    );

    if (!updatedGiveaway) {
      return res
        .status(400)
        .json({ error: 'Sorry! The last slot was just taken by another claimant.' });
    }

    if (updatedGiveaway.slotsClaimed >= updatedGiveaway.totalSlots) {
      await Giveaway.findByIdAndUpdate(giveaway._id, { status: 'completed' });
    }

    const idempotencyKey = `CLAIM_${giveaway._id}_${normalizedDestination}_${Date.now()}`;

    let claim;
    try {
      claim = new Claim({
        giveaway: giveaway._id,
        claimantName: data.claimantName || data.resolvedAccountName || (data.walletAddress ? `${data.chain || 'USDT'} Claimant` : 'Sprinkl Claimant'),
        claimantContact: {
          email: data.claimantEmail || '',
          phone: data.claimantPhone || '',
        },
        currency: giveaway.currency,
        destination: destinationObj,
        amount: giveaway.amountPerRecipient,
        status: 'pending',
        idempotencyKey,
        meta: {
          ipAddress: clientIp || req.ip || '',
          userAgent: req.get('user-agent'),
          deviceFingerprint: data.deviceFingerprint || '',
          captchaVerified: true,
        },
      });

      await claim.save();
    } catch (dbErr: any) {
      await Giveaway.findByIdAndUpdate(giveaway._id, { $inc: { slotsClaimed: -1 } });

      if (dbErr.code === 11000) {
        return res.status(409).json({
          error:
            'You have already claimed this giveaway! Each bank account, wallet address, or IP address can only claim once.',
        });
      }
      throw dbErr;
    }

    await PayoutWorker.enqueuePayout(claim._id.toString());

    return res.status(201).json({
      message: 'Claim submitted successfully! Payout processing initiated.',
      claim: {
        id: claim._id,
        status: claim.status,
        amount: claim.amount,
        currency: claim.currency,
        idempotencyKey: claim.idempotencyKey,
        successMessage: giveaway.settings?.successMessage || 'Thank you for participating!',
      },
    });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: err.errors[0].message });
    }
    next(err);
  }
};

export const getClaimStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const claim = await Claim.findById(req.params.claimId);
    if (!claim) {
      return res.status(404).json({ error: 'Claim record not found' });
    }

    return res.json({
      claim: {
        id: claim._id,
        status: claim.status,
        amount: claim.amount,
        currency: claim.currency,
        payoutReference: claim.payoutReference,
        failureReason: claim.failureReason,
        createdAt: claim.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
};
