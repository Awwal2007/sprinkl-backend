import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../models/User';
import Admin from '../models/Admin';
import WalletAccount from '../models/WalletAccount';

const TARGET_EMAIL = (process.env.ADMIN_EMAIL || 'awwalsaminu9@gmail.com').toLowerCase().trim();
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/givehub';

import AdminSyncService from '../services/adminSyncService';

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
    admin.passwordHash = passwordHash;
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

  // 2. Harmonize & Sync with User model with identical _id and active wallets
  const user = await AdminSyncService.syncAdminUser(admin);
  console.log(`🌟 Success! User model "${user.fullName}" synchronized with Admin model (_id: ${user._id}).`);

  console.log('✨ Admin seed successfully completed.');
  await mongoose.disconnect();
  process.exit(0);
}

seedAdmin().catch((err) => {
  console.error('❌ Admin seed failed:', err);
  process.exit(1);
});
