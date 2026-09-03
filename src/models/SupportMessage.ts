import { Schema, model, Document, Types } from 'mongoose';

export interface IMessageAttachment {
  fileId: Types.ObjectId;
  filename: string;
  contentType: string;
  size: number;
}

export interface ISupportMessage extends Document {
  _id: Types.ObjectId;
  session: Types.ObjectId;
  sessionId: string;
  sender: 'user' | 'bot' | 'admin';
  senderName: string;
  text: string;
  attachments: IMessageAttachment[];
  createdAt: Date;
  updatedAt: Date;
}

const supportMessageSchema = new Schema<ISupportMessage>(
  {
    session: { type: Schema.Types.ObjectId, ref: 'SupportSession', required: true, index: true },
    sessionId: { type: String, required: true, index: true },
    sender: { type: String, enum: ['user', 'bot', 'admin'], default: 'user' },
    senderName: { type: String, default: 'User' },
    text: { type: String, required: true, trim: true },
    attachments: [
      {
        fileId: { type: Schema.Types.ObjectId, required: true },
        filename: { type: String, required: true },
        contentType: { type: String, default: 'application/octet-stream' },
        size: { type: Number, default: 0 },
      },
    ],
  },
  { timestamps: true }
);

export default model<ISupportMessage>('SupportMessage', supportMessageSchema);
