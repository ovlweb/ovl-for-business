import { can, type RealtimeEvent, type Role } from '@ovl/shared';
import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';

interface Connection {
  role: Role;
  sockets: Set<WebSocket>;
}

/** What instances tell each other: an event and who it is for, or sessions to close. */
export interface Envelope {
  /** The instance that published it. */
  o: string;
  e?: RealtimeEvent;
  /** For these users. */
  u?: string[];
  /** For connected tech-support staff, except the users in `x`. */
  s?: boolean;
  x?: string[];
  /** For everyone connected. */
  b?: boolean;
  /** Close these sessions' sockets (signed out). */
  c?: string[];
}

/** Carries envelopes between instances and knows who is connected where. */
export interface Broker {
  publish(envelope: Envelope): void;
  presence(userId: string, online: boolean): void;
  /** Which of these users have a connection on another instance. */
  onlineElsewhere(userIds: string[]): Promise<Set<string>>;
}

/**
 * Keeps track of connected WebSocket clients per user and fans events out to them. With a broker
 * (Postgres LISTEN/NOTIFY), every event also reaches the sockets held by the other instances.
 */
export class RealtimeHub {
  private readonly connections = new Map<string, Connection>();
  private readonly bySession = new Map<string, Set<WebSocket>>();
  private broker: Broker | null = null;

  constructor(readonly instanceId: string = randomUUID()) {}

  useBroker(broker: Broker) {
    this.broker = broker;
  }

  add(userId: string, role: Role, socket: WebSocket, sessionId: string | null = null): void {
    const existing = this.connections.get(userId);
    if (existing) {
      existing.role = role;
      existing.sockets.add(socket);
    } else {
      this.connections.set(userId, { role, sockets: new Set([socket]) });
      this.broker?.presence(userId, true);
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
      if (existing.sockets.size === 0) {
        this.connections.delete(userId);
        this.broker?.presence(userId, false);
      }
    }
    if (sessionId) {
      const sockets = this.bySession.get(sessionId);
      sockets?.delete(socket);
      if (sockets?.size === 0) this.bySession.delete(sessionId);
    }
  }

  /** Disconnect signed-out sessions everywhere. 4401 tells clients to refresh, which then fails. */
  closeSessions(sessionIds: Iterable<string>): void {
    const ids = [...sessionIds];
    this.closeLocalSessions(ids);
    if (ids.length) this.broker?.publish({ o: this.instanceId, c: ids });
  }

  private closeLocalSessions(ids: string[]) {
    for (const id of ids) {
      for (const socket of this.bySession.get(id) ?? []) socket.close(4401, 'Session signed out');
    }
  }

  /** Keep the cached role in sync when an account's role changes. */
  updateRole(userId: string, role: Role): void {
    const existing = this.connections.get(userId);
    if (existing) existing.role = role;
  }

  /** Connected to this instance. */
  isOnline(userId: string): boolean {
    return this.connections.has(userId);
  }

  /** Which of these users are connected to any instance. */
  async onlineAmong(userIds: Iterable<string>): Promise<Set<string>> {
    const ids = [...new Set(userIds)];
    const online = new Set(ids.filter((id) => this.connections.has(id)));
    const rest = ids.filter((id) => !online.has(id));
    if (this.broker && rest.length) for (const id of await this.broker.onlineElsewhere(rest)) online.add(id);
    return online;
  }

  /** Connections on this instance. */
  get onlineCount(): number {
    return this.connections.size;
  }

  sendToUsers(userIds: Iterable<string>, event: RealtimeEvent): void {
    const ids = [...new Set(userIds)];
    if (!ids.length) return;
    this.deliver(ids, JSON.stringify(event));
    this.broker?.publish({ o: this.instanceId, e: event, u: ids });
  }

  /** Everyone connected who answers tech support (they see every ticket). */
  sendToSupportStaff(event: RealtimeEvent, except: string[] = []): void {
    this.deliver(this.localStaff(except), JSON.stringify(event));
    this.broker?.publish({ o: this.instanceId, e: event, s: true, x: except });
  }

  broadcast(event: RealtimeEvent): void {
    this.deliver(this.connections.keys(), JSON.stringify(event));
    this.broker?.publish({ o: this.instanceId, e: event, b: true });
  }

  /** An envelope published by another instance: hand it to our own sockets. */
  receive(envelope: Envelope): void {
    if (envelope.o === this.instanceId) return;
    if (envelope.c) this.closeLocalSessions(envelope.c);
    if (!envelope.e) return;
    const payload = JSON.stringify(envelope.e);
    if (envelope.b) this.deliver(this.connections.keys(), payload);
    if (envelope.u) this.deliver(envelope.u, payload);
    if (envelope.s) this.deliver(this.localStaff(envelope.x ?? []), payload);
  }

  private localStaff(except: string[]) {
    return [...this.connections]
      .filter(([id, c]) => can(c.role, 'support.answer') && !except.includes(id))
      .map(([id]) => id);
  }

  private deliver(userIds: Iterable<string>, payload: string) {
    for (const id of new Set(userIds)) {
      const connection = this.connections.get(id);
      if (!connection) continue;
      for (const socket of connection.sockets) {
        if (socket.readyState === socket.OPEN) socket.send(payload);
      }
    }
  }

  closeAll(): void {
    for (const { sockets } of this.connections.values())
      for (const s of sockets) s.close(1001, 'Server shutting down');
    this.connections.clear();
    this.bySession.clear();
  }
}
