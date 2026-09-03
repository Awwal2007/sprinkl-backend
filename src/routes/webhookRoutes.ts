import { Router, json } from 'express';
import * as webhookController from '../controllers/webhookController';

const router = Router();

router.post('/flutterwave', json(), webhookController.handleFlutterwaveWebhook);
router.post('/paystack', json(), webhookController.handlePaystackWebhook);
router.post('/oxapay', json(), webhookController.handleOxaPayWebhook);
router.post('/crypto-deposit', json(), webhookController.handleCryptoDepositWebhook);

export default router;
