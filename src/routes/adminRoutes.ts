import { Router } from 'express';
import * as adminController from '../controllers/adminController';
import { authenticateToken, requireAdmin } from '../middleware/auth';

const router = Router();

router.use(authenticateToken as any, requireAdmin as any);

router.get('/transactions', adminController.getTransactions);
router.get('/flags', adminController.getFlaggedAccounts);
router.get('/revenue', adminController.getRevenueStats);

export default router;
