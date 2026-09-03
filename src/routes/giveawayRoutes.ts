import { Router } from 'express';
import * as giveawayController from '../controllers/giveawayController';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.use(authenticateToken as any);

router.post('/', giveawayController.createGiveaway as any);
router.get('/', giveawayController.getHostGiveaways as any);
router.get('/:id', giveawayController.getHostGiveawayById as any);
router.post('/:id/cancel', giveawayController.cancelGiveaway as any);
router.post('/:id/transfer-to-main-wallet', giveawayController.transferGiveawayFundsToMainWallet as any);

export default router;
