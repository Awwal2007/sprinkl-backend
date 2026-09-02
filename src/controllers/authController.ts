import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import User from '../models/User';
import { AuthRequest } from '../middleware/auth';

import crypto from 'crypto';
import emailService from '../services/emailService';

const signupSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  phone: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const generateTokens = (userId: any) => {
  const accessSecret = process.env.JWT_ACCESS_SECRET || 'givehub_jwt_access_secret_sprinkl_2026_super_key';
  const refreshSecret = process.env.JWT_REFRESH_SECRET || 'givehub_jwt_refresh_secret_sprinkl_2026_super_key';

  const accessToken = jwt.sign({ userId }, accessSecret, { expiresIn: '15m' });
  const refreshToken = jwt.sign({ userId }, refreshSecret, { expiresIn: '7d' });

  return { accessToken, refreshToken };
};

export const signup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = signupSchema.parse(req.body);

    const existing = await User.findOne({ email: data.email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ error: 'An account with this email already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(data.password, salt);

    // Generate secure 32-byte hexadecimal email verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const user = new User({
      fullName: data.fullName,
      email: data.email.toLowerCase(),
      phone: data.phone || '',
      passwordHash,
      role: 'host',
      emailVerified: false,
      verificationToken,
      verificationTokenExpires,
      kyc: {
        status: 'verified',
        payoutReviewThreshold: parseInt(process.env.DEFAULT_KYC_PAYOUT_REVIEW_THRESHOLD || '500000', 10),
      },
    });

    await user.save();

    // Send verification email via Resend
    await emailService.sendVerificationEmail(user.email, user.fullName, verificationToken);

    const { accessToken, refreshToken } = generateTokens(user._id);

    user.refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    await user.save();

    return res.status(201).json({
      message: 'Signup successful! Please check your email to verify your account.',
      accessToken,
      refreshToken,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        emailVerified: user.emailVerified,
        kyc: user.kyc,
      },
    });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: err.errors[0].message });
    }
    next(err);
  }
};

export const verifyEmail = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: 'Verification token is required' });
    }

    const user = await User.findOne({
      verificationToken: token,
      verificationTokenExpires: { $gt: new Date() },
    }).select('+verificationToken +verificationTokenExpires');

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired email verification link' });
    }

    user.emailVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpires = undefined;
    await user.save();

    return res.json({
      message: 'Email successfully verified! Your host account is active.',
      emailVerified: true,
    });
  } catch (err) {
    next(err);
  }
};

export const resendVerificationEmail = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await User.findById(req.user!._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.emailVerified) {
      return res.status(400).json({ error: 'Email is already verified' });
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    user.verificationToken = verificationToken;
    user.verificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save();

    await emailService.sendVerificationEmail(user.email, user.fullName, verificationToken);

    return res.json({ message: 'Verification email has been sent!' });
  } catch (err) {
    next(err);
  }
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
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
        emailVerified: user.emailVerified,
        kyc: user.kyc,
      },
    });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: err.errors[0].message });
    }
    next(err);
  }
};

export const refreshToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken: token } = req.body;
    if (!token) {
      return res.status(401).json({ error: 'Refresh token required' });
    }

    const refreshSecret = process.env.JWT_REFRESH_SECRET || 'givehub_jwt_refresh_secret_sprinkl_2026_super_key';
    const decoded = jwt.verify(token, refreshSecret) as { userId: string };

    const user = await User.findById(decoded.userId).select('+refreshTokenHash');
    if (!user || !user.refreshTokenHash) {
      return res.status(401).json({ error: 'Session expired or invalidated', code: 'SESSION_EXPIRED' });
    }

    const isMatch = await bcrypt.compare(token, user.refreshTokenHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid refresh token', code: 'REFRESH_TOKEN_INVALID' });
    }

    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user._id);

    user.refreshTokenHash = await bcrypt.hash(newRefreshToken, 10);
    await user.save();

    return res.json({
      accessToken,
      refreshToken: newRefreshToken,
    });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired refresh token', code: 'REFRESH_TOKEN_EXPIRED' });
  }
};

export const me = async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  return res.json({
    user: {
      id: req.user._id,
      fullName: req.user.fullName,
      email: req.user.email,
      phone: req.user.phone,
      role: req.user.role,
      emailVerified: req.user.emailVerified,
      kyc: req.user.kyc,
      paystackDvaAccountNumber: req.user.paystackDvaAccountNumber,
      paystackDvaBankName: req.user.paystackDvaBankName,
      cryptoDepositAddresses: req.user.cryptoDepositAddresses,
    },
  });
};
