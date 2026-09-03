import dotenv from 'dotenv';
dotenv.config();

import http from 'http';
import mongoose from 'mongoose';
import app from './app';
import { initSocket } from './socket';

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/givehub';

async function startServer() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log(`[Sprinkl] Connected to MongoDB database: ${mongoose.connection.name}`);

    // Wrap Express app in a native http.Server so Socket.IO can attach
    const httpServer = http.createServer(app);

    // Boot Socket.IO on the same server instance
    initSocket(httpServer);

    httpServer.listen(PORT, () => {
      console.log(`[Sprinkl API TS] Server running on port ${PORT}`);
      console.log(`[Sprinkl API TS] Platform Domain: ${process.env.DOMAIN || 'https://sprinkl.biz'}`);
      console.log(`[Sprinkl API TS] Socket.IO real-time layer active`);
    });
  } catch (err) {
    console.error('[Sprinkl] Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
