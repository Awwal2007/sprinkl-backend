import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { nanoid } from 'nanoid';
import SupportSession, { ISupportAttachment } from '../models/SupportSession';
import SupportMessage, { IMessageAttachment } from '../models/SupportMessage';
import gridfsService from '../services/gridfsService';
import emailService from '../services/emailService';

/**
 * Generate context-aware automated Bot reply
 */
function generateBotReply(text: string, hasAttachments: boolean): string {
  const lower = text.toLowerCase().trim();

  // 1. Direct Request for a Human Agent
  if (
    lower.includes('agent') ||
    lower.includes('human') ||
    lower.includes('representative') ||
    lower.includes('real person') ||
    lower.includes('talk to someone') ||
    lower.includes('speak to someone') ||
    lower.includes('support team') ||
    lower.includes('live support')
  ) {
    return 'Understood! I have flagged your conversation for a live human support agent. Our team has received an instant priority email notification with your message history, and a specialist will follow up with you directly via email and here in chat.';
  }

  // 2. Greetings
  if (
    lower === 'hi' ||
    lower === 'hello' ||
    lower === 'hey' ||
    lower.startsWith('hi ') ||
    lower.startsWith('hello ') ||
    lower.startsWith('hey ') ||
    lower.includes('good morning') ||
    lower.includes('good afternoon') ||
    lower.includes('good evening')
  ) {
    return 'Hello! Welcome to Sprinkl Support. I am your automated assistant trained to help with Sprinkl giveaways, wallet funding, payouts, fees, and fraud prevention. How can I assist you today? If your issue requires personalized help, feel free to request an agent anytime!';
  }

  // 3. Funding / Deposit / Wallet Inquiries
  if (
    lower.includes('deposit') ||
    lower.includes('fund') ||
    lower.includes('wallet') ||
    lower.includes('top up') ||
    lower.includes('topup') ||
    lower.includes('bank transfer') ||
    lower.includes('paystack') ||
    lower.includes('flutterwave') ||
    lower.includes('virtual account') ||
    lower.includes('dva')
  ) {
    return 'Here is how wallet funding works on Sprinkl:\n\n• Nigerian Naira (NGN): Instant bank transfers via your dedicated virtual account or Flutterwave checkout credit your wallet automatically within seconds.\n• USDT (Crypto): Multi-user TRC20 and BEP20 automated gateway deposits are currently undergoing merchant verification and will activate shortly.\n\nIf you have already sent funds and need help verifying a transaction, please attach your payment receipt or request a human agent!';
  }

  // 4. Failed Payouts / Cancellations / Refunds
  if (
    lower.includes('failed') ||
    lower.includes('fail') ||
    lower.includes('cancel') ||
    lower.includes('refund') ||
    lower.includes('unspent') ||
    lower.includes('reversal') ||
    lower.includes('declined')
  ) {
    return 'Here is how failed claims and cancellations are handled on Sprinkl:\n\n• Failed Payouts: If a recipient bank rejects a transfer (e.g. invalid account or bank downtime), the claim is recorded as "Failed" in your ledger with zero funds lost, and the giveaway slot is returned automatically.\n• Cancelled Giveaways: When you cancel a giveaway, all remaining unspent funds are credited back to your available wallet balance immediately.\n\nIf you need an agent to review a specific transaction ID, please reply with "Request Agent".';
  }

  // 5. Double-Claims / Anti-Fraud Engine
  if (
    lower.includes('double') ||
    lower.includes('cheat') ||
    lower.includes('fraud') ||
    lower.includes('sybil') ||
    lower.includes('duplicate') ||
    lower.includes('bot') ||
    lower.includes('exploit') ||
    lower.includes('lock')
  ) {
    return 'Sprinkl guarantees zero double-claims! Our engine enforces database-level atomic unique constraints on recipient bank accounts and crypto wallet addresses per giveaway. Once a bank account or crypto address claims a prize, all subsequent attempts with that destination are atomically rejected.';
  }

  // 6. Fees / Pricing / Rates
  if (
    lower.includes('fee') ||
    lower.includes('charge') ||
    lower.includes('cost') ||
    lower.includes('pricing') ||
    lower.includes('percentage') ||
    lower.includes('rate') ||
    lower.includes('commission') ||
    lower.includes('whale')
  ) {
    return 'Sprinkl operates with transparent, competitive pricing:\n\n• New Creator Privilege: Your first 3 giveaways enjoy our promotional 2.5% platform fee (floor: ₦250 or $0.50 USDT).\n• Standard Rate: 5.0% platform fee.\n• Whale Tier: Drops of ₦1,000,000+ ($1,000+ USDT) enjoy a discounted 3.0% fee, capped at ₦35,000 ($35 USDT max).\n\nThere are zero hidden withdrawal charges.';
  }

  // 7. Creating / Hosting a Giveaway
  if (
    lower.includes('how to create') ||
    lower.includes('how to host') ||
    lower.includes('start a giveaway') ||
    lower.includes('launch giveaway') ||
    lower.includes('create giveaway') ||
    lower.includes('giveaway link') ||
    lower.includes('qr code')
  ) {
    return 'To create a giveaway on Sprinkl:\n\n1. Sign in and visit your Dashboard.\n2. Click "Create Giveaway" and choose your currency (NGN or USDT).\n3. Set your prize per winner (minimum ₦500 / $0.20 USDT) and total recipient slots.\n4. Click "Publish". You will instantly receive a shareable link and QR code to post on Twitter, Instagram, TikTok, or WhatsApp!';
  }

  // 8. Claiming a Giveaway Prize
  if (
    lower.includes('how to claim') ||
    lower.includes('claim prize') ||
    lower.includes('claim money') ||
    lower.includes('claim giveaway') ||
    lower.includes('win money')
  ) {
    return 'To claim a prize from a Sprinkl giveaway:\n\n1. Open the public giveaway link (e.g. sprinkl.biz/g/slug).\n2. Select your bank and enter your 10-digit account number (or USDT wallet address).\n3. Confirm your details and submit. Your payout is dispatched instantly via automated bank transfer or on-chain crypto!';
  }

  // 9. If user attached a file without specific keywords
  if (hasAttachments) {
    return 'Thank you for providing the attachment/screenshot! I have forwarded your file directly to our support engineers via email. If you need a team member to step in, simply click "Request Human Agent" below.';
  }

  // 10. FALLBACK: Question does NOT relate to what the AI is trained for
  return "I'm sorry, but that question falls outside the topics I am trained on (Sprinkl giveaways, funding, payouts, fees, fraud prevention, and account management).\n\nPlease request a human agent by typing \"Request an Agent\" or clicking below, and a member of our support team will assist you directly!";
}

