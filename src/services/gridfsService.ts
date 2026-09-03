import mongoose from 'mongoose';
import { Readable } from 'stream';

class GridFSService {
  private getBucket(): mongoose.mongo.GridFSBucket {
    if (!mongoose.connection.db) {
      throw new Error('Database not connected yet');
    }
    return new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
      bucketName: 'supportAttachments',
    });
  }

  /**
   * Uploads a file buffer directly to MongoDB GridFS.
   */
  async uploadFile(
    buffer: Buffer,
    filename: string,
    contentType: string,
    metadata?: Record<string, any>
  ): Promise<mongoose.Types.ObjectId> {
    const bucket = this.getBucket();
    const fileId = new mongoose.Types.ObjectId();

    return new Promise((resolve, reject) => {
      const readableStream = new Readable();
      readableStream.push(buffer);
      readableStream.push(null);

      const uploadStream = bucket.openUploadStreamWithId(fileId, filename, {
        contentType,
        metadata,
      });

      readableStream
        .pipe(uploadStream)
        .on('error', (error) => reject(error))
        .on('finish', () => resolve(fileId));
    });
  }

  /**
   * Returns a readable stream to download/stream the file from GridFS.
   */
  getDownloadStream(fileId: mongoose.Types.ObjectId | string) {
    const bucket = this.getBucket();
    const id = typeof fileId === 'string' ? new mongoose.Types.ObjectId(fileId) : fileId;
    return bucket.openDownloadStream(id);
  }

  /**
   * Retrieves file metadata from GridFS.
   */
  async getFileInfo(fileId: mongoose.Types.ObjectId | string) {
    const bucket = this.getBucket();
    const id = typeof fileId === 'string' ? new mongoose.Types.ObjectId(fileId) : fileId;
    const files = await bucket.find({ _id: id }).toArray();
    return files[0] || null;
  }

  /**
   * Permanently deletes a single file and its chunks from GridFS.
   */
  async deleteFile(fileId: mongoose.Types.ObjectId | string): Promise<boolean> {
    try {
      const bucket = this.getBucket();
      const id = typeof fileId === 'string' ? new mongoose.Types.ObjectId(fileId) : fileId;
      await bucket.delete(id);
      return true;
    } catch (err: any) {
      console.warn(`[GridFS] Error deleting file ${fileId}:`, err.message);
      return false;
    }
  }

  /**
   * Permanently deletes multiple files from GridFS.
   */
  async deleteMultipleFiles(fileIds: (mongoose.Types.ObjectId | string)[]): Promise<number> {
    let deletedCount = 0;
    for (const id of fileIds) {
      const success = await this.deleteFile(id);
      if (success) deletedCount++;
    }
    return deletedCount;
  }
}

export default new GridFSService();
