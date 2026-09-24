import type { RealtimeClientMessage, RealtimeEvent } from '@ovl/shared';
import type { OvlClient } from './client';

export type RealtimeStatus = 'connecting' | 'open' | 'closed';

/**
 * Auto-reconnecting WebSocket connection to /api/v1/realtime.
 * Works with the WebSocket global of browsers, React Native, Node 22+, Tauri and Capacitor.
 */
export class RealtimeConnection {
  private socket: WebSocket | null = null;
  private readonly listeners = new Set<(event: RealtimeEvent) => void>();
  private readonly statusListeners = new Set<(status: RealtimeStatus) => void>();
  private stopped = false;
  private attempts = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  status: RealtimeStatus = 'connecting';

  constructor(private readonly client: OvlClient) {
    this.connect();
  }

  private url(token: string): string {
    const loc = (globalThis as { location?: { protocol: string; host: string } }).location;
    const origin = this.client.baseUrl || (loc ? `${loc.protocol}//${loc.host}` : '');
    return `${origin.replace(/^http/, 'ws')}/api/v1/realtime?token=${encodeURIComponent(token)}`;
  }

  private setStatus(status: RealtimeStatus) {
    this.status = status;
    for (const l of this.statusListeners) l(status);
  }

  private connect() {
    if (this.stopped) return;
    const tokens = this.client.tokens.get();
    if (!tokens) return this.setStatus('closed');
    this.setStatus('connecting');
    const socket = new WebSocket(this.url(tokens.accessToken));
    this.socket = socket;
    socket.onopen = () => {
      this.attempts = 0;
      this.setStatus('open');
    };
    socket.onmessage = (message) => {
      let event: RealtimeEvent;
      try {
        event = JSON.parse(String(message.data)) as RealtimeEvent;
      } catch {
        return;
      }
      for (const l of this.listeners) l(event);
    };
    socket.onclose = async (event) => {
      this.socket = null;
      this.setStatus('closed');
      if (this.stopped) return;
      // 4401: the access token expired — refresh it before reconnecting.
      if (event.code === 4401 && !(await this.client.refresh())) return;
      const delay = Math.min(30_000, 1000 * 2 ** this.attempts++);
      this.timer = setTimeout(() => this.connect(), delay);
    };
  }

  on(listener: (event: RealtimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: (status: RealtimeStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  send(message: RealtimeClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  typing(chatId: string): void {
    this.send({ type: 'typing', chatId });
  }

  close(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.socket?.close(1000, 'Client closed');
    this.listeners.clear();
    this.statusListeners.clear();
  }
}
