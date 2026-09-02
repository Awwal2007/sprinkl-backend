const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

router.use(authenticateToken, requireAdmin);

router.get('/transactions', adminController.getTransactions);
router.get('/flags', adminController.getFlaggedAccounts);

module.exports = router;