/**
 * Send a message in support chat (User to Bot/Admin)
 */
export const sendSupportMessage = async (req: any, res: Response, next: NextFunction) => {
  try {
    const { name, email, text } = req.body;
    let { sessionId } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Message text cannot be empty' });
    }

    if (!sessionId) {
      sessionId = `chat_${nanoid(12)}`;
    }

    // Find or create session
    let session = await SupportSession.findOne({ sessionId });
    const user = req.user;

    const senderName = name?.trim() || user?.fullName || session?.name || 'Guest User';
    const senderEmail = email?.trim() || user?.email || session?.email || 'guest@sprinkl.biz';

    if (!session) {
      session = new SupportSession({
        sessionId,
        user: user?._id,
        name: senderName,
        email: senderEmail,
        status: 'active',
        lastMessageAt: new Date(),
        attachments: [],
      });
    } else {
      if (session.status === 'closed') {
        session.status = 'active'; // reopen if user sends another message
      }
      session.name = senderName;
      session.email = senderEmail;
      session.lastMessageAt = new Date();
    }

    // Process file attachments through MongoDB GridFS
    const messageAttachments: IMessageAttachment[] = [];
    const files = (req.files as Express.Multer.File[]) || [];

    for (const file of files) {
      const fileId = await gridfsService.uploadFile(file.buffer, file.originalname, file.mimetype, {
        sessionId,
        senderName,
        uploadedAt: new Date(),
      });

      const attachmentInfo: ISupportAttachment = {
        fileId,
        filename: file.originalname,
        contentType: file.mimetype,
        size: file.size,
        uploadedAt: new Date(),
      };

      session.attachments.push(attachmentInfo);
      messageAttachments.push({
        fileId,
        filename: file.originalname,
        contentType: file.mimetype,
        size: file.size,
      });
    }

    await session.save();

    // 1. Create User Message
    const userMessage = await SupportMessage.create({
      session: session._id,
      sessionId,
      sender: 'user',
      senderName,
      text: text.trim(),
      attachments: messageAttachments,
    });

    // 2. Generate Domain Attachment URLs for email
    const domain = process.env.DOMAIN || 'https://www.sprinkl.biz';
    const emailAttachmentLinks = messageAttachments.map((att) => ({
      filename: att.filename,
      size: att.size,
      url: `${domain}/api/support/attachment/${att.fileId}`,
    }));

    // 3. Send Email Notification to Admin asynchronously
    emailService.sendSupportNotificationEmail({
      senderName,
      senderEmail,
      messageText: text.trim(),
      sessionId,
      attachments: emailAttachmentLinks,
    }).catch((err) => console.error('[Support Email Error]:', err));

    // 4. Generate automated Bot reply
    const botReplyText = generateBotReply(text.trim(), messageAttachments.length > 0);
    const botMessage = await SupportMessage.create({
      session: session._id,
      sessionId,
      sender: 'bot',
      senderName: 'Sprinkl Support Bot',
      text: botReplyText,
      attachments: [],
    });

    return res.status(201).json({
      sessionId: session.sessionId,
      session,
      userMessage,
      botReply: botMessage,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get active session messages and details
 */
export const getSupportSession = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sessionId } = req.params;

    const session = await SupportSession.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ error: 'Support session not found' });
    }

    const messages = await SupportMessage.find({ sessionId }).sort({ createdAt: 1 });

    return res.json({ session, messages });
  } catch (err) {
    next(err);
  }
};

