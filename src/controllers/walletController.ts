import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import LedgerService from '../services/ledgerService';
import LedgerEntry from '../models/LedgerEntry';
import WalletAccount from '../models/WalletAccount';
import flutterwaveService from '../services/flutterwaveService';
import cryptoService from '../services/cryptoService';
import NowPaymentsService from '../services/nowpaymentsService';
import CryptoDepositService from '../services/cryptoDepositService';
import Transaction from '../models/Transaction';
import { AuthRequest } from '../middleware/auth';
import Giveaway from '../models/Giveaway';

export const getWallet = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const actor: any = req.admin || req.user!;
    const userId = actor._id;

    const ngnWallet = await LedgerService.getOrCreateWallet(userId, 'NGN');
    const usdtWallet = await LedgerService.getOrCreateWallet(userId, 'USDT');

    const giveawayCount = await Giveaway.countDocuments({
      host: userId,
      status: { $ne: 'cancelled' },
    });
    const isPromo = giveawayCount < 3;
    const remainingPromoCount = Math.max(0, 3 - giveawayCount);
    const feePercentage = isPromo ? 2.5 : 5.0;

    const ledgerHistory = await LedgerEntry.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(20);

    return res.json({
      balances: {
        NGN: {
          available: ngnWallet.available,
          reserved: ngnWallet.reserved,
          total: ngnWallet.available + ngnWallet.reserved,
        },
        USDT: {
          available: usdtWallet.available,
          reserved: usdtWallet.reserved,
          total: usdtWallet.available + usdtWallet.reserved,
        },
      },
      feeTier: {
        giveawayCount,
        isPromo,
        remainingPromoCount,
        feePercentage,
      },
      dva: {
        accountNumber: actor.paystackDvaAccountNumber,
        bankName: actor.paystackDvaBankName,
      },
      cryptoAddresses: actor.cryptoDepositAddresses || [],
      ledgerHistory,
    });
  } catch (err) {
    next(err);
  }
};

export const setupNgnDva = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user: any = req.admin || req.user!;

    if (!user.paystackDvaAccountNumber) {
      const dvaInfo = await flutterwaveService.createVirtualAccount(user);
      if (!dvaInfo) {
        return res.status(502).json({ error: 'Could not create dedicated bank account. Please try again.' });
      }
      user.paystackDvaAccountNumber = dvaInfo.accountNumber;
      user.paystackDvaBankName = dvaInfo.bankName;
      user.paystackCustomerCode = dvaInfo.flwRef;
      if (typeof user.save === 'function') {
        await user.save();
      }
    }

    return res.json({
      message: 'Dedicated Virtual Account active',
      dva: {
        accountNumber: user.paystackDvaAccountNumber,
        bankName: user.paystackDvaBankName,
      },
    });
  } catch (err) {
    next(err);
  }
};

