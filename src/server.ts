import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import app from './app';

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/givehub';

async function startServer() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log(`[Sprinkl] Connected to MongoDB database: ${mongoose.connection.name}`);

    app.listen(PORT, () => {
      console.log(`[Sprinkl API TS] Server running on port ${PORT}`);
      console.log(`[Sprinkl API TS] Platform Domain: ${process.env.DOMAIN || 'https://sprinkl.biz'}`);
    });
  } catch (err) {
    console.error('[Sprinkl] Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
