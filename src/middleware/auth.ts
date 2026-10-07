import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User, { IUser } from '../models/User';
import Admin, { IAdmin } from '../models/Admin';

export interface AuthRequest extends Request {
  user?: IUser;
  admin?: IAdmin;
}

const getJwtAccessSecret = (): string => {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL SECURITY ERROR: JWT_ACCESS_SECRET must be defined in production environment.');
    }
    return 'givehub_jwt_access_secret_sprinkl_2026_super_key';
  }
  return secret;
};

export const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Access token required', code: 'TOKEN_REQUIRED' });
    }

    const secret = getJwtAccessSecret();
    const decoded = jwt.verify(token, secret) as {
      userId: string;
      role?: string;
      isAdmin?: boolean;
    };

    // 1. Check if token belongs to an Admin in the dedicated Admin model
    const admin = await Admin.findById(decoded.userId);
    if (admin) {
      if (!admin.isActive) {
        return res.status(403).json({
          error: 'Administrator account is deactivated.',
          code: 'ADMIN_DEACTIVATED',
        });
      }
      // Update admin lastActiveAt timestamp (fire and forget)
      Admin.findByIdAndUpdate(admin._id, { lastActiveAt: new Date() }).catch(() => {});

      req.admin = admin;
      // Admin model directly satisfies user-facing wallet/giveaway features without touching User model
      req.user = admin as any;
      return next();
    }

    // 2. Otherwise, check standard User model
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res
        .status(401)
        .json({ error: 'User account not found or deactivated', code: 'USER_NOT_FOUND' });
    }

    if (!user.emailVerified) {
      return res.status(403).json({
        error: 'Please verify your email address to access your account.',
        code: 'EMAIL_NOT_VERIFIED',
        emailVerified: false,
      });
    }

    // Update user lastActiveAt timestamp (fire and forget)
    User.findByIdAndUpdate(user._id, { lastActiveAt: new Date() }).catch(() => {});

    req.user = user;
    next();
  } catch (err: any) {
    const isExpired = err.name === 'TokenExpiredError';
    return res.status(401).json({
      error: isExpired ? 'Session expired. Please sign in again.' : 'Invalid session token.',
      code: isExpired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
    });
  }
};

export const requireVerifiedEmail = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.admin) return next();
  if (req.user && req.user.emailVerified) {
    return next();
  }
  return res.status(403).json({
    error: 'Please verify your email address to access this feature.',
    emailVerified: false,
  });
};

export const optionalAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      const secret = getJwtAccessSecret();
      const decoded = jwt.verify(token, secret) as { userId: string };

      const admin = await Admin.findById(decoded.userId);
      if (admin && admin.isActive) {
        req.admin = admin;
        req.user = admin as any;
        return next();
      }

      const user = await User.findById(decoded.userId);
      if (user) {
        req.user = user;
      }
    }
  } catch (err) {
    // Ignore invalid token for optionalAuth
  }
  return next();
};

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.admin) {
    return next();
  }
  return res.status(403).json({ error: 'Admin privilege required' });
};
