import { Request, Response, NextFunction } from 'express';
import Transaction from '../models/Transaction';
import User from '../models/User';
import Claim from '../models/Claim';
import LedgerEntry from '../models/LedgerEntry';
import Giveaway from '../models/Giveaway';

export const getTransactions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const transactions = await Transaction.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('user', 'fullName email')
      .populate('relatedClaim');

    return res.json({ transactions });
  } catch (err) {
    next(err);
  }
};

export const getFlaggedAccounts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const users = await User.find().select('-passwordHash');

    const highVolumeHosts: any[] = [];
    for (const u of users) {
      const claims = await Claim.aggregate([
        {
          $lookup: {
            from: 'giveaways',
            localField: 'giveaway',
            foreignField: '_id',
            as: 'giveawayInfo',
          },
        },
        { $unwind: '$giveawayInfo' },
        { $match: { 'giveawayInfo.host': u._id, status: 'paid' } },
        { $group: { _id: '$currency', totalVolume: { $sum: '$amount' } } },
      ]);

      let ngnVolume = 0;
      let usdtVolume = 0;
      claims.forEach((c) => {
        if (c._id === 'NGN') ngnVolume = c.totalVolume;
        if (c._id === 'USDT') usdtVolume = c.totalVolume;
      });

      const isFlagged = ngnVolume >= u.kyc.payoutReviewThreshold || usdtVolume >= 1000000000;

      highVolumeHosts.push({
        user: u,
        stats: {
          totalNgnPaid: ngnVolume,
          totalUsdtPaid: usdtVolume,
        },
        isFlagged,
        reason: isFlagged ? 'High Payout Volume exceeds KYC review threshold' : 'Normal',
      });
    }

    return res.json({ flagged: highVolumeHosts });
  } catch (err) {
    next(err);
  }
};

export const getRevenueStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const revenueEntries = await LedgerEntry.aggregate([
      { $match: { type: 'platform_fee', direction: 'debit' } },
      { $group: { _id: '$currency', totalRevenue: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);

    let totalNgnRevenue = 0;
    let totalUsdtRevenue = 0;
    revenueEntries.forEach((r) => {
      if (r._id === 'NGN') totalNgnRevenue = r.totalRevenue;
      if (r._id === 'USDT') totalUsdtRevenue = r.totalRevenue;
    });

    const totalGiveaways = await Giveaway.countDocuments();
    const activeGiveaways = await Giveaway.countDocuments({ status: 'active' });

    return res.json({
      revenue: {
        NGN: totalNgnRevenue,
        USDT: totalUsdtRevenue,
      },
      stats: {
        totalGiveaways,
        activeGiveaways,
      },
    });
  } catch (err) {
    next(err);
  }
};

