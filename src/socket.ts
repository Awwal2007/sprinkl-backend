import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import User from './models/User';

let io: SocketIOServer;

// In-memory mapping of active socket connections
// Map<socketId, { userId?: string; email?: string; connectedAt: Date; lastPing: Date }>
const activeSocketConnections = new Map<
  string,
  { userId?: string; email?: string; connectedAt: Date; lastPing: Date }
>();

// Map<userId, Set<socketId>>
const userSocketMap = new Map<string, Set<string>>();

export function getOnlineUserIds(): string[] {
  return Array.from(userSocketMap.keys());
}

export function getOnlineUsersCount(): number {
  return userSocketMap.size;
}

export function getTotalActiveConnections(): number {
  return activeSocketConnections.size;
}

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
    activeSocketConnections.set(socket.id, {
      connectedAt: new Date(),
      lastPing: new Date(),
    });

    // Notify admins of connection count update
    emitToAdmins('active_stats_update', {
      onlineUsersCount: getOnlineUsersCount(),
      activeConnections: getTotalActiveConnections(),
    });

    // User identifies themselves (sends JWT token or userId)
    socket.on('identify_user', async (data: { token?: string; userId?: string }) => {
      try {
        let identifiedUserId: string | null = null;
        let userEmail: string | null = null;

        if (data.token) {
          const secret =
            process.env.JWT_ACCESS_SECRET ||
            'givehub_jwt_access_secret_sprinkl_2026_super_key';
          const decoded: any = jwt.verify(data.token, secret);
          if (decoded && decoded.userId) {
            identifiedUserId = String(decoded.userId);
          }
        } else if (data.userId) {
          identifiedUserId = String(data.userId);
        }

        if (identifiedUserId) {
          const socketInfo = activeSocketConnections.get(socket.id);
          if (socketInfo) {
            socketInfo.userId = identifiedUserId;
          }

          if (!userSocketMap.has(identifiedUserId)) {
            userSocketMap.set(identifiedUserId, new Set());
          }
          userSocketMap.get(identifiedUserId)!.add(socket.id);

          socket.join(`user:${identifiedUserId}`);

          // Update user status in database asynchronously
          try {
            await User.findByIdAndUpdate(identifiedUserId, {
              isOnline: true,
              lastActiveAt: new Date(),
            });
          } catch {
            // Safe to ignore DB error on socket hook
          }

          socket.emit('identified', { ok: true, userId: identifiedUserId });

          // Broadcast updated online count to all admins
          emitToAdmins('active_stats_update', {
            onlineUsersCount: getOnlineUsersCount(),
            activeConnections: getTotalActiveConnections(),
          });
        }
      } catch (err) {
        socket.emit('identified', { ok: false, error: 'Invalid token' });
      }
    });

    // Heartbeat / ping from user browser
    socket.on('user_ping', async () => {
      const conn = activeSocketConnections.get(socket.id);
      if (conn) {
        conn.lastPing = new Date();
        if (conn.userId) {
          User.findByIdAndUpdate(conn.userId, {
            isOnline: true,
            lastActiveAt: new Date(),
          }).catch(() => {});
        }
      }
      socket.emit('user_pong', { timestamp: Date.now() });
    });

    // User joins their session room (support chat)
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
        const secret =
          process.env.JWT_ACCESS_SECRET ||
          process.env.JWT_SECRET ||
          'givehub_jwt_access_secret_sprinkl_2026_super_key';
        const decoded: any = jwt.verify(token, secret);
        if (decoded && (decoded.role === 'admin' || decoded.isAdmin)) {
          socket.join('admins');
          socket.emit('admin_joined', {
            ok: true,
            onlineUsersCount: getOnlineUsersCount(),
            activeConnections: getTotalActiveConnections(),
          });
        } else {
          socket.emit('admin_joined', { ok: false, error: 'Unauthorized' });
        }
      } catch {
        socket.emit('admin_joined', { ok: false, error: 'Invalid token' });
      }
    });

    socket.on('disconnect', async () => {
      const conn = activeSocketConnections.get(socket.id);
      const userId = conn?.userId;

      activeSocketConnections.delete(socket.id);

      if (userId && userSocketMap.has(userId)) {
        const sockets = userSocketMap.get(userId)!;
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          userSocketMap.delete(userId);
          // Mark user as offline in database
          try {
            await User.findByIdAndUpdate(userId, {
              isOnline: false,
              lastActiveAt: new Date(),
            });
          } catch {
            // Ignore DB error
          }
        }
      }

      emitToAdmins('active_stats_update', {
        onlineUsersCount: getOnlineUsersCount(),
        activeConnections: getTotalActiveConnections(),
      });
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
    // Socket not ready — safe to ignore
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
