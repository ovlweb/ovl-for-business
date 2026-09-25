import type { RealtimeConnection, RealtimeStatus } from '@ovl/sdk';
import type { Chat, Message, RealtimeEvent } from '@ovl/shared';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import { useAuth } from './auth';
import { showNotification } from './notifications';

interface RealtimeState {
  status: RealtimeStatus;
  subscribe: (listener: (event: RealtimeEvent) => void) => () => void;
  typing: (chatId: string) => void;
}

const RealtimeContext = createContext<RealtimeState>({
  status: 'closed',
  subscribe: () => () => undefined,
  typing: () => undefined,
});

type MessagePages = InfiniteData<Message[], number | undefined>;

/** Keeps react-query caches fresh from server-pushed events. */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { me, reload } = useAuth();
  const queryClient = useQueryClient();
  const connection = useRef<RealtimeConnection | null>(null);
  const listeners = useRef(new Set<(event: RealtimeEvent) => void>());
  const [status, setStatus] = useState<RealtimeStatus>('closed');

  useEffect(() => {
    if (!me) return;
    const conn = api.realtime();
    connection.current = conn;
    conn.onStatus(setStatus);
    conn.on((event) => {
      switch (event.type) {
        case 'message.created':
        case 'message.updated': {
          const threadId = event.message.threadId;
          // Comments under a channel post live in their own list, not in the channel feed.
          queryClient.setQueryData<MessagePages>(
            threadId ? ['comments', event.chatId, threadId] : ['messages', event.chatId],
            (data) => {
              if (!data) return data;
              const [first = [], ...rest] = data.pages;
              const exists = data.pages.some((p) => p.some((m) => m.id === event.message.id));
              const pages = exists
                ? data.pages.map((p) => p.map((m) => (m.id === event.message.id ? event.message : m)))
                : [[event.message, ...first], ...rest];
              return { ...data, pages };
            },
          );
          if (threadId && !event.message.mentions.includes(me.id)) break;
          queryClient.invalidateQueries({ queryKey: ['chats'] });
          queryClient.invalidateQueries({ queryKey: ['support'] });
          // Application cards posted into the council / moderation chats: refresh the review queue.
          if (event.message.meta.applicationId) queryClient.invalidateQueries({ queryKey: ['applications'] });
          const sender = event.message.sender;
          if (event.type === 'message.created' && sender && sender.id !== me.id) {
            const chat = queryClient.getQueryData<Chat[]>(['chats'])?.find((c) => c.id === event.chatId);
            const route = chat ? `#/chats/${event.chatId}` : `#/support/${event.chatId}`;
            const mentioned = event.message.mentions.includes(me.id);
            const title =
              (mentioned ? 'Mentioned by ' : '') +
              (chat && chat.type !== 'direct' ? `${sender.displayName} · ${chat.title}` : sender.displayName);
            const body = event.message.body || (event.message.attachments.length ? 'Sent a file' : '');
            showNotification(title, body, event.chatId, () => {
              location.hash = route;
            });
          }
          break;
        }
        case 'chat.updated':
          queryClient.invalidateQueries({ queryKey: ['chats'] });
          queryClient.invalidateQueries({ queryKey: ['chat', event.chatId] });
          queryClient.invalidateQueries({ queryKey: ['support'] });
          break;
        case 'chat.removed':
          // We are no longer a member: drop the cached chat instead of refetching it (it would be 403).
          queryClient.removeQueries({ queryKey: ['chat', event.chatId], type: 'inactive' });
          queryClient.removeQueries({ queryKey: ['messages', event.chatId], type: 'inactive' });
          queryClient.invalidateQueries({ queryKey: ['chats'] });
          break;
        case 'application.updated':
          queryClient.invalidateQueries({ queryKey: ['applications'] });
          queryClient.invalidateQueries({ queryKey: ['orgs'] });
          if (event.status === 'approved') void reload();
          break;
        case 'story.created':
          queryClient.invalidateQueries({ queryKey: ['stories'] });
          break;
        case 'wallet.updated':
          for (const key of ['wallets', 'wallet', 'entries', 'orgWallets', 'portfolio']) {
            queryClient.invalidateQueries({ queryKey: [key] });
          }
          break;
        case 'identity.updated':
          queryClient.invalidateQueries({ queryKey: ['identity'] });
          queryClient.invalidateQueries({ queryKey: ['orgs'] });
          void reload();
          break;
        case 'invoice.updated':
          queryClient.invalidateQueries({ queryKey: ['invoices'] });
          break;
        case 'payment_approval.updated':
          queryClient.invalidateQueries({ queryKey: ['paymentApprovals', event.organizationId] });
          break;
        case 'stock.updated':
          queryClient.invalidateQueries({ queryKey: ['stock'] });
          queryClient.invalidateQueries({ queryKey: ['listings'] });
          break;
        case 'payroll.updated':
          queryClient.invalidateQueries({ queryKey: ['payroll', event.organizationId] });
          break;
        case 'cash_request.updated':
          queryClient.invalidateQueries({ queryKey: ['cashRequests', event.walletId] });
          break;
      }
      for (const l of listeners.current) l(event);
    });
    return () => {
      conn.close();
      connection.current = null;
      setStatus('closed');
    };
  }, [me?.id, queryClient, reload]);

  const value: RealtimeState = {
    status,
    subscribe: (listener) => {
      listeners.current.add(listener);
      return () => listeners.current.delete(listener);
    },
    typing: (chatId) => connection.current?.typing(chatId),
  };
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeState {
  return useContext(RealtimeContext);
}