export const initializeFlutterwaveDeposit = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { amountNaira } = req.body;
    const amount = parseFloat(amountNaira);
    if (!amount || amount < 1000) {
      return res.status(400).json({ error: 'Minimum deposit is ₦1,000.' });
    }

    const user: any = req.admin || req.user!;
    const txRef = `DEP_${user._id}_${Date.now()}`;
    const flwSecret = process.env.FLUTTERWAVE_SECRET_KEY;

    if (!flwSecret) {
      return res.status(500).json({ error: 'Flutterwave gateway not configured.' });
    }

    const axios = (await import('axios')).default;
    const flwRes = await axios.post(
      'https://api.flutterwave.com/v3/payments',
      {
        tx_ref: txRef,
        amount,
        currency: 'NGN',
        redirect_url: `${process.env.DOMAIN || 'https://sprinkl.biz'}/dashboard?funded=true`,
        customer: {
          email: user.email,
          name: user.fullName,
          phonenumber: user.phone || '08000000000',
        },
        customizations: {
          title: 'Sprinkl Wallet Deposit',
          description: `Fund ₦${amount.toLocaleString()} into your host balance`,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${flwSecret}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (flwRes.data && flwRes.data.status === 'success') {
      // Record pending transaction in DB so background sync can verify it anytime
      const amountKobo = Math.round(amount * 100);
      await Transaction.findOneAndUpdate(
        { provider: 'flutterwave', providerReference: txRef },
        {
          user: user._id,
          provider: 'flutterwave',
          providerReference: txRef,
          direction: 'inbound',
          currency: 'NGN',
          amount: amountKobo,
          status: 'pending',
          rawPayload: flwRes.data,
        },
        { upsert: true, new: true }
      );

      return res.json({
        paymentLink: flwRes.data.data.link,
      });
    }

    return res.status(400).json({
      error: flwRes.data?.message || 'Failed to initialize Flutterwave payment.',
    });
  } catch (err: any) {
    console.error('[Flutterwave Init Error]', err.response?.data || err.message);
    return res.status(500).json({
      error: err.response?.data?.message || err.message || 'Payment initialization failed.',
    });
  }
};

export const getUsdtDepositAddress = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { chain = 'TRC20' } = req.body;
    const user: any = req.admin || req.user!;

    // Always derive from configured hot wallet — never serve stale cached fake addresses
    let address: string;
    try {
      address = cryptoService.generateDepositAddress(user._id.toString(), chain);
    } catch (configErr: any) {
      return res.status(503).json({
        error: `${chain} deposits are currently unavailable: ${configErr.message}`,
      });
    }

    if (!user.cryptoDepositAddresses) {
      user.cryptoDepositAddresses = [];
    }

    // Persist so we have a record, but always override with the real env address
    const existing = user.cryptoDepositAddresses.find((a) => a.chain === chain);
    if (!existing) {
      user.cryptoDepositAddresses.push({ chain, address, createdAt: new Date() });
      if (typeof user.save === 'function') await user.save();
    } else if (existing.address !== address) {
      // Update stale/fake cached address
      existing.address = address;
      if (typeof user.save === 'function') await user.save();
    }

    return res.json({
      chain,
      address,
    });
  } catch (err) {
    next(err);
  }
};

export const createNowPaymentsDepositInvoice = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { amountUsdt, chain = 'TRC20' } = req.body;
    const user: any = req.admin || req.user!;

    // Enforce network-aware minimums (Tron TRC-20 has ~11.45 USDT network minimum on NOWPayments)
    const minAmount = chain === 'TRC20' ? 12 : 1;
    if (!amountUsdt || Number(amountUsdt) < minAmount) {
      return res.status(400).json({
        error: `Minimum USDT deposit on ${chain} is $${minAmount}. ${chain === 'TRC20' ? 'For smaller deposits (from $1), please select BEP-20 (BSC).' : ''}`.trim(),
      });
    }

    // Exclusively use NOWPayments gateway
    const npInvoice = await NowPaymentsService.createDepositInvoice({
      amountUsdt: Number(amountUsdt),
      userId: user._id.toString(),
      chain,
      email: user.email,
    });

    const amountUsdtUnits = Math.round(Number(amountUsdt) * 1000000);
    await Transaction.findOneAndUpdate(
      { provider: 'nowpayments', providerReference: String(npInvoice.paymentId) },
      {
        user: user._id,
        provider: 'nowpayments',
        providerReference: String(npInvoice.paymentId),
        direction: 'inbound',
        currency: 'USDT',
        amount: amountUsdtUnits,
        status: 'pending',
        rawPayload: npInvoice,
      },
      { upsert: true, new: true }
    );

    const invoice = {
      trackId: npInvoice.paymentId,
      paymentId: npInvoice.paymentId,
      payAddress: npInvoice.payAddress,
      qrCode: npInvoice.qrCode,
      amount: npInvoice.amount,
      currency: 'USDT',
      network: npInvoice.network,
      provider: 'nowpayments',
    };

    return res.json({ invoice });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to create crypto deposit invoice' });
  }
};
export const createOxaPayDepositInvoice = createNowPaymentsDepositInvoice;
export const createCryptoDepositInvoice = createNowPaymentsDepositInvoice;

