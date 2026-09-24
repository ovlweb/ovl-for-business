import type { Chat, Message } from '@ovl/shared';
import { Avatar, Badge, Badges, ErrorAlert, shortTime, Spinner, StatusBadge } from '@ovl/ui';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth, useMe } from '../auth';
import { useRealtime } from '../realtime';
import { Icon } from './Icon';

const PAGE = 50;

export function chatSubtitle(chat: Chat): string {
  switch (chat.type) {
    case 'direct':
      return chat.peer ? `@${chat.peer.username}` : '';
    case 'group':
      return `Group · ${chat.memberCount} members`;
    case 'channel':
      return `News channel · @${chat.handle} · ${chat.memberCount} subscribers`;
    case 'council':
      return `Council · ${chat.memberCount} members`;
    case 'moderation':
      return `Moderation team · ${chat.memberCount} members`;
    case 'support':
      return chat.support ? `Tech support · ${chat.support.requester.displayName}` : 'Tech support';
  }
}

function MessageItem({
  message,
  mine,
  showAuthor,
}: {
  message: Message;
  mine: boolean;
  showAuthor: boolean;
}) {
  if (message.kind === 'system') {
    const applicationId = message.meta.applicationId as string | undefined;
    if (applicationId) {
      return (
        <div className="system-card stack-sm">
          <span className="small muted">Application update · {shortTime(message.createdAt)}</span>
          <span>{message.body}</span>
          <Link to={`/review/${applicationId}`} className="small bold">
            Open in review queue →
          </Link>
        </div>
      );
    }
    return <div className="system-message">{message.body}</div>;
  }
  const staffBadge = message.meta.staffBadge as 'owner' | 'admin' | 'support' | undefined;
  const sender = message.sender;
  return (
    <div className={`bubble-row${mine ? ' mine' : ''}`}>
      {!mine &&
        (showAuthor ? (
          <Avatar name={sender?.displayName ?? '?'} url={sender?.avatarUrl} size={28} />
        ) : (
          <span style={{ width: 28 }} />
        ))}
      <div className={`bubble${staffBadge === 'owner' ? ' staff-owner' : ''}`}>
        {(showAuthor || staffBadge) && !mine && sender && (
          <div className="bubble-author">
            <Link to={`/u/${sender.username}`}>{sender.displayName}</Link>
            {staffBadge ? <Badge kind={staffBadge} /> : <Badges badges={sender.badges} />}
          </div>
        )}
        {message.deleted ? <i className="muted">Message deleted</i> : message.body}
        <div className="bubble-meta">
          {message.editedAt && 'edited · '}
          {shortTime(message.createdAt)}
        </div>
      </div>
    </div>
  );
}

