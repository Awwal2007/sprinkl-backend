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
  const lower = text.toLowerCase();

  if (lower.includes('deposit') || lower.includes('fund') || lower.includes('wallet')) {
    return 'Hi there! If you are inquiring about funding your wallet: Nigerian Naira (NGN) deposits via bank transfer are processed automatically in real-time. If you sent funds and have not seen your balance update, please share your transaction reference or receipt. For USDT crypto deposits, our automated gateway is currently undergoing merchant verification and will activate shortly!';
  }

  if (lower.includes('failed') || lower.includes('cancel') || lower.includes('refund')) {
    return 'Hello! If you experienced a failed claim or cancelled a giveaway: Unclaimed funds from cancelled giveaways are automatically returned to your available wallet balance. Any failed claim payouts are automatically flagged as "Failed" in your ledger with 0 loss of funds. A support agent has received your email notification with this chat transcript.';
  }

  if (lower.includes('double') || lower.includes('cheat') || lower.includes('fraud')) {
    return 'Sprinkl guarantees zero double-claims! Our engine enforces database-level atomic locks on bank accounts and crypto wallets. Once an account claims from a giveaway, no second claim is ever permitted.';
  }

  if (lower.includes('fee') || lower.includes('charge') || lower.includes('cost')) {
    return 'Sprinkl charges a low, transparent platform fee: First 3 giveaways enjoy our New Host Privilege at only 2.5% (minimum ₦250 / $0.50). Standard rate is 5%, with whale discounts (3% capped at ₦35,000) for pools over ₦1,000,000. No hidden charges!';
  }

  if (hasAttachments) {
    return 'Thank you for providing the screenshot/attachment! I have forwarded your message and files directly to our engineering and support lead via email. A team member will inspect your case shortly.';
  }

  return 'Thanks for reaching out to Sprinkl Support! Our automated assistant has logged your inquiry, and a real support agent has been notified via email. If you have screenshots or receipts, feel free to attach them below!';
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
