import { Router } from 'express';
import * as claimController from '../controllers/claimController';
import { claimLimiter } from '../middleware/rateLimiter';

const router = Router();

router.get('/:slug', claimController.getPublicGiveaway);
router.get('/:slug/banks', claimController.getBanks);
router.post('/:slug/resolve-bank', claimController.resolveBank);
router.post('/:slug/claim', claimLimiter, claimController.submitClaim);
router.get('/:slug/claim/:claimId/status', claimController.getClaimStatus);

export default router;
