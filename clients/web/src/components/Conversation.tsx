import type { Chat, Message } from '@ovl/shared';
import { Avatar, Badge, Badges, ErrorAlert, shortTime, Spinner, StatusBadge } from '@ovl/ui';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth, useMe } from '../auth';
import { useRealtime } from '../realtime';
import { ChatInfoModal } from './ChatInfo';
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

interface MessageActions {
  onReply: (m: Message) => void;
  onEdit: (m: Message) => void;
  onDelete: (m: Message) => void;
}

function snippet(text: string, length = 80): string {
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

function MessageItem({
  message,
  mine,
  showAuthor,
  replyTo,
  active,
  canModerate,
  onToggle,
  actions,
}: {
  message: Message;
  mine: boolean;
  showAuthor: boolean;
  replyTo: Message | undefined;
  active: boolean;
  canModerate: boolean;
  onToggle: () => void;
  actions: MessageActions;
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
  const canAct = !message.deleted;
  return (
    <div id={`msg-${message.id}`} className={`bubble-row${mine ? ' mine' : ''}`}>
      {!mine &&
        (showAuthor ? (
          <Avatar name={sender?.displayName ?? '?'} url={sender?.avatarUrl} size={28} />
        ) : (
          <span style={{ width: 28, flex: 'none' }} />
        ))}
      <div className="bubble-stack">
        <div
          className={`bubble${staffBadge === 'owner' ? ' staff-owner' : ''}${canAct ? ' actionable' : ''}`}
          onClick={canAct ? onToggle : undefined}
          role={canAct ? 'button' : undefined}
          tabIndex={canAct ? 0 : undefined}
          aria-expanded={canAct ? active : undefined}
          onKeyDown={(e) =>
            canAct && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onToggle())
          }
        >
          {(showAuthor || staffBadge) && !mine && sender && (
            <div className="bubble-author">
              <Link to={`/u/${sender.username}`} onClick={(e) => e.stopPropagation()}>
                {sender.displayName}
              </Link>
              {staffBadge ? <Badge kind={staffBadge} /> : <Badges badges={sender.badges} />}
            </div>
          )}
          {message.replyToId && (
            <button
              type="button"
              className="reply-quote"
              onClick={(e) => {
                e.stopPropagation();
                document
                  .getElementById(`msg-${message.replyToId}`)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
            >
              <b>{replyTo?.sender?.displayName ?? 'Message'}</b>
              <span>
                {replyTo ? (replyTo.deleted ? 'Message deleted' : snippet(replyTo.body)) : 'Earlier message'}
              </span>
            </button>
          )}
          {message.deleted ? <i className="muted">Message deleted</i> : message.body}
          <div className="bubble-meta">
            {message.editedAt && !message.deleted && 'edited · '}
            {shortTime(message.createdAt)}
          </div>
        </div>
        {active && canAct && (
          <div className="msg-actions" role="toolbar" aria-label="Message actions">
            <button className="btn sm ghost" onClick={() => actions.onReply(message)}>
              <Icon name="reply" size={14} /> Reply
            </button>
            <button
              className="btn sm ghost"
              onClick={() => void navigator.clipboard?.writeText(message.body)}
            >
              <Icon name="copy" size={14} /> Copy
            </button>
            {mine && (
              <button className="btn sm ghost" onClick={() => actions.onEdit(message)}>
                <Icon name="edit" size={14} /> Edit
              </button>
            )}
            {(mine || canModerate) && (
              <button className="btn sm ghost danger-text" onClick={() => actions.onDelete(message)}>
                <Icon name="trash" size={14} /> Delete
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function Conversation({ chatId, backTo }: { chatId: string; backTo: string }) {
  const me = useMe();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const { subscribe, typing } = useRealtime();
  const navigate = useNavigate();
  const scroller = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');
  const [typers, setTypers] = useState<Record<string, number>>({});
  const [activeId, setActiveId] = useState<number | null>(null);
  const [context, setContext] = useState<{ mode: 'reply' | 'edit'; message: Message } | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const lastTyping = useRef(0);
  const composer = useRef<HTMLTextAreaElement>(null);

  const chat = useQuery({ queryKey: ['chat', chatId], queryFn: () => api.chats.get(chatId) });
  const messages = useInfiniteQuery({
    queryKey: ['messages', chatId],
    queryFn: ({ pageParam }) => api.chats.messages(chatId, { before: pageParam, limit: PAGE }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1]!.id : undefined),
  });
  const ordered = useMemo(() => (messages.data?.pages.flat() ?? []).slice().reverse(), [messages.data]);
  const byId = useMemo(() => new Map(ordered.map((m) => [m.id, m])), [ordered]);
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
        // Removed from the chat (or left it from another device): go back to the list.
        if (event.type === 'chat.removed' && event.chatId === chatId) {
          navigate(backTo, { replace: true });
          return;
        }
        if (event.type === 'typing' && event.chatId === chatId) {
          setTypers((t) => ({ ...t, [event.userId]: Date.now() }));
        }
        // A message from someone ends their "typing…" indicator.
        if (event.type === 'message.created' && event.chatId === chatId && event.message.sender) {
          const senderId = event.message.sender.id;
          setTypers((t) => {
            if (!(senderId in t)) return t;
            const { [senderId]: _gone, ...rest } = t;
            return rest;
          });
        }
      }),
    [chatId, subscribe, navigate, backTo],
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

  const resetComposer = () => {
    setDraft('');
    setContext(null);
    // Sending a message clears our "typing…" for others, so announce the next burst right away.
    lastTyping.current = 0;
  };
  const send = useMutation({
    mutationFn: (body: string) =>
      context?.mode === 'edit'
        ? api.chats.edit(chatId, context.message.id, body)
        : api.chats.send(chatId, body, context?.mode === 'reply' ? context.message.id : undefined),
    onSuccess: resetComposer,
  });
  const remove = useMutation({
    mutationFn: (messageId: number) => api.chats.deleteMessage(chatId, messageId),
  });
  const actions: MessageActions = {
    onReply: (message) => {
      setContext({ mode: 'reply', message });
      setActiveId(null);
      composer.current?.focus();
    },
    onEdit: (message) => {
      setContext({ mode: 'edit', message });
      setDraft(message.body);
      setActiveId(null);
      composer.current?.focus();
    },
    onDelete: (message) => {
      setActiveId(null);
      if (confirm('Delete this message for everyone?')) remove.mutate(message.id);
    },
  };
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
    if (e.key === 'Escape' && context) {
      e.preventDefault();
      resetComposer();
      return;
    }
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
  const canModerate = c.myRole === 'owner' || c.myRole === 'admin' || can('users.manage');

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
        {c.type !== 'support' && (
          <button className="btn ghost icon" onClick={() => setShowInfo(true)} aria-label="Chat details">
            <Icon name="info" />
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
          return (
            <MessageItem
              key={m.id}
              message={m}
              mine={m.sender?.id === me.id}
              showAuthor={showAuthor}
              replyTo={m.replyToId ? byId.get(m.replyToId) : undefined}
              active={activeId === m.id}
              canModerate={canModerate}
              onToggle={() => setActiveId(activeId === m.id ? null : m.id)}
              actions={actions}
            />
          );
        })}
        {!messages.isLoading && ordered.length === 0 && <div className="system-message">No messages yet</div>}
      </div>

      <div className="typing">
        {typingNames.length > 0 &&
          (c.type === 'direct' && c.peer ? `${c.peer.displayName} is typing…` : 'Someone is typing…')}
      </div>

      {(send.error || remove.error) && (
        <div style={{ padding: '0 12px 8px' }}>
          <ErrorAlert error={send.error ?? remove.error} />
        </div>
      )}
      {context && canPost && (
        <div className="composer-context">
          <Icon name={context.mode === 'reply' ? 'reply' : 'edit'} size={16} />
          <div className="grow">
            <div className="small bold">
              {context.mode === 'reply'
                ? `Reply to ${context.message.sender?.displayName ?? 'message'}`
                : 'Edit message'}
            </div>
            <div className="small muted ellipsis">{snippet(context.message.body, 120)}</div>
          </div>
          <button className="btn ghost icon sm" onClick={resetComposer} aria-label="Cancel">
            <Icon name="x" size={16} />
          </button>
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
            ref={composer}
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
          <button
            className="btn primary icon"
            disabled={!draft.trim() || send.isPending}
            aria-label={context?.mode === 'edit' ? 'Save' : 'Send'}
          >
            <Icon name={context?.mode === 'edit' ? 'review' : 'send'} size={18} />
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
      {showInfo && <ChatInfoModal chat={c} onClose={() => setShowInfo(false)} />}
    </div>
  );
}
