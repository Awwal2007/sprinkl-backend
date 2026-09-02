const express = require('express');
const router = express.Router();
const giveawayController = require('../controllers/giveawayController');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

router.post('/', giveawayController.createGiveaway);
router.get('/', giveawayController.getHostGiveaways);
router.get('/:id', giveawayController.getHostGiveawayById);
router.post('/:id/cancel', giveawayController.cancelGiveaway);

module.exports = router;
