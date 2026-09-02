const express = require('express');
const router = express.Router();
const claimController = require('../controllers/claimController');
const { claimLimiter } = require('../middleware/rateLimiter');

// Public claim routes (no login required)
router.get('/:slug', claimController.getPublicGiveaway);
router.get('/:slug/banks', claimController.getBanks);
router.post('/:slug/resolve-bank', claimController.resolveBank);
router.post('/:slug/claim', claimLimiter, claimController.submitClaim);
router.get('/:slug/claim/:claimId/status', claimController.getClaimStatus);

module.exports = router;
