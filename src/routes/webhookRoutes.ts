import { Router, json } from 'express';
import * as webhookController from '../controllers/webhookController';

const router = Router();

router.post('/flutterwave', json(), webhookController.handleFlutterwaveWebhook);
router.post('/paystack', json(), webhookController.handlePaystackWebhook);
router.post('/nowpayments', json(), webhookController.handleNowPaymentsWebhook);

export default router;
