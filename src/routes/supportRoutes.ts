import { Router } from 'express';
import {
  sendSupportMessage,
  getSupportSession,
  getAttachment,
  closeSupportSession,
} from '../controllers/supportController';
import { uploadAttachments } from '../middleware/upload';
import { optionalAuth } from '../middleware/auth';

const router = Router();

// Send message (handles multipart form data with GridFS attachments)
router.post('/message', optionalAuth, uploadAttachments.array('attachments', 5), sendSupportMessage);

// Get chat session details and message history
router.get('/session/:sessionId', getSupportSession);

// Stream attachment file directly from MongoDB GridFS
router.get('/attachment/:fileId', getAttachment);

// Close chat session and permanently delete all attachments from GridFS
router.post('/close/:sessionId', closeSupportSession);

export default router;