export const releaseReservedFundsToAvailable = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const currency = (req.body.currency || 'NGN').toUpperCase() as 'NGN' | 'USDT';
    const userId = req.user!._id;

    // 1. Only find CANCELLED giveaways for this user in this currency that haven't released funds yet
    const cancelledGiveaways = await Giveaway.find({
      host: userId,
      currency,
      status: 'cancelled',
      fundsReleased: { $ne: true },
    }).session(session);

    if (cancelledGiveaways.length === 0) {
      await session.abortTransaction();
      return res.status(400).json({
        error: 'Transfer to main wallet is only allowed after a claim is cancelled. No cancelled giveaways with pending funds found.',
      });
    }

    for (const g of cancelledGiveaways) {
      g.fundsReleased = true;
      await g.save({ session });
    }

    // 2. Fetch or initialize the user's wallet
    let wallet = await WalletAccount.findOne({ user: userId, currency }).session(session);
    if (!wallet) {
      wallet = new WalletAccount({ user: userId, currency, available: 0, reserved: 0 });
    }

    const currentReserved = wallet.reserved || 0;
    if (currentReserved <= 0) {
      await session.abortTransaction();
      return res.status(400).json({ error: `You have no reserved ${currency} funds to transfer.` });
    }

    // Transfer the reserved funds directly to available
    const amountToTransfer = currentReserved;
    wallet.reserved = 0;
    wallet.available += amountToTransfer;
    await wallet.save({ session });

    // Record ledger entry with all required schema fields
    const refId = cancelledGiveaways[0]?._id || new mongoose.Types.ObjectId();
    await LedgerEntry.create(
      [
        {
          user: userId,
          currency,
          type: 'cancel',
          status: 'cancelled',
          direction: 'credit',
          amount: amountToTransfer,
          referenceType: 'Giveaway',
          referenceId: refId,
          balanceAfter: wallet.available + wallet.reserved,
          note: `Cancelled Giveaway Transfer: ${cancelledGiveaways.length} cancelled campaign(s) unspent funds transferred to main wallet`,
        },
      ],
      { session }
    );

    await session.commitTransaction();

    const formattedAmount =
      currency === 'NGN'
        ? `₦${(amountToTransfer / 100).toLocaleString()}`
        : `${(amountToTransfer / 1000000).toLocaleString()} USDT`;

    return res.json({
      message: `Successfully transferred ${formattedAmount} back to your main available balance!`,
      wallet: {
        available: wallet.available,
        reserved: wallet.reserved,
      },
    });
  } catch (err) {
    await session.abortTransaction();
    next(err);
  } finally {
    session.endSession();
  }
};

export const checkNowPaymentsDepositStatus = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const trackId = String(req.body.trackId || req.body.paymentId || '').trim();
    if (!trackId) {
      return res.status(400).json({ error: 'Payment ID or Track ID is required' });
    }

    const user: any = req.admin || req.user!;

    // Strict ownership validation if transaction is already in DB
    const npTx = await Transaction.findOne({
      provider: 'nowpayments',
      providerReference: trackId,
    });

    if (npTx && npTx.user && npTx.user.toString() !== user._id.toString()) {
      return res.status(403).json({ error: 'This payment belongs to a different account.' });
    }

    const npStatus = await NowPaymentsService.checkPaymentStatus(trackId);
    if (!npStatus) {
      return res.json({
        status: 'Waiting',
        credited: false,
        message: 'Payment not found on NOWPayments yet. Awaiting blockchain confirmation.',
      });
    }

    const statusLower = (npStatus.payment_status || '').toLowerCase();
    const isPaid =
      statusLower === 'finished' ||
      statusLower === 'confirmed' ||
      statusLower === 'sending' ||
      statusLower === 'partially_paid';

    if (isPaid) {
      const amountGross = Number(npStatus.actually_paid || npStatus.pay_amount || npStatus.price_amount || 0);

      const result = await CryptoDepositService.processCredit({
        provider: 'nowpayments',
        providerReference: trackId,
        amountUsdtGross: amountGross,
        rawPayload: npStatus,
        expectedUserId: user._id.toString(),
        orderId: npStatus.order_id,
        network: npStatus.pay_currency,
      });

      if (!result.success) {
        return res.status(403).json({ error: result.error || 'Could not verify deposit.' });
      }

      const updatedWallet = await LedgerService.getOrCreateWallet(user._id, 'USDT');
      return res.json({
        status: 'Paid',
        credited: true,
        alreadyCredited: result.alreadyCredited || false,
        amount: result.amount,
        availableBalance: updatedWallet.available,
        message: result.alreadyCredited
          ? `Your USDT deposit of $${result.amount} has already been credited!`
          : `Successfully verified and credited $${result.amount} USDT to your wallet!`,
      });
    }

    return res.json({
      status: npStatus.payment_status || 'Waiting',
      credited: false,
      message: `Deposit status: ${npStatus.payment_status || 'Waiting for blockchain confirmation'}.`,
    });
  } catch (err: any) {
    console.error('[NOWPayments Status Check Error]:', err.message);
    return res.status(400).json({ error: err.message || 'Could not verify deposit status.' });
  }
};
export const checkOxaPayDepositStatus = checkNowPaymentsDepositStatus;
export const checkCryptoDepositStatus = checkNowPaymentsDepositStatus;

