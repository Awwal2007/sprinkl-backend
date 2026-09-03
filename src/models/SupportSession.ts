import { Schema, model, Document, Types } from 'mongoose';

export interface ISupportAttachment {
  fileId: Types.ObjectId;
  filename: string;
  contentType: string;
  size: number;
  uploadedAt: Date;
}

export interface ISupportSession extends Document {
  _id: Types.ObjectId;
  sessionId: string;
  user?: Types.ObjectId;
  name: string;
  email: string;
  status: 'active' | 'closed';
  closedAt?: Date;
  lastMessageAt: Date;
  lastMessageText?: string;
  unreadAdminCount?: number;
  isAgentRequested?: boolean;
  attachments: ISupportAttachment[];
  createdAt: Date;
  updatedAt: Date;
}

const supportSessionSchema = new Schema<ISupportSession>(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    name: { type: String, default: 'Guest Visitor', trim: true },
    email: { type: String, default: 'support-guest@sprinkl.biz', trim: true, lowercase: true },
    status: { type: String, enum: ['active', 'closed'], default: 'active', index: true },
    closedAt: { type: Date },
    lastMessageAt: { type: Date, default: Date.now },
    lastMessageText: { type: String, default: '' },
    unreadAdminCount: { type: Number, default: 0 },
    isAgentRequested: { type: Boolean, default: false },
    attachments: [
      {
        fileId: { type: Schema.Types.ObjectId, required: true },
        filename: { type: String, required: true },
        contentType: { type: String, default: 'application/octet-stream' },
        size: { type: Number, default: 0 },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

export default model<ISupportSession>('SupportSession', supportSessionSchema);
