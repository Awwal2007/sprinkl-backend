import { Router } from 'express';
import * as adminController from '../controllers/adminController';
import * as supportController from '../controllers/supportController';
import { authenticateToken, requireAdmin } from '../middleware/auth';

const router = Router();

// Guard all admin routes with authentication and requireAdmin check
router.use(authenticateToken as any, requireAdmin as any);

// System Overview & Comprehensive KPI Reports
router.get('/overview', adminController.getOverviewReport);
router.get('/reports', adminController.getOverviewReport);
router.get('/revenue', adminController.getRevenueStats);

// External Provider Transactions (Paginated)
router.get('/transactions', adminController.getTransactions);

// Platform Giveaways Monitor (Paginated)
router.get('/giveaways', adminController.getGiveaways);

// Platform Claims Audit (Paginated)
router.get('/claims', adminController.getClaims);

// Users Directory & Role Management (Paginated)
router.get('/users', adminController.getUsers);
router.patch('/users/:userId/role', adminController.updateUserRole);
router.get('/flags', adminController.getFlaggedAccounts);

// Live Support Chat Desk API
router.get('/support/sessions', supportController.getAdminSupportSessions);
router.get('/support/sessions/:sessionId', supportController.getAdminSupportSessionMessages);
router.post('/support/sessions/:sessionId/reply', supportController.adminReplySupportSession);
router.post('/support/sessions/:sessionId/close', supportController.closeSupportSession);

export default router;