export const verifyFlutterwavePayment = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { transactionId, txRef } = req.body;
    const user: any = req.admin || req.user!;
    const flwSecret = process.env.FLUTTERWAVE_SECRET_KEY;

    if (!flwSecret) {
      return res.status(500).json({ error: 'Flutterwave secret key is not configured.' });
    }

    if (!transactionId && !txRef) {
      return res.status(400).json({ error: 'Transaction ID or tx_ref is required.' });
    }

    const axios = (await import('axios')).default;
    let flwData: any = null;

    if (transactionId) {
      const resp = await axios.get(`https://api.flutterwave.com/v3/transactions/${transactionId}/verify`, {
        headers: { Authorization: `Bearer ${flwSecret}` },
      });
      flwData = resp.data?.data;
    } else if (txRef) {
      const resp = await axios.get(
        `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`,
        {
          headers: { Authorization: `Bearer ${flwSecret}` },
        }
      );
      flwData = resp.data?.data;
    }

    if (!flwData || flwData.status !== 'successful') {
      return res.status(400).json({
        error: 'Payment could not be verified or is not marked as successful on Flutterwave.',
      });
    }

    // Strict ownership verification: ensure the transaction belongs to the calling user
    const userEmail = (user.email || '').toLowerCase().trim();
    const flwEmail = (flwData.customer?.email || '').toLowerCase().trim();
    const flwTxRef = String(flwData.tx_ref || '');
    const userIdStr = user._id.toString();

    const isOwner = (flwEmail && flwEmail === userEmail) || (flwTxRef && flwTxRef.includes(userIdStr));
    if (!isOwner) {
      return res.status(403).json({
        error: 'Ownership mismatch: This payment transaction belongs to a different user account.',
      });
    }

    const ref = flwData.tx_ref || String(transactionId);
    const existingTx = await Transaction.findOne({
      provider: 'flutterwave',
      providerReference: ref,
    });

    if (existingTx) {
      const wallet = await LedgerService.getOrCreateWallet(user._id, 'NGN');
      return res.json({
        success: true,
        alreadyCredited: true,
        amountNaira: flwData.amount,
        availableBalance: wallet.available,
        message: `Your deposit of ₦${Number(flwData.amount).toLocaleString()} has already been credited!`,
      });
    }

    const amountKobo = Math.round(flwData.amount * 100);
    const tx = await Transaction.create({
      user: user._id,
      provider: 'flutterwave',
      providerReference: ref,
      direction: 'inbound',
      currency: 'NGN',
      amount: amountKobo,
      status: 'success',
      rawPayload: flwData,
    });

    await LedgerService.creditWallet({
      userId: user._id,
      currency: 'NGN',
      amount: amountKobo,
      referenceType: 'FlutterwaveTransaction',
      referenceId: tx._id,
    });

    const updatedWallet = await LedgerService.getOrCreateWallet(user._id, 'NGN');

    return res.json({
      success: true,
      alreadyCredited: false,
      amountNaira: flwData.amount,
      availableBalance: updatedWallet.available,
      message: `Payment confirmed! ₦${Number(flwData.amount).toLocaleString()} credited to your wallet.`,
    });
  } catch (err: any) {
    console.error('[FLW Verify Error]:', err.response?.data || err.message);
    return res.status(400).json({
      error: err.response?.data?.message || err.message || 'Failed to verify transaction with Flutterwave.',
    });
  }
};

