import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import Transaction from '../models/Transaction';
import User from '../models/User';
import Admin from '../models/Admin';
import Claim from '../models/Claim';
import LedgerEntry from '../models/LedgerEntry';
import Giveaway from '../models/Giveaway';
import SupportSession from '../models/SupportSession';
import WalletAccount from '../models/WalletAccount';
import { getOnlineUserIds, getOnlineUsersCount } from '../socket';

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

    // 5. Users Breakdown & Active Users Tracking
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const totalUsers = await User.countDocuments({ role: { $ne: 'admin' } });
    const verifiedUsers = await User.countDocuments({ emailVerified: true, role: { $ne: 'admin' } });
    const hostUsers = await User.countDocuments({ role: 'host' });

    // Count admins from dedicated Admin model + legacy admin user records
    const dedicatedAdminCount = await Admin.countDocuments({ isActive: true });
    const legacyAdminUsers = await User.countDocuments({ role: 'admin' });
    const totalAdmins = dedicatedAdminCount || legacyAdminUsers;

    // Real-time active users calculations (strict 2-minute active threshold + live socket connections)
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const onlineIds = getOnlineUserIds();
    const activeNow = await User.countDocuments({
      role: { $ne: 'admin' },
      $or: [
        { _id: { $in: onlineIds } },
        { isOnline: true, lastActiveAt: { $gte: twoMinutesAgo } },
      ],
    });

    const activeToday = await User.countDocuments({
      role: { $ne: 'admin' },
      lastActiveAt: { $gte: twentyFourHoursAgo },
    });

    const activeThisWeek = await User.countDocuments({
      role: { $ne: 'admin' },
      lastActiveAt: { $gte: sevenDaysAgo },
    });

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
        admins: totalAdmins,
        activeNow,
        activeToday,
        activeThisWeek,
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
    const activity = (req.query.activity as string) || 'all'; // 'online' | 'today' | 'week' | 'all'
    const search = (req.query.search as string) || '';

    const query: any = {};
    if (role !== 'all') query.role = role;

    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const onlineIds = getOnlineUserIds();

    if (activity === 'online') {
      query.$or = [
        { _id: { $in: onlineIds } },
        { isOnline: true, lastActiveAt: { $gte: twoMinutesAgo } },
      ];
    } else if (activity === 'today') {
      query.lastActiveAt = { $gte: twentyFourHoursAgo };
    } else if (activity === 'week') {
      query.lastActiveAt = { $gte: sevenDaysAgo };
    }

    if (search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: [{ fullName: regex }, { email: regex }] }];
        delete query.$or;
      } else {
        query.$or = [{ fullName: regex }, { email: regex }];
      }
    }

    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .select('-passwordHash')
      .sort({ lastActiveAt: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    // Fetch balances for each user & calculate active status
    const usersWithBalances = await Promise.all(
      users.map(async (u) => {
        const wallets = await WalletAccount.find({ user: u._id });
        const ngnWallet = wallets.find((w) => w.currency === 'NGN');
        const usdtWallet = wallets.find((w) => w.currency === 'USDT');

        const isUserOnline =
          onlineIds.includes(String(u._id)) ||
          Boolean(u.isOnline && u.lastActiveAt && u.lastActiveAt >= twoMinutesAgo);

        return {
          ...u.toObject(),
          isOnline: isUserOnline,
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

    const onlineDbCount = await User.countDocuments({
      $or: [
        { _id: { $in: onlineIds } },
        { isOnline: true, lastActiveAt: { $gte: twoMinutesAgo } },
      ],
    });
    const activeTodayDbCount = await User.countDocuments({
      lastActiveAt: { $gte: twentyFourHoursAgo },
    });

    return res.json({
      users: usersWithBalances,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
      stats: {
        onlineCount: Math.max(onlineIds.length, onlineDbCount),
        activeTodayCount: activeTodayDbCount,
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

/**
 * Admin: Get currently active users list and online metrics
 */
export const getActiveUsers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const onlineIds = getOnlineUserIds();

    const activeUsers = await User.find({
      $or: [
        { _id: { $in: onlineIds } },
        { isOnline: true, lastActiveAt: { $gte: twoMinutesAgo } },
      ],
      role: { $ne: 'admin' },
    })
      .select('fullName email phone role lastActiveAt isOnline knownLocations emailVerified createdAt')
      .sort({ lastActiveAt: -1 })
      .limit(50);

    const totalActiveNow = await User.countDocuments({
      $or: [
        { _id: { $in: onlineIds } },
        { isOnline: true, lastActiveAt: { $gte: twoMinutesAgo } },
      ],
      role: { $ne: 'admin' },
    });

    const activeTodayCount = await User.countDocuments({
      lastActiveAt: { $gte: twentyFourHoursAgo },
      role: { $ne: 'admin' },
    });

    return res.json({
      onlineCount: totalActiveNow,
      activeTodayCount,
      users: activeUsers.map((u) => {
        const isCurrentlyOnline =
          onlineIds.includes(String(u._id)) ||
          Boolean(u.isOnline && u.lastActiveAt && u.lastActiveAt >= twoMinutesAgo);

        return {
          ...u.toObject(),
          isOnline: isCurrentlyOnline,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Admin: Get all administrators from dedicated Admin model
 */
export const getAdmins = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const admins = await Admin.find().select('-passwordHash').sort({ createdAt: -1 });

    // Also include legacy admin users from User collection if any exist
    const legacyAdminUsers = await User.find({ role: 'admin' }).select('-passwordHash');

    return res.json({
      admins,
      legacyAdminUsers,
      total: admins.length + legacyAdminUsers.length,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Admin: Create a new administrator in the dedicated Admin model
 */
export const createAdmin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { fullName, email, password, role } = req.body;
    if (!fullName || !email || !password) {
      return res.status(400).json({ error: 'Full name, email, and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const emailLower = email.toLowerCase().trim();
    const existing = await Admin.findOne({ email: emailLower });
    if (existing) {
      return res.status(400).json({ error: 'An administrator with this email already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newAdmin = await Admin.create({
      fullName: fullName.trim(),
      email: emailLower,
      passwordHash,
      role: ['superadmin', 'admin', 'moderator'].includes(role) ? role : 'admin',
      isActive: true,
    });

    return res.status(201).json({
      message: `Admin ${newAdmin.fullName} created successfully`,
      admin: {
        id: newAdmin._id,
        fullName: newAdmin.fullName,
        email: newAdmin.email,
        role: newAdmin.role,
        isActive: newAdmin.isActive,
        createdAt: newAdmin.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Admin: Update administrator status (active/inactive) or role
 */
export const updateAdminStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { adminId } = req.params;
    const { isActive, role } = req.body;

    const admin = await Admin.findById(adminId);
    if (!admin) {
      return res.status(404).json({ error: 'Administrator not found' });
    }

    if (isActive !== undefined) admin.isActive = Boolean(isActive);
    if (role && ['superadmin', 'admin', 'moderator'].includes(role)) {
      admin.role = role;
    }

    await admin.save();

    return res.json({
      message: `Admin ${admin.fullName} updated successfully`,
      admin: {
        id: admin._id,
        fullName: admin.fullName,
        email: admin.email,
        role: admin.role,
        isActive: admin.isActive,
      },
    });
  } catch (err) {
    next(err);
  }
};


