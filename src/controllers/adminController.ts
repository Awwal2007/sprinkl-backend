import { Request, Response, NextFunction } from 'express';
import Transaction from '../models/Transaction';
import User from '../models/User';
import Claim from '../models/Claim';
import LedgerEntry from '../models/LedgerEntry';
import Giveaway from '../models/Giveaway';
import SupportSession from '../models/SupportSession';
import WalletAccount from '../models/WalletAccount';

/**
 * Get system external provider transactions with pagination & filtering
 */
export const getTransactions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 15));
    const provider = (req.query.provider as string) || 'all';
    const status = (req.query.status as string) || 'all';
    const direction = (req.query.direction as string) || 'all';
    const search = (req.query.search as string) || '';

    const query: any = {};
    if (provider !== 'all') query.provider = provider;
    if (status !== 'all') query.status = status;
    if (direction !== 'all') query.direction = direction;

    if (search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [{ providerReference: regex }];
    }

    const total = await Transaction.countDocuments(query);
    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('user', 'fullName email')
      .populate('relatedClaim');

    return res.json({
      transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get comprehensive overview and detailed system reports
 */
export const getOverviewReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // 1. Platform Fee Revenue
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

    // 2. Disbursed Payout Volume
    const payoutEntries = await LedgerEntry.aggregate([
      { $match: { type: 'payout', direction: 'debit' } },
      { $group: { _id: '$currency', totalVolume: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);

    let totalNgnPayout = 0;
    let totalUsdtPayout = 0;
    payoutEntries.forEach((p) => {
      if (p._id === 'NGN') totalNgnPayout = p.totalVolume;
      if (p._id === 'USDT') totalUsdtPayout = p.totalVolume;
    });

    // 3. Inbound Deposits Volume
    const depositEntries = await LedgerEntry.aggregate([
      { $match: { type: 'fund', direction: 'credit' } },
      { $group: { _id: '$currency', totalDeposited: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);

    let totalNgnDeposits = 0;
    let totalUsdtDeposits = 0;
    depositEntries.forEach((d) => {
      if (d._id === 'NGN') totalNgnDeposits = d.totalDeposited;
      if (d._id === 'USDT') totalUsdtDeposits = d.totalDeposited;
    });

    // 4. Giveaways Breakdown
    const totalGiveaways = await Giveaway.countDocuments();
    const activeGiveaways = await Giveaway.countDocuments({ status: 'active' });
    const completedGiveaways = await Giveaway.countDocuments({ status: 'completed' });
    const cancelledGiveaways = await Giveaway.countDocuments({ status: 'cancelled' });

    // Aggregate slots utilization
    const slotStats = await Giveaway.aggregate([
      {
        $group: {
          _id: null,
          totalSlots: { $sum: '$totalSlots' },
          totalSlotsClaimed: { $sum: '$slotsClaimed' },
        },
      },
    ]);
    const totalSlots = slotStats[0]?.totalSlots || 0;
    const totalSlotsClaimed = slotStats[0]?.totalSlotsClaimed || 0;
    const claimRate = totalSlots > 0 ? Math.round((totalSlotsClaimed / totalSlots) * 100) : 0;

    // 5. Users Breakdown (excluding administrators from user counts)
    const totalUsers = await User.countDocuments({ role: { $ne: 'admin' } });
    const verifiedUsers = await User.countDocuments({ emailVerified: true, role: { $ne: 'admin' } });
    const hostUsers = await User.countDocuments({ role: 'host' });
    const adminUsers = await User.countDocuments({ role: 'admin' });

    // 6. Claims Breakdown
    const totalClaims = await Claim.countDocuments();
    const paidClaims = await Claim.countDocuments({ status: 'paid' });
    const failedClaims = await Claim.countDocuments({ status: 'failed' });
    const pendingClaims = await Claim.countDocuments({ status: 'pending' });

    // 7. Support Sessions Stats
    const totalSupportSessions = await SupportSession.countDocuments();
    const activeSupportSessions = await SupportSession.countDocuments({ status: 'active' });
    const agentRequestedSessions = await SupportSession.countDocuments({ isAgentRequested: true, status: 'active' });

    return res.json({
      revenue: {
        NGN: totalNgnRevenue,
        USDT: totalUsdtRevenue,
      },
      payouts: {
        NGN: totalNgnPayout,
        USDT: totalUsdtPayout,
      },
      deposits: {
        NGN: totalNgnDeposits,
        USDT: totalUsdtDeposits,
      },
      giveaways: {
        total: totalGiveaways,
        active: activeGiveaways,
        completed: completedGiveaways,
        cancelled: cancelledGiveaways,
        totalSlots,
        totalSlotsClaimed,
        claimRate,
      },
      users: {
        total: totalUsers,
        verified: verifiedUsers,
        hosts: hostUsers,
        admins: adminUsers,
      },
      claims: {
        total: totalClaims,
        paid: paidClaims,
        failed: failedClaims,
        pending: pendingClaims,
      },
      support: {
        total: totalSupportSessions,
        active: activeSupportSessions,
        agentRequested: agentRequestedSessions,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Backward compatibility for revenue endpoint
 */
export const getRevenueStats = async (req: Request, res: Response, next: NextFunction) => {
  return getOverviewReport(req, res, next);
};

/**
 * Get all giveaways on the platform with pagination & filters
 */
export const getGiveaways = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 12));
    const status = (req.query.status as string) || 'all';
    const currency = (req.query.currency as string) || 'all';
    const search = (req.query.search as string) || '';

    const query: any = {};
    if (status !== 'all') query.status = status;
    if (currency !== 'all') query.currency = currency;

    if (search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [{ title: regex }, { slug: regex }];
    }

    const total = await Giveaway.countDocuments(query);
    const giveaways = await Giveaway.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('host', 'fullName email');

    return res.json({
      giveaways,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get all claims across all giveaways with pagination
 */
export const getClaims = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 15));
    const status = (req.query.status as string) || 'all';
    const currency = (req.query.currency as string) || 'all';
    const search = (req.query.search as string) || '';

    const query: any = {};
    if (status !== 'all') query.status = status;
    if (currency !== 'all') query.currency = currency;

    if (search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [
        { 'destination.normalized': regex },
        { 'destination.details.accountNumber': regex },
        { 'destination.details.accountName': regex },
        { 'destination.details.address': regex },
      ];
    }

    const total = await Claim.countDocuments(query);
    const claims = await Claim.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('giveaway', 'title slug currency amountPerRecipient');

    return res.json({
      claims,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get users directory with pagination, search, balances & role
 */
export const getUsers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 15));
    const role = (req.query.role as string) || 'all';
    const search = (req.query.search as string) || '';

    const query: any = {};
    if (role !== 'all') query.role = role;

    if (search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [{ fullName: regex }, { email: regex }];
    }

    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .select('-passwordHash')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    // Fetch balances for each user
    const usersWithBalances = await Promise.all(
      users.map(async (u) => {
        const wallets = await WalletAccount.find({ user: u._id });
        const ngnWallet = wallets.find((w) => w.currency === 'NGN');
        const usdtWallet = wallets.find((w) => w.currency === 'USDT');

        return {
          ...u.toObject(),
          balances: {
            NGN: {
              available: ngnWallet?.available || 0,
              reserved: ngnWallet?.reserved || 0,
            },
            USDT: {
              available: usdtWallet?.available || 0,
              reserved: usdtWallet?.reserved || 0,
            },
          },
        };
      })
    );

    return res.json({
      users: usersWithBalances,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Update user role (promote to admin or demote to host)
 */
export const updateUserRole = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    if (!['host', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Role must be host or admin' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.role = role;
    await user.save();

    return res.json({
      message: `User ${user.fullName} role updated to ${role}`,
      user: {
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get flagged high-volume host accounts
 */
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

/**
 * Get all KYC upgrade requests (pending + historical), paginated
 */
export const getKycRequests = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 15));
    const statusFilter = (req.query.status as string) || 'pending';

    const query: any = {};
    if (statusFilter !== 'all') {
      query['kyc.requestStatus'] = statusFilter;
    } else {
      // Only return users who have ever submitted a request
      query['kyc.requestStatus'] = { $in: ['pending', 'approved', 'rejected'] };
    }

    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .select('fullName email kyc role createdAt')
      .sort({ 'kyc.requestedAt': -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return res.json({
      requests: users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Admin: Review a KYC upgrade request — approve with new threshold or reject
 */
export const reviewKycRequest = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.params;
    const { action, newThreshold } = req.body; // action: 'approve' | 'reject'

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Action must be "approve" or "reject".' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (action === 'approve') {
      const threshold = newThreshold ? Math.round(Number(newThreshold)) : user.kyc.requestedThreshold;
      if (!threshold || threshold <= 0) {
        return res.status(400).json({ error: 'A valid new threshold amount is required to approve.' });
      }
      user.kyc.payoutReviewThreshold = threshold;
      user.kyc.requestStatus = 'approved';
    } else {
      user.kyc.requestStatus = 'rejected';
    }

    user.kyc.reviewedAt = new Date();
    await user.save();

    return res.json({
      message: `Payment threshold request ${action === 'approve' ? 'approved' : 'rejected'} successfully.`,
      user: {
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        kyc: user.kyc,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Admin: Manually update a user's payment threshold directly
 */
export const updateKycThreshold = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.params;
    const { newThreshold } = req.body;

    const threshold = Math.round(Number(newThreshold));
    if (!threshold || threshold <= 0) {
      return res.status(400).json({ error: 'A valid positive threshold amount is required.' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    user.kyc.payoutReviewThreshold = threshold;
    user.kyc.reviewedAt = new Date();
    await user.save();

    return res.json({
      message: `Payment threshold updated to ₦${(threshold / 100).toLocaleString()} for ${user.fullName}.`,
      user: {
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        kyc: user.kyc,
      },
    });
  } catch (err) {
    next(err);
  }
};