export const syncPendingDeposits = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user: any = req.admin || req.user!;
    const flwSecret = process.env.FLUTTERWAVE_SECRET_KEY;
    const axios = (await import('axios')).default;

    // Find pending inbound transactions for this user
    const pendingTxs = await Transaction.find({
      user: user._id,
      direction: 'inbound',
      status: 'pending',
    }).sort({ createdAt: -1 }).limit(10);

    const creditedResults: string[] = [];

    for (const tx of pendingTxs) {
      try {
        if (tx.provider === 'nowpayments' && tx.providerReference) {
          const npStatus = await NowPaymentsService.checkPaymentStatus(tx.providerReference);
          const status = (npStatus?.payment_status || '').toString().toLowerCase();
          const isPaid =
            status === 'finished' || status === 'confirmed' || status === 'sending' || status === 'partially_paid';

          if (isPaid) {
            const amountGross = Number(npStatus.actually_paid || npStatus.pay_amount || npStatus.price_amount || (tx.amount / 1000000));
            const result = await CryptoDepositService.processCredit({
              provider: 'nowpayments',
              providerReference: tx.providerReference,
              amountUsdtGross: amountGross,
              rawPayload: npStatus,
              expectedUserId: user._id.toString(),
            });

            if (result.success && !result.alreadyCredited) {
              creditedResults.push(`$${result.amount} USDT`);
            }
          }
        } else if (tx.provider === 'flutterwave' && tx.providerReference && flwSecret) {
          let flwData: any = null;
          try {
            const resp = await axios.get(
              `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(tx.providerReference)}`,
              {
                headers: { Authorization: `Bearer ${flwSecret}` },
                timeout: 7000,
              }
            );
            flwData = resp.data?.data;
          } catch {}

          if (flwData && flwData.status === 'successful') {
            const amountKobo = Math.round(flwData.amount * 100);
            tx.status = 'success';
            tx.amount = amountKobo;
            tx.rawPayload = flwData;
            await tx.save();

            await LedgerService.creditWallet({
              userId: user._id,
              currency: 'NGN',
              amount: amountKobo,
              referenceType: 'FlutterwaveTransaction',
              referenceId: tx._id,
            });

            creditedResults.push(`₦${Number(flwData.amount).toLocaleString()}`);
          }
        }
      } catch (err: any) {
        console.error(`[Sync Pending Error for tx ${tx._id}]:`, err.message);
      }
    }

    const ngnWallet = await LedgerService.getOrCreateWallet(user._id, 'NGN');
    const usdtWallet = await LedgerService.getOrCreateWallet(user._id, 'USDT');

    return res.json({
      success: true,
      creditedCount: creditedResults.length,
      creditedItems: creditedResults,
      balances: {
        NGN: ngnWallet,
        USDT: usdtWallet,
      },
      message:
        creditedResults.length > 0
          ? `Successfully synchronized and credited: ${creditedResults.join(', ')}!`
          : 'Balances are up to date.',
    });
  } catch (err) {
    next(err);
  }
};

