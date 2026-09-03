const mongoose = require('mongoose');
const LedgerService = require('../../dist/services/ledgerService').default || require('../../dist/services/ledgerService');
const User = require('../../dist/models/User').default || require('../../dist/models/User');
const WalletAccount = require('../../dist/models/WalletAccount').default || require('../../dist/models/WalletAccount');
const LedgerEntry = require('../../dist/models/LedgerEntry').default || require('../../dist/models/LedgerEntry');

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
    await WalletAccount.deleteMany({});
    await LedgerEntry.deleteMany({});
  }
});


describe('LedgerService & Wallet Balance Reservation', () => {
  it('should credit wallet balance and log a credit LedgerEntry', async () => {
    const user = await User.create({
      fullName: 'Test Host',
      email: 'host@example.com',
      passwordHash: 'hashed',
    });

    const refId = new mongoose.Types.ObjectId();
    const wallet = await LedgerService.creditWallet({
      userId: user._id,
      currency: 'NGN',
      amount: 500000, // ₦5,000 in kobo
      referenceType: 'PaystackTransaction',
      referenceId: refId,
    });

    expect(wallet.available).toBe(500000);
    expect(wallet.reserved).toBe(0);

    const ledger = await LedgerEntry.findOne({ user: user._id, currency: 'NGN' });
    expect(ledger).toBeTruthy();
    expect(ledger.amount).toBe(500000);
    expect(ledger.direction).toBe('credit');
    expect(ledger.type).toBe('fund');
  });

  it('should lock funds from available to reserved when creating a giveaway', async () => {
    const user = await User.create({
      fullName: 'Test Host 2',
      email: 'host2@example.com',
      passwordHash: 'hashed',
    });

    const refId = new mongoose.Types.ObjectId();
    await LedgerService.creditWallet({
      userId: user._id,
      currency: 'NGN',
      amount: 1000000, // ₦10,000
      referenceType: 'PaystackTransaction',
      referenceId: refId,
    });

    const giveawayId = new mongoose.Types.ObjectId();
    const updatedWallet = await LedgerService.reserveForGiveaway({
      userId: user._id,
      currency: 'NGN',
      amount: 500000, // ₦5,000
      giveawayId,
    });

    expect(updatedWallet.available).toBe(500000);
    expect(updatedWallet.reserved).toBe(500000);

    const reserveEntry = await LedgerEntry.findOne({ type: 'reserve' });
    expect(reserveEntry.amount).toBe(500000);
    expect(reserveEntry.direction).toBe('debit');
  });

  it('should throw an error if available balance is insufficient', async () => {
    const user = await User.create({
      fullName: 'Poor Host',
      email: 'poor@example.com',
      passwordHash: 'hashed',
    });

    const giveawayId = new mongoose.Types.ObjectId();
    await expect(
      LedgerService.reserveForGiveaway({
        userId: user._id,
        currency: 'NGN',
        amount: 500000,
        giveawayId,
      })
    ).rejects.toThrow(/Insufficient NGN balance/);
  });
});
