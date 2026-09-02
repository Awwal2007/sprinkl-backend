const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');

router.post('/paystack', express.json(), webhookController.handlePaystackWebhook);
router.post('/crypto-deposit', express.json(), webhookController.handleCryptoDepositWebhook);

module.exports = router;
