import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import errorHandler from './middleware/errorHandler';

import authRoutes from './routes/authRoutes';
import walletRoutes from './routes/walletRoutes';
import giveawayRoutes from './routes/giveawayRoutes';
import claimRoutes from './routes/claimRoutes';
import webhookRoutes from './routes/webhookRoutes';
import adminRoutes from './routes/adminRoutes';

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: '*',
    credentials: true,
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.send("Welcome to Sprinkl Api V1.00");
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Sprinkl API (TypeScript)',
    domain: process.env.DOMAIN || 'https://sprinkl.biz',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/health/providers', async (req, res) => {
  const flwSecret = process.env.FLUTTERWAVE_SECRET_KEY;
  let flwStatus: any = {
    configured: !!flwSecret,
    mode: flwSecret?.startsWith('FLWSECK_LIVE') ? 'LIVE' : flwSecret ? 'TEST' : 'NOT_CONFIGURED',
  };

  if (flwSecret) {
    try {
      const axios = (await import('axios')).default;
      const resp = await axios.get('https://api.flutterwave.com/v3/banks/NG', {
        headers: { Authorization: `Bearer ${flwSecret}` },
        timeout: 7000,
      });
      if (resp.data && resp.data.status === 'success') {
        flwStatus = {
          ...flwStatus,
          status: 'CONNECTED',
          message: 'Flutterwave API key is valid and successfully connected.',
          banksCount: resp.data.data?.length || 0,
        };
      } else {
        flwStatus = {
          ...flwStatus,
          status: 'WARNING',
          message: resp.data?.message || 'Flutterwave returned non-success status',
        };
      }
    } catch (err: any) {
      flwStatus = {
        ...flwStatus,
        status: 'DISCONNECTED',
        error: err.response?.data?.message || err.message,
      };
    }
  } else {
    flwStatus = {
      ...flwStatus,
      status: 'NOT_CONFIGURED',
      error: 'FLUTTERWAVE_SECRET_KEY is not set in environment variables',
    };
  }

  const mongoose = (await import('mongoose')).default;
  const dbStatus = mongoose.connection.readyState === 1 ? 'CONNECTED' : 'DISCONNECTED';

  res.json({
    serverTime: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    database: {
      status: dbStatus,
    },
    flutterwave: flwStatus,
    crypto: {
      tron: {
        configured: !!process.env.TRON_HOT_WALLET_ADDRESS,
        address: process.env.TRON_HOT_WALLET_ADDRESS ? `${process.env.TRON_HOT_WALLET_ADDRESS.slice(0, 6)}...` : null,
      },
      bep20: {
        supported: true,
      },
    },
    webhook: {
      url: `${process.env.DOMAIN || 'https://sprinkl.biz'}/api/webhooks/flutterwave`,
      secretHashConfigured: !!process.env.FLUTTERWAVE_SECRET_HASH,
    },
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/giveaways', giveawayRoutes);
app.use('/api/g', claimRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/admin', adminRoutes);

app.use(errorHandler);

export default app;
