const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const User = require('../models/User');

const signupSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(6),
  phone: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const generateTokens = (userId) => {
  const accessSecret = process.env.JWT_ACCESS_SECRET || 'givehub_jwt_access_secret_sprinkl_2026_super_key';
  const refreshSecret = process.env.JWT_REFRESH_SECRET || 'givehub_jwt_refresh_secret_sprinkl_2026_super_key';

  const accessToken = jwt.sign({ userId }, accessSecret, { expiresIn: '15m' });
  const refreshToken = jwt.sign({ userId }, refreshSecret, { expiresIn: '7d' });

  return { accessToken, refreshToken };
};

exports.signup = async (req, res, next) => {
  try {
    const data = signupSchema.parse(req.body);

    const existing = await User.findOne({ email: data.email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ error: 'An account with this email already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(data.password, salt);

    const user = new User({
      fullName: data.fullName,
      email: data.email.toLowerCase(),
      phone: data.phone || '',
      passwordHash,
      role: 'host',
      kyc: {
        status: 'verified', // Auto-verify KYC lite on signup for instant onboarding under 60 seconds
        payoutReviewThreshold: parseInt(process.env.DEFAULT_KYC_PAYOUT_REVIEW_THRESHOLD || '500000', 10),
      },
    });

    await user.save();

    const { accessToken, refreshToken } = generateTokens(user._id);

    user.refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    await user.save();

    return res.status(201).json({
      message: 'Signup successful',
      accessToken,
      refreshToken,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        kyc: user.kyc,
      },
    });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: err.errors[0].message });
    }
    next(err);
  }
};

exports.login = async (req, res, next) => {
  try {
    const data = loginSchema.parse(req.body);

    const user = await User.findOne({ email: data.email.toLowerCase() }).select('+passwordHash');
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(data.password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const { accessToken, refreshToken } = generateTokens(user._id);

    user.refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    await user.save();

    return res.json({
      message: 'Login successful',
      accessToken,
      refreshToken,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        kyc: user.kyc,
      },
    });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: err.errors[0].message });
    }
    next(err);
  }
};

exports.me = async (req, res) => {
  return res.json({
    user: {
      id: req.user._id,
      fullName: req.user.fullName,
      email: req.user.email,
      phone: req.user.phone,
      role: req.user.role,
      kyc: req.user.kyc,
      paystackDvaAccountNumber: req.user.paystackDvaAccountNumber,
      paystackDvaBankName: req.user.paystackDvaBankName,
      cryptoDepositAddresses: req.user.cryptoDepositAddresses,
    },
  });
};