export function Conversation({ chatId, backTo }: { chatId: string; backTo: string }) {
  const me = useMe();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const { subscribe, typing } = useRealtime();
  const scroller = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');
  const [typers, setTypers] = useState<Record<string, number>>({});
  const lastTyping = useRef(0);

  const chat = useQuery({ queryKey: ['chat', chatId], queryFn: () => api.chats.get(chatId) });
  const messages = useInfiniteQuery({
    queryKey: ['messages', chatId],
    queryFn: ({ pageParam }) => api.chats.messages(chatId, { before: pageParam, limit: PAGE }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1]!.id : undefined),
  });
  const ordered = (messages.data?.pages.flat() ?? []).slice().reverse();
  const newest = ordered[ordered.length - 1];

  // Mark as read and keep scrolled to the bottom when new messages arrive.
  useEffect(() => {
    if (!newest || !chat.data?.myRole) return;
    api.chats
      .read(chatId, newest.id)
      .then(() => queryClient.invalidateQueries({ queryKey: ['chats'] }))
      .catch(() => undefined);
  }, [newest?.id, chatId, chat.data?.myRole, queryClient]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [newest?.id]);

  useEffect(
    () =>
      subscribe((event) => {
        if (event.type === 'typing' && event.chatId === chatId) {
          setTypers((t) => ({ ...t, [event.userId]: Date.now() }));
        }
      }),
    [chatId, subscribe],
  );
  useEffect(() => {
    const t = setInterval(() => {
      setTypers((current) => {
        const fresh = Object.fromEntries(Object.entries(current).filter(([, at]) => Date.now() - at < 4000));
        return Object.keys(fresh).length === Object.keys(current).length ? current : fresh;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const send = useMutation({
    mutationFn: (body: string) => api.chats.send(chatId, body),
    onSuccess: () => setDraft(''),
  });
  const join = useMutation({
    mutationFn: () => api.chats.join(chatId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat', chatId] });
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });
  const setStatus = useMutation({
    mutationFn: (status: 'open' | 'closed') => api.support.setStatus(chatId, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chat', chatId] }),
  });

  if (chat.isLoading) return <Spinner center />;
  if (chat.error || !chat.data)
    return (
      <div className="page">
        <ErrorAlert error={chat.error} />
      </div>
    );
  const c = chat.data;

  const isChannel = c.type === 'channel';
  const canPost =
    c.type === 'support'
      ? c.myRole !== null || can('support.answer')
      : isChannel
        ? c.myRole === 'owner' || c.myRole === 'admin'
        : c.myRole !== null;

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (draft.trim()) send.mutate(draft.trim());
    }
  };
  const onChange = (value: string) => {
    setDraft(value);
    if (Date.now() - lastTyping.current > 2500 && c.myRole) {
      lastTyping.current = Date.now();
      typing(chatId);
    }
  };
  const typingNames = Object.keys(typers).filter((id) => id !== me.id);

  return (
    <div className="conversation">
      <div className="conversation-header">
        <Link to={backTo} className="btn ghost icon mobile-only" aria-label="Back">
          <Icon name="back" />
        </Link>
        {c.type === 'support' ? (
          <span className="avatar" style={{ width: 40, height: 40, background: 'var(--support)' }}>
            <Icon name="support" size={20} />
          </span>
        ) : (
          <Avatar name={c.title} url={c.peer?.avatarUrl} size={40} />
        )}
        <div className="grow">
          <div className="row" style={{ gap: 6 }}>
            <h3 className="ellipsis">{c.title}</h3>
            {c.peer && <Badges badges={c.peer.badges} />}
            {c.type === 'council' && <Badge kind="council" />}
            {c.support && <StatusBadge status={c.support.status} />}
          </div>
          <div className="small muted ellipsis">{chatSubtitle(c)}</div>
        </div>
        {c.type === 'support' && (
          <button
            className="btn sm"
            onClick={() => setStatus.mutate(c.support?.status === 'closed' ? 'open' : 'closed')}
          >
            {c.support?.status === 'closed' ? 'Reopen' : 'Close ticket'}
          </button>
        )}
      </div>

      <div className="messages" ref={scroller}>
        {messages.hasNextPage && (
          <button className="btn sm" style={{ alignSelf: 'center' }} onClick={() => messages.fetchNextPage()}>
            {messages.isFetchingNextPage ? 'Loading…' : 'Load older messages'}
          </button>
        )}
        {messages.isLoading && <Spinner center />}
        {ordered.map((m, i) => {
          const prev = ordered[i - 1];
          const showAuthor =
            c.type !== 'direct' && (!prev || prev.sender?.id !== m.sender?.id || prev.kind === 'system');
          return <MessageItem key={m.id} message={m} mine={m.sender?.id === me.id} showAuthor={showAuthor} />;
        })}
        {!messages.isLoading && ordered.length === 0 && <div className="system-message">No messages yet</div>}
      </div>

      <div className="typing">
        {typingNames.length > 0 &&
          (c.type === 'direct' && c.peer ? `${c.peer.displayName} is typing…` : 'Someone is typing…')}
      </div>

      {send.error && (
        <div style={{ padding: '0 12px 8px' }}>
          <ErrorAlert error={send.error} />
        </div>
      )}
      {canPost ? (
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) send.mutate(draft.trim());
          }}
        >
          <textarea
            className="textarea"
            placeholder={
              c.type === 'support' && can('support.answer') && !c.myRole
                ? 'Answer as support…'
                : 'Write a message…'
            }
            value={draft}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            maxLength={4000}
          />
          <button className="btn primary icon" disabled={!draft.trim() || send.isPending} aria-label="Send">
            <Icon name="send" size={18} />
          </button>
        </form>
      ) : isChannel && !c.myRole ? (
        <div className="composer">
          <button className="btn primary block" onClick={() => join.mutate()}>
            Subscribe to channel
          </button>
        </div>
      ) : (
        <div className="composer small muted" style={{ justifyContent: 'center' }}>
          {isChannel ? 'Only channel admins can post here.' : 'You cannot write in this chat.'}
        </div>
      )}
    </div>
  );
}
