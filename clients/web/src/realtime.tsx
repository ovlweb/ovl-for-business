import type { RealtimeConnection, RealtimeStatus } from '@ovl/sdk';
import type { Message, RealtimeEvent } from '@ovl/shared';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import { useAuth } from './auth';

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
          queryClient.setQueryData<MessagePages>(['messages', event.chatId], (data) => {
            if (!data) return data;
            const [first = [], ...rest] = data.pages;
            const exists = data.pages.some((p) => p.some((m) => m.id === event.message.id));
            const pages = exists
              ? data.pages.map((p) => p.map((m) => (m.id === event.message.id ? event.message : m)))
              : [[event.message, ...first], ...rest];
            return { ...data, pages };
          });
          queryClient.invalidateQueries({ queryKey: ['chats'] });
          queryClient.invalidateQueries({ queryKey: ['support'] });
          break;
        }
        case 'chat.updated':
        case 'chat.removed':
          queryClient.invalidateQueries({ queryKey: ['chats'] });
          queryClient.invalidateQueries({ queryKey: ['chat', event.chatId] });
          queryClient.invalidateQueries({ queryKey: ['support'] });
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
