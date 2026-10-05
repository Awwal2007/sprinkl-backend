import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User, { IUser } from '../models/User';
import Admin, { IAdmin } from '../models/Admin';

export interface AuthRequest extends Request {
  user?: IUser;
  admin?: IAdmin;
}

export const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Access token required', code: 'TOKEN_REQUIRED' });
    }

    const secret =
      process.env.JWT_ACCESS_SECRET ||
      'givehub_jwt_access_secret_sprinkl_2026_super_key';
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
      // Also map to req.user for backward-compatible route access
      req.user = {
        _id: admin._id,
        fullName: admin.fullName,
        email: admin.email,
        role: 'admin',
        emailVerified: true,
      } as any;
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
      const secret =
        process.env.JWT_ACCESS_SECRET ||
        'givehub_jwt_access_secret_sprinkl_2026_super_key';
      const decoded = jwt.verify(token, secret) as { userId: string };

      const admin = await Admin.findById(decoded.userId);
      if (admin && admin.isActive) {
        req.admin = admin;
        req.user = {
          _id: admin._id,
          fullName: admin.fullName,
          email: admin.email,
          role: 'admin',
          emailVerified: true,
        } as any;
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
  if (req.admin || (req.user && req.user.role === 'admin')) {
    return next();
  }
  return res.status(403).json({ error: 'Admin privilege required' });
};
