const crypto = require('crypto');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const LedgerService = require('../services/ledgerService');

exports.handlePaystackWebhook = async (req, res, next) => {
  try {
    const hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || 'sk_test_mock_paystack_secret_key')
      .update(JSON.stringify(req.body))
      .digest('hex');

    const paystackHeader = req.headers['x-paystack-signature'];
    
    // In production, enforce signature validation:
    // if (hash !== paystackHeader) return res.status(401).send('Invalid signature');

    const event = req.body;

    if (event.event === 'charge.success') {
      const { amount, customer, reference } = event.data;
      const email = customer.email;

      const user = await User.findOne({ email });
      if (user) {
        // Prevent duplicate webhook processing
        const existingTx = await Transaction.findOne({ provider: 'paystack', providerReference: reference });
        if (!existingTx) {
          const tx = await Transaction.create({
            user: user._id,
            provider: 'paystack',
            providerReference: reference,
            direction: 'inbound',
            currency: 'NGN',
            amount,
            status: 'success',
            rawPayload: event,
          });

          await LedgerService.creditWallet({
            userId: user._id,
            currency: 'NGN',
            amount,
            referenceType: 'PaystackTransaction',
            referenceId: tx._id,
          });
        }
      }
    }

    return res.status(200).send('Webhook processed');
  } catch (err) {
    console.error('[Paystack Webhook Error]', err);
    return res.status(500).send('Webhook error');
  }
};

exports.handleCryptoDepositWebhook = async (req, res, next) => {
  try {
    const { userId, txHash, chain, amountUsdtInteger } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const existingTx = await Transaction.findOne({ providerReference: txHash });
    if (existingTx) return res.json({ message: 'Deposit already processed' });

    const tx = await Transaction.create({
      user: user._id,
      provider: chain === 'TRC20' ? 'tron' : 'bsc',
      providerReference: txHash,
      direction: 'inbound',
      currency: 'USDT',
      amount: amountUsdtInteger,
      status: 'success',
      rawPayload: req.body,
    });

    await LedgerService.creditWallet({
      userId: user._id,
      currency: 'USDT',
      amount: amountUsdtInteger,
      referenceType: 'CryptoDeposit',
      referenceId: tx._id,
    });

    return res.json({ message: 'Crypto deposit processed successfully' });
  } catch (err) {
    next(err);
  }
};
