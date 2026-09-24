import { can, type RealtimeEvent, type Role } from '@ovl/shared';
import type { WebSocket } from 'ws';

interface Connection {
  role: Role;
  sockets: Set<WebSocket>;
}

/**
 * Keeps track of connected WebSocket clients per user and fans events out to them.
 * Single-instance for now; to scale horizontally put a pub/sub (Redis or Postgres
 * LISTEN/NOTIFY) in front of `sendToUsers` / `broadcast`.
 */
export class RealtimeHub {
  private readonly connections = new Map<string, Connection>();
  private readonly bySession = new Map<string, Set<WebSocket>>();

  add(userId: string, role: Role, socket: WebSocket, sessionId: string | null = null): void {
    const existing = this.connections.get(userId);
    if (existing) {
      existing.role = role;
      existing.sockets.add(socket);
    } else {
      this.connections.set(userId, { role, sockets: new Set([socket]) });
    }
    if (sessionId) {
      const sockets = this.bySession.get(sessionId) ?? new Set();
      sockets.add(socket);
      this.bySession.set(sessionId, sockets);
    }
  }

  remove(userId: string, socket: WebSocket, sessionId: string | null = null): void {
    const existing = this.connections.get(userId);
    if (existing) {
      existing.sockets.delete(socket);
      if (existing.sockets.size === 0) this.connections.delete(userId);
    }
    if (sessionId) {
      const sockets = this.bySession.get(sessionId);
      sockets?.delete(socket);
      if (sockets?.size === 0) this.bySession.delete(sessionId);
    }
  }

  /** Disconnect signed-out sessions. 4401 tells clients to refresh, which then fails. */
  closeSessions(sessionIds: Iterable<string>): void {
    for (const id of sessionIds) {
      for (const socket of this.bySession.get(id) ?? []) socket.close(4401, 'Session signed out');
    }
  }

  /** Keep the cached role in sync when an account's role changes. */
  updateRole(userId: string, role: Role): void {
    const existing = this.connections.get(userId);
    if (existing) existing.role = role;
  }

  isOnline(userId: string): boolean {
    return this.connections.has(userId);
  }

  get onlineCount(): number {
    return this.connections.size;
  }

  /** Connected users allowed to answer tech support. */
  supportStaffIds(): string[] {
    return [...this.connections].filter(([, c]) => can(c.role, 'support.answer')).map(([id]) => id);
  }

  sendToUsers(userIds: Iterable<string>, event: RealtimeEvent): void {
    const payload = JSON.stringify(event);
    for (const id of new Set(userIds)) {
      const connection = this.connections.get(id);
      if (!connection) continue;
      for (const socket of connection.sockets) {
        if (socket.readyState === socket.OPEN) socket.send(payload);
      }
    }
  }

  broadcast(event: RealtimeEvent): void {
    this.sendToUsers(this.connections.keys(), event);
  }

  closeAll(): void {
    for (const { sockets } of this.connections.values())
      for (const s of sockets) s.close(1001, 'Server shutting down');
    this.connections.clear();
    this.bySession.clear();
  }
}
