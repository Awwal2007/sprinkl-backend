const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

router.get('/', walletController.getWallet);
router.post('/dva/setup', walletController.setupNgnDva);
router.post('/fund/ngn', walletController.simulateFundNgn);
router.post('/fund/usdt/address', walletController.getUsdtDepositAddress);
router.post('/fund/usdt', walletController.simulateFundUsdt);

module.exports = router;
