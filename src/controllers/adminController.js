const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Claim = require('../models/Claim');

exports.getTransactions = async (req, res, next) => {
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

exports.getFlaggedAccounts = async (req, res, next) => {
  try {
    // Find users with high transaction volume or flagged status
    const users = await User.find().select('-passwordHash');

    // Aggregate payouts per host
    const highVolumeHosts = [];
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
      claims.forEach(c => {
        if (c._id === 'NGN') ngnVolume = c.totalVolume;
        if (c._id === 'USDT') usdtVolume = c.totalVolume;
      });

      const isFlagged = ngnVolume >= u.kyc.payoutReviewThreshold || usdtVolume >= 1000000000; // 1,000 USDT threshold

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
