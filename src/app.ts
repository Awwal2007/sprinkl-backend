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

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Sprinkl API (TypeScript)',
    domain: process.env.DOMAIN || 'https://sprinkl.biz',
    timestamp: new Date().toISOString(),
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
