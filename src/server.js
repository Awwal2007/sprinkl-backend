require('dotenv').config();
const mongoose = require('mongoose');
const app = require('./app');

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/givehub';

async function startServer() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log(`[GiveHub] Connected to MongoDB database: ${mongoose.connection.name}`);

    app.listen(PORT, () => {
      console.log(`[GiveHub] Server running on port ${PORT}`);
      console.log(`[GiveHub] Platform Domain: ${process.env.DOMAIN || 'https://sprinkl.biz'}`);
    });
  } catch (err) {
    console.error('[GiveHub] Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
