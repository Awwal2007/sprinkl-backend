const { nanoid } = require('nanoid');
const { z } = require('zod');
const Giveaway = require('../models/Giveaway');
const Claim = require('../models/Claim');
const paystackService = require('../services/paystackService');
const cryptoService = require('../services/cryptoService');
const PayoutWorker = require('../jobs/payoutWorker');

const claimSchema = z.object({
  claimantName: z.string().min(2).max(120),
  claimantEmail: z.string().email().optional(),
  claimantPhone: z.string().optional(),
  // NGN fields
  bankCode: z.string().optional(),
  bankName: z.string().optional(),
  accountNumber: z.string().optional(),
  resolvedAccountName: z.string().optional(),
  // USDT fields
  chain: z.enum(['TRC20', 'BEP20']).optional(),
  walletAddress: z.string().optional(),
  // Meta
  deviceFingerprint: z.string().optional(),
});

exports.getPublicGiveaway = async (req, res, next) => {
  try {
    const giveaway = await Giveaway.findOne({ slug: req.params.slug })
      .populate('host', 'fullName email');

    if (!giveaway) {
      return res.status(404).json({ error: 'Giveaway not found' });
    }

    if (giveaway.status !== 'active') {
      return res.status(400).json({ error: `This giveaway is currently ${giveaway.status}` });
    }

    if (giveaway.expiresAt && new Date() > new Date(giveaway.expiresAt)) {
      giveaway.status = 'expired';
      await giveaway.save();
      return res.status(400).json({ error: 'This giveaway has expired' });
    }

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
        slotsRemaining: giveaway.totalSlots - giveaway.slotsClaimed,
        expiresAt: giveaway.expiresAt,
        settings: giveaway.settings,
        hostName: giveaway.host?.fullName || 'GiveHub Host',
        seo: {
          title: `${giveaway.title} | GiveHub on Sprinkl.biz`,
          description: `Claim your share of ${giveaway.currency} from ${giveaway.host?.fullName || 'GiveHub Host'}`,
          url: `${process.env.DOMAIN || 'https://sprinkl.biz'}/g/${giveaway.slug}`,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.getBanks = async (req, res, next) => {
  try {
    const banks = await paystackService.getBankList();
    return res.json({ banks });
  } catch (err) {
    next(err);
  }
};

exports.resolveBank = async (req, res, next) => {
  try {
    const { accountNumber, bankCode } = req.body;
    if (!accountNumber || !bankCode) {
      return res.status(400).json({ error: 'Account number and bank code are required' });
    }

    const resolved = await paystackService.resolveAccount(accountNumber, bankCode);
    return res.json({ resolved });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
};

exports.submitClaim = async (req, res, next) => {
  try {
    const data = claimSchema.parse(req.body);
    const slug = req.params.slug;

    // 1. Fetch Giveaway
    const giveaway = await Giveaway.findOne({ slug, status: 'active' });
    if (!giveaway) {
      return res.status(404).json({ error: 'Active giveaway not found' });
    }

    if (giveaway.slotsClaimed >= giveaway.totalSlots) {
      return res.status(400).json({ error: 'All slots for this giveaway have been claimed!' });
    }

    // 2. Validate payout destination & normalize destination string
    let normalizedDestination = '';
    let destinationObj = {};

    if (giveaway.currency === 'NGN') {
      if (!data.accountNumber || !data.bankCode) {
        return res.status(400).json({ error: 'Bank account number and bank choice are required for NGN claims' });
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

    // 3. Platform-wide first-time claimant check if setting enabled
    if (giveaway.settings?.restrictFirstTimeClaimantsOnly) {
      const previousClaim = await Claim.findOne({
        'destination.normalized': normalizedDestination,
        status: { $in: ['paid', 'processing', 'pending'] },
      });
      if (previousClaim) {
        return res.status(400).json({
          error: 'This host restricted claims to first-time platform users only. Your account/wallet has claimed before.',
        });
      }
    }

    // 4. Atomic slot reservation guard: Increment slotsClaimed ONLY IF slotsClaimed < totalSlots
    const updatedGiveaway = await Giveaway.findOneAndUpdate(
      { _id: giveaway._id, status: 'active', slotsClaimed: { $lt: giveaway.totalSlots } },
      { $inc: { slotsClaimed: 1 } },
      { new: true }
    );

    if (!updatedGiveaway) {
      return res.status(400).json({ error: 'Sorry! The last slot was just taken by another claimant.' });
    }

    if (updatedGiveaway.slotsClaimed >= updatedGiveaway.totalSlots) {
      await Giveaway.findByIdAndUpdate(giveaway._id, { status: 'completed' });
    }

    // 5. Create Claim document with unique compound index guarantee on (giveaway, destination.normalized)
    const idempotencyKey = `CLAIM_${giveaway._id}_${normalizedDestination}_${Date.now()}`;

    let claim;
    try {
      claim = new Claim({
        giveaway: giveaway._id,
        claimantName: data.claimantName,
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
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
          deviceFingerprint: data.deviceFingerprint || '',
          captchaVerified: true,
        },
      });

      await claim.save();
    } catch (dbErr) {
      // Rollback atomically reserved slot if claim creation fails due to duplicate
      await Giveaway.findByIdAndUpdate(giveaway._id, { $inc: { slotsClaimed: -1 } });

      if (dbErr.code === 11000) {
        return res.status(409).json({
          error: 'You have already claimed this giveaway! Each bank account or wallet address can only claim once.',
        });
      }
      throw dbErr;
    }

    // 6. Enqueue background payout job
    await PayoutWorker.enqueuePayout(claim._id);

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
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: err.errors[0].message });
    }
    next(err);
  }
};

exports.getClaimStatus = async (req, res, next) => {
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
