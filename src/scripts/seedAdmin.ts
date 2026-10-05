import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../models/User';
import Admin from '../models/Admin';
import WalletAccount from '../models/WalletAccount';

const TARGET_EMAIL = (process.env.ADMIN_EMAIL || 'awwalsaminu9@gmail.com').toLowerCase().trim();
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/givehub';

async function seedAdmin() {
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB.');

  const adminPassword = process.env.ADMIN_SEED_PASSWORD || process.env.ADMIN_PASSWORD || 'AdminSprinkl2026!';
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(adminPassword, salt);

  // 1. Seed into dedicated Admin collection
  let admin = await Admin.findOne({ email: TARGET_EMAIL });
  if (admin) {
    admin.isActive = true;
    admin.role = 'superadmin';
    await admin.save();
    console.log(`👑 Success! Admin model "${admin.fullName}" confirmed as SUPERADMIN.`);
  } else {
    admin = await Admin.create({
      fullName: 'Sprinkl Super Administrator',
      email: TARGET_EMAIL,
      passwordHash,
      role: 'superadmin',
      isActive: true,
      lastActiveAt: new Date(),
    });
    console.log(`🎉 Created new record in dedicated ADMIN collection: ${admin.email}`);
  }

  // 2. Ensure User record is synced
  let user = await User.findOne({ email: TARGET_EMAIL });

  if (user) {
    console.log(`👤 Found user: "${user.fullName}" (${user.email}). Current role: ${user.role}`);
    user.role = 'admin';
    user.emailVerified = true;
    await user.save();
    console.log(`🌟 Success! User "${user.fullName}" is confirmed as ADMIN.`);
  } else {
    user = await User.create({
      fullName: 'Sprinkl Administrator',
      email: TARGET_EMAIL,
      passwordHash,
      role: 'admin',
      emailVerified: true,
      kyc: {
        status: 'verified',
        payoutReviewThreshold: 500000000,
      },
    });

    console.log(`🎉 Created new admin user: ${user.email}`);
  }

  // Ensure NGN & USDT wallet accounts exist for this admin
  const currencies: ('NGN' | 'USDT')[] = ['NGN', 'USDT'];
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

  console.log('✨ Admin seed successfully completed.');
  await mongoose.disconnect();
  process.exit(0);
}

seedAdmin().catch((err) => {
  console.error('❌ Admin seed failed:', err);
  process.exit(1);
});
