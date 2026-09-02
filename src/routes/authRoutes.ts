import { Router } from 'express';
import * as authController from '../controllers/authController';
import { authenticateToken } from '../middleware/auth';
import { authLimiter } from '../middleware/rateLimiter';

const router = Router();

router.post('/signup', authLimiter, authController.signup);
router.post('/login', authLimiter, authController.login);
router.post('/verify-email', authLimiter, authController.verifyEmail);
router.post('/resend-verification', authenticateToken as any, authController.resendVerificationEmail as any);
router.post('/refresh', authController.refreshToken);
router.get('/me', authenticateToken as any, authController.me as any);

export default router;
