const mongoose = require('mongoose');
const Giveaway = require('../../dist/models/Giveaway').default || require('../../dist/models/Giveaway');
const Claim = require('../../dist/models/Claim').default || require('../../dist/models/Claim');
const User = require('../../dist/models/User').default || require('../../dist/models/User');

const TEST_MONGODB_URI = process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017/givehub_test';

beforeAll(async () => {
  try {
    await mongoose.connect(TEST_MONGODB_URI);
  } catch (e) {
    console.warn('MongoDB connection not available for test:', e.message);
  }
});

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
});

afterEach(async () => {
  if (mongoose.connection.readyState !== 0) {
    await User.deleteMany({});
    await Giveaway.deleteMany({});
    await Claim.deleteMany({});
  }
});


describe('Claim Uniqueness & Anti-Duplicate Enforcement', () => {
  it('should prevent double-claiming the same giveaway with identical bank account', async () => {
    const host = await User.create({
      fullName: 'Giveaway Host',
      email: 'host@test.com',
      passwordHash: 'hash',
    });

    const giveaway = await Giveaway.create({
      host: host._id,
      title: '₦50,000 Cash Drop',
      slug: 'test-drop-1',
      currency: 'NGN',
      amountPerRecipient: 500000, // ₦5,000
      totalSlots: 10,
      totalReservedAmount: 5000000,
      status: 'active',
    });

    // Ensure database indexes are created
    await Claim.syncIndexes();

    const claimant1 = new Claim({
      giveaway: giveaway._id,
      claimantName: 'John Doe',
      currency: 'NGN',
      destination: {
        bankCode: '058',
        accountNumber: '0123456789',
        normalized: '058:0123456789',
      },
      amount: 500000,
      idempotencyKey: 'IDEMP_1',
    });

    await claimant1.save();

    // Attempt second claim with same bank account (058:0123456789) on same giveaway
    const claimant2 = new Claim({
      giveaway: giveaway._id,
      claimantName: 'Duplicate John',
      currency: 'NGN',
      destination: {
        bankCode: '058',
        accountNumber: '0123456789',
        normalized: '058:0123456789',
      },
      amount: 500000,
      idempotencyKey: 'IDEMP_2',
    });

    let duplicateError = null;
    try {
      await claimant2.save();
    } catch (err) {
      duplicateError = err;
    }

    expect(duplicateError).toBeTruthy();
    expect(duplicateError.code).toBe(11000); // MongoDB duplicate key error code
  });

  it('should allow the same bank account to claim two DIFFERENT giveaways', async () => {
    const host = await User.create({
      fullName: 'Giveaway Host 2',
      email: 'host2@test.com',
      passwordHash: 'hash',
    });

    const giveawayA = await Giveaway.create({
      host: host._id,
      title: 'Giveaway A',
      slug: 'slug-a',
      currency: 'NGN',
      amountPerRecipient: 100000,
      totalSlots: 5,
      totalReservedAmount: 500000,
    });

    const giveawayB = await Giveaway.create({
      host: host._id,
      title: 'Giveaway B',
      slug: 'slug-b',
      currency: 'NGN',
      amountPerRecipient: 100000,
      totalSlots: 5,
      totalReservedAmount: 500000,
    });

    await Claim.syncIndexes();

    const claimA = await Claim.create({
      giveaway: giveawayA._id,
      claimantName: 'John Doe',
      currency: 'NGN',
      destination: {
        bankCode: '058',
        accountNumber: '0123456789',
        normalized: '058:0123456789',
      },
      amount: 100000,
      idempotencyKey: 'IDEMP_A',
    });

    const claimB = await Claim.create({
      giveaway: giveawayB._id,
      claimantName: 'John Doe',
      currency: 'NGN',
      destination: {
        bankCode: '058',
        accountNumber: '0123456789',
        normalized: '058:0123456789',
      },
      amount: 100000,
      idempotencyKey: 'IDEMP_B',
    });

    expect(claimA).toBeTruthy();
    expect(claimB).toBeTruthy();
  });
});