export const manualResolveDeposit = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { reference } = req.body;
    if (!reference || typeof reference !== 'string') {
      return res.status(400).json({ error: 'Please enter a valid Transaction Hash, Track ID, or Reference.' });
    }

    const cleanRef = reference.trim();
    const user: any = req.admin || req.user!;
    const flwSecret = process.env.FLUTTERWAVE_SECRET_KEY;
    const axios = (await import('axios')).default;

    // Check if already processed
    const alreadyDone = await Transaction.findOne({
      providerReference: cleanRef,
      status: 'success',
    });

    if (alreadyDone) {
      return res.json({
        success: true,
        alreadyCredited: true,
        message: 'This deposit has already been verified and credited to your wallet balance!',
      });
    }

    // 1. Try NOWPayments Inquiry
    try {
      const npRes = await NowPaymentsService.checkPaymentStatus(cleanRef);
      if (npRes && npRes.payment_status) {
        const statusLower = (npRes.payment_status || '').toLowerCase();
        const isPaid =
          statusLower === 'finished' || statusLower === 'confirmed' || statusLower === 'sending' || statusLower === 'partially_paid';
        if (isPaid) {
          const amountGross = Number(npRes.actually_paid || npRes.pay_amount || npRes.price_amount || 0);

          const result = await CryptoDepositService.processCredit({
            provider: 'nowpayments',
            providerReference: cleanRef,
            amountUsdtGross: amountGross,
            rawPayload: npRes,
            expectedUserId: user._id.toString(),
            orderId: npRes.order_id,
            network: npRes.pay_currency,
          });

          if (!result.success) {
            return res.status(403).json({ error: result.error || 'Failed to resolve deposit.' });
          }

          return res.json({
            success: true,
            alreadyCredited: result.alreadyCredited || false,
            currency: 'USDT',
            amount: result.amount,
            message: result.alreadyCredited
              ? `This NOWPayments deposit of $${result.amount} USDT was already credited!`
              : `NOWPayments deposit verified! $${result.amount} USDT credited to your wallet.`,
          });
        }
      }
    } catch (e) {}

    // 2. Try Flutterwave by ID or tx_ref
    if (flwSecret) {
      try {
        let flwData: any = null;
        if (/^\d+$/.test(cleanRef)) {
          const resp = await axios.get(`https://api.flutterwave.com/v3/transactions/${cleanRef}/verify`, {
            headers: { Authorization: `Bearer ${flwSecret}` },
            timeout: 7000,
          });
          flwData = resp.data?.data;
        } else {
          const resp = await axios.get(
            `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(cleanRef)}`,
            {
              headers: { Authorization: `Bearer ${flwSecret}` },
              timeout: 7000,
            }
          );
          flwData = resp.data?.data;
        }

        if (flwData && flwData.status === 'successful') {
          // Strict ownership verification
          const userEmail = (user.email || '').toLowerCase().trim();
          const flwEmail = (flwData.customer?.email || '').toLowerCase().trim();
          const flwTxRef = String(flwData.tx_ref || '');
          const userIdStr = user._id.toString();

          const isOwner = (flwEmail && flwEmail === userEmail) || (flwTxRef && flwTxRef.includes(userIdStr));
          if (!isOwner) {
            return res.status(403).json({
              error: 'Ownership mismatch: This payment transaction does not belong to your account.',
            });
          }

          const amountKobo = Math.round(flwData.amount * 100);
          const tx = await Transaction.create({
            user: user._id,
            provider: 'flutterwave',
            providerReference: cleanRef,
            direction: 'inbound',
            currency: 'NGN',
            amount: amountKobo,
            status: 'success',
            rawPayload: flwData,
          });

          await LedgerService.creditWallet({
            userId: user._id,
            currency: 'NGN',
            amount: amountKobo,
            referenceType: 'FlutterwaveTransaction',
            referenceId: tx._id,
          });

          return res.json({
            success: true,
            currency: 'NGN',
            amount: flwData.amount,
            message: `Flutterwave payment verified! ₦${Number(flwData.amount).toLocaleString()} credited to your wallet.`,
          });
        }
      } catch (e) {}
    }

    return res.status(400).json({
      error: `Could not verify deposit reference "${cleanRef}". Please verify the reference or contact support.`,
    });
  } catch (err: any) {
    return res.status(400).json({
      error: err.message || 'Deposit resolution failed.',
    });
  }
};
