import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';

let io: SocketIOServer;

export function initSocket(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    path: '/socket.io',
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket: Socket) => {
    // User joins their session room
    socket.on('join_session', (sessionId: string) => {
      if (typeof sessionId === 'string' && sessionId.trim()) {
        socket.join(`session:${sessionId.trim()}`);
      }
    });

    // User leaves session room
    socket.on('leave_session', (sessionId: string) => {
      if (typeof sessionId === 'string' && sessionId.trim()) {
        socket.leave(`session:${sessionId.trim()}`);
      }
    });

    // Admin joins the admins room (validates JWT)
    socket.on('join_admin', (token: string) => {
      try {
        const secret = process.env.JWT_SECRET || 'sprinkl_secret';
        const decoded: any = jwt.verify(token, secret);
        if (decoded && decoded.role === 'admin') {
          socket.join('admins');
          socket.emit('admin_joined', { ok: true });
        }
      } catch {
        socket.emit('admin_joined', { ok: false, error: 'Unauthorized' });
      }
    });

    socket.on('disconnect', () => {
      // cleanup handled automatically by socket.io room tracking
    });
  });

  return io;
}

export function getIO(): SocketIOServer {
  if (!io) throw new Error('Socket.IO not initialized. Call initSocket(httpServer) first.');
  return io;
}

/**
 * Emit an event to everyone in a specific support session room.
 */
export function emitToSession(sessionId: string, event: string, data: unknown): void {
  try {
    getIO().to(`session:${sessionId}`).emit(event, data);
  } catch {
    // Socket not ready — safe to ignore (HTTP path still works)
  }
}

/**
 * Emit an event to all connected admins.
 */
export function emitToAdmins(event: string, data: unknown): void {
  try {
    getIO().to('admins').emit(event, data);
  } catch {
    // Safe to ignore
  }
}
