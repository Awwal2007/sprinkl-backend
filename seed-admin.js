/**
 * Idempotent Admin Seeder for Sprinkl
 * Run: node seed-admin.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const TARGET_EMAIL = (process.env.ADMIN_EMAIL || 'awwalsaminu9@gmail.com').toLowerCase().trim();
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is not set in .env');
  process.exit(1);
}

// Minimal schemas to execute seed reliably
const UserSchema = new mongoose.Schema(
  {
    fullName: String,
    email: { type: String, unique: true },
    passwordHash: String,
    role: { type: String, enum: ['host', 'admin'], default: 'host' },
    isVerified: { type: Boolean, default: false },
    kyc: {
      payoutReviewThreshold: { type: Number, default: 50000000 },
      manualReviewRequired: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

const WalletAccountSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    currency: { type: String, enum: ['NGN', 'USDT'] },
    available: { type: Number, default: 0 },
    reserved: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const User = mongoose.models.User || mongoose.model('User', UserSchema);
const WalletAccount = mongoose.models.WalletAccount || mongoose.model('WalletAccount', WalletAccountSchema);

async function main() {
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB.');

  let user = await User.findOne({ email: TARGET_EMAIL });

  if (user) {
    console.log(`👤 Found user: "${user.fullName}" (${user.email}). Current role: ${user.role}`);
    user.role = 'admin';
    user.isVerified = true;
    await user.save();
    console.log(`🌟 Success! User "${user.fullName}" is confirmed as ADMIN with full platform privileges.`);
  } else {
    console.log(`⚠️ User "${TARGET_EMAIL}" not found. Creating default admin account...`);
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash('@Halabi2007', salt);

    user = await User.create({
      fullName: 'Sprinkl Administrator',
      email: TARGET_EMAIL,
      passwordHash,
      role: 'admin',
      isVerified: true,
      kyc: {
        payoutReviewThreshold: 500000000,
        manualReviewRequired: false,
      },
    });

    console.log(`🎉 Created new admin user: ${user.email} (Password: AdminSprinkl2026!)`);
  }

  // Ensure NGN & USDT wallet accounts exist
  const currencies = ['NGN', 'USDT'];
  for (const currency of currencies) {
    const existing = await WalletAccount.findOne({ user: user._id, currency });
    if (!existing) {
      await WalletAccount.create({
        user: user._id,
        currency,
        available: 0,
        reserved: 0,
      });
      console.log(`💼 Initialized ${currency} wallet account for admin.`);
    }
  }

  console.log('🎉 Admin seed completed successfully.');
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Fatal error seeding admin:', err);
  process.exit(1);
});