/**
 * Stream an attachment directly from MongoDB GridFS
 */
export const getAttachment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fileId = String(req.params.fileId);

    if (!mongoose.Types.ObjectId.isValid(fileId)) {
      return res.status(400).json({ error: 'Invalid file ID' });
    }

    const file = await gridfsService.getFileInfo(fileId);
    if (!file) {
      return res.status(404).json({ error: 'Attachment file not found or has been deleted' });
    }

    res.setHeader('Content-Type', file.contentType || 'application/octet-stream');
    res.setHeader('Content-Length', file.length);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename)}"`);

    const downloadStream = gridfsService.getDownloadStream(fileId);
    downloadStream.on('error', (err) => next(err));
    downloadStream.pipe(res);
  } catch (err) {
    next(err);
  }
};

/**
 * Close chat session and permanently delete all attachments from MongoDB GridFS
 */
export const closeSupportSession = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = String(req.params.sessionId);

    const session = await SupportSession.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ error: 'Support session not found' });
    }

    // Collect all attachment file IDs associated with this session
    const fileIdsToDelete: mongoose.Types.ObjectId[] = [];

    if (session.attachments && session.attachments.length > 0) {
      session.attachments.forEach((att) => fileIdsToDelete.push(att.fileId));
    }

    // Also collect from messages if any were missed
    const messages = await SupportMessage.find({ sessionId });
    for (const msg of messages) {
      if (msg.attachments && msg.attachments.length > 0) {
        msg.attachments.forEach((att) => {
          if (!fileIdsToDelete.some((id) => id.toString() === att.fileId.toString())) {
            fileIdsToDelete.push(att.fileId);
          }
        });
      }
    }

    // Permanently delete all attachment files from MongoDB GridFS
    const deletedFilesCount = await gridfsService.deleteMultipleFiles(fileIdsToDelete);
    console.log(`[SupportSession Closed] Deleted ${deletedFilesCount} GridFS attachment(s) for session ${sessionId}`);

    // Mark session closed and clear attachment metadata
    session.status = 'closed';
    session.attachments = [];
    await session.save();

    // Clear attachment references in messages
    await SupportMessage.updateMany({ sessionId }, { $set: { attachments: [] } });

    // Add closing bot message
    const closingMessage = await SupportMessage.create({
      session: session._id,
      sessionId,
      sender: 'bot',
      senderName: 'Sprinkl Support Bot',
      text: `Chat session has been successfully closed. All uploaded attachments (${deletedFilesCount} file(s)) have been permanently purged from storage. Thank you for using Sprinkl!`,
      attachments: [],
    });

    return res.json({
      message: 'Chat session closed and all attachments permanently deleted from storage.',
      deletedFilesCount,
      closingMessage,
      session,
    });
  } catch (err) {
    next(err);
  }
};
