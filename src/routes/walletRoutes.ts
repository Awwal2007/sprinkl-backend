import { Router } from 'express';
import * as walletController from '../controllers/walletController';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.use(authenticateToken as any);

router.get('/', walletController.getWallet as any);
router.post('/dva/setup', walletController.setupNgnDva as any);
router.post('/fund/flw-initialize', walletController.initializeFlutterwaveDeposit as any);
router.post('/fund/ngn', walletController.simulateFundNgn as any);
router.post('/fund/usdt/address', walletController.getUsdtDepositAddress as any);
router.post('/fund/oxapay-invoice', walletController.createOxaPayDepositInvoice as any);
router.post('/fund/usdt', walletController.simulateFundUsdt as any);
router.post('/release-reserved', walletController.releaseReservedFundsToAvailable as any);

export default router;
