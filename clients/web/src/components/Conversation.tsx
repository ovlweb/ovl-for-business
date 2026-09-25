import type { Chat, Message, UserSummary } from '@ovl/shared';
import { Avatar, Badge, Badges, ErrorAlert, plural, shortTime, Spinner, StatusBadge } from '@ovl/ui';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth, useMe } from '../auth';
import { useRealtime } from '../realtime';
import { ChatInfoModal } from './ChatInfo';
import { CommentsModal } from './Comments';
import { Icon } from './Icon';
import {
  insertMention,
  matchPeople,
  mentionQuery,
  MentionList,
  MessageFiles,
  MessageText,
  QuickReactions,
  Reactions,
  useChatUploads,
} from './MessageParts';

const PAGE = 50;

export function chatSubtitle(chat: Chat): string {
  switch (chat.type) {
    case 'direct':
      return chat.peer ? `@${chat.peer.username}` : '';
    case 'group':
      return `Group · ${plural(chat.memberCount, 'member')}`;
    case 'channel':
      return `News channel · @${chat.handle} · ${plural(chat.memberCount, 'subscriber')}`;
    case 'council':
      return `Council · ${plural(chat.memberCount, 'member')}`;
    case 'moderation':
      return `Moderation team · ${plural(chat.memberCount, 'member')}`;
    case 'support':
      return chat.support ? `Tech support · ${chat.support.requester.displayName}` : 'Tech support';
  }
}

export interface MessageActions {
  onReply?: (m: Message) => void;
  onEdit?: (m: Message) => void;
  onDelete: (m: Message) => void;
  onReact: (m: Message, emoji: string, mine: boolean) => void;
  /** Channel posts: open the comments. */
  onComments?: (m: Message) => void;
}

export function snippet(text: string, length = 80): string {
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

/** What a message says in one line (for replies, previews and search results). */
export function messageSummary(m: Pick<Message, 'body' | 'attachments' | 'deleted'>, length = 80): string {
  if (m.deleted) return 'Message deleted';
  if (m.body) return snippet(m.body, length);
  const images = m.attachments.filter((f) => f.contentType.startsWith('image/')).length;
  return images === m.attachments.length ? (images > 1 ? `${images} photos` : 'Photo') : 'File';
}

export function MessageItem({
  message,
  mine,
  showAuthor,
  replyTo,
  active,
  canModerate,
  canReact,
  onToggle,
  actions,
  receipt,
  seenBy,
  highlighted,
}: {
  message: Message;
  mine: boolean;
  showAuthor: boolean;
  replyTo: Message | undefined;
  active: boolean;
  canModerate: boolean;
  canReact: boolean;
  onToggle: () => void;
  actions: MessageActions;
  /** Direct chats: whether the other person read your message. */
  receipt?: 'sent' | 'read';
  /** Groups: how many read your latest message. */
  seenBy?: number;
  highlighted?: boolean;
}) {
  const me = useMe();
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
  const mentioned = message.mentions.includes(me.id);
  const react = (emoji: string, was: boolean) => actions.onReact(message, emoji, was);
  return (
    <div
      id={`msg-${message.id}`}
      className={`bubble-row${mine ? ' mine' : ''}${highlighted ? ' flash' : ''}${mentioned ? ' mentioned' : ''}`}
    >
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
              <span>{replyTo ? messageSummary(replyTo) : 'Earlier message'}</span>
            </button>
          )}
          {message.deleted ? (
            <i className="muted">Message deleted</i>
          ) : (
            <>
              <MessageFiles files={message.attachments} />
              {message.body && <MessageText body={message.body} myUsername={me.username} />}
            </>
          )}
          <div className="bubble-meta">
            {message.editedAt && !message.deleted && 'edited · '}
            {shortTime(message.createdAt)}
            {receipt && (
              <span className={`receipt ${receipt}`} aria-label={receipt === 'read' ? 'Read' : 'Sent'}>
                <Icon name={receipt === 'read' ? 'checkCheck' : 'check'} size={13} />
              </span>
            )}
          </div>
        </div>
        <Reactions message={message} onToggle={react} disabled={!canReact} />
        {actions.onComments && !message.deleted && (message.commentCount > 0 || canReact) && (
          <button type="button" className="comments-link" onClick={() => actions.onComments!(message)}>
            <Icon name="comment" size={14} />
            {message.commentCount > 0 ? plural(message.commentCount, 'comment') : 'Comment'}
          </button>
        )}
        {seenBy !== undefined && seenBy > 0 && <span className="tiny muted">Seen by {seenBy}</span>}
        {active && canAct && (
          <div className="msg-actions" role="toolbar" aria-label="Message actions">
            {canReact && <QuickReactions message={message} onToggle={react} />}
            {actions.onReply && (
              <button className="btn sm ghost" onClick={() => actions.onReply!(message)}>
                <Icon name="reply" size={14} /> Reply
              </button>
            )}
            {message.body && (
              <button
                className="btn sm ghost"
                onClick={() => void navigator.clipboard?.writeText(message.body)}
              >
                <Icon name="copy" size={14} /> Copy
              </button>
            )}
            {mine && actions.onEdit && message.body && (
              <button className="btn sm ghost" onClick={() => actions.onEdit!(message)}>
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
  const uploads = useChatUploads();
  const [caret, setCaret] = useState(0);
  const [pick, setPick] = useState(0);
  const [commentsOf, setCommentsOf] = useState<Message | null>(null);
  const [params, setParams] = useSearchParams();
  const focusId = Number(params.get('message')) || null;
  const [flash, setFlash] = useState<number | null>(null);

  const chat = useQuery({ queryKey: ['chat', chatId], queryFn: () => api.chats.get(chatId) });
  const type = chat.data?.type;
  const members = useQuery({
    queryKey: ['members', chatId],
    queryFn: () => api.chats.members(chatId),
    enabled: type === 'group' || type === 'council' || type === 'moderation',
    staleTime: 60_000,
  });
  const receipts = useQuery({
    queryKey: ['receipts', chatId],
    queryFn: () => api.chats.receipts(chatId),
    enabled: type === 'group',
  });
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
    if (el && !focusId) el.scrollTop = el.scrollHeight;
  }, [newest?.id, focusId]);

  // Opened from a search result: load older pages until the message shows up, then point at it.
  useEffect(() => {
    if (!focusId || messages.isLoading) return;
    if (byId.has(focusId)) {
      document.getElementById(`msg-${focusId}`)?.scrollIntoView({ block: 'center' });
      setFlash(focusId);
      setParams({}, { replace: true });
    } else if (messages.hasNextPage && !messages.isFetchingNextPage) void messages.fetchNextPage();
    else if (!messages.hasNextPage) setParams({}, { replace: true });
  }, [focusId, byId, messages, setParams]);
  useEffect(() => {
    if (flash === null) return;
    const t = setTimeout(() => setFlash(null), 2400);
    return () => clearTimeout(t);
  }, [flash]);

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
        if (event.type === 'chat.read' && event.chatId === chatId) {
          queryClient.invalidateQueries({ queryKey: ['chat', chatId] });
          queryClient.invalidateQueries({ queryKey: ['receipts', chatId] });
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
    [chatId, subscribe, navigate, backTo, queryClient],
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
    uploads.clear();
    // Sending a message clears our "typing…" for others, so announce the next burst right away.
    lastTyping.current = 0;
  };
  const send = useMutation({
    mutationFn: (body: string) =>
      context?.mode === 'edit'
        ? api.chats.edit(chatId, context.message.id, body)
        : api.chats.send(
            chatId,
            body,
            context?.mode === 'reply' ? context.message.id : undefined,
            uploads.files.map((f) => f.id),
          ),
    onSuccess: resetComposer,
  });
  const remove = useMutation({
    mutationFn: (messageId: number) => api.chats.deleteMessage(chatId, messageId),
  });
  const react = useMutation({
    mutationFn: ({ message, emoji, mine }: { message: Message; emoji: string; mine: boolean }) =>
      mine ? api.chats.unreact(chatId, message.id, emoji) : api.chats.react(chatId, message.id, emoji),
  });
  const actions: MessageActions = {
    onReact: (message, emoji, mine) => {
      setActiveId(null);
      react.mutate({ message, emoji, mine });
    },
    onComments: type === 'channel' ? (message) => setCommentsOf(message) : undefined,
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

  const canReact = c.myRole !== null || (c.type === 'support' && can('support.answer'));
  const ready = !!draft.trim() || (uploads.files.length > 0 && context?.mode !== 'edit');
  const submit = () => {
    if (ready && !uploads.busy) send.mutate(draft.trim());
  };

  // @mentions: suggest the chat's members while an "@name" is being typed.
  const people: UserSummary[] =
    c.type === 'direct' ? (c.peer ? [c.peer] : []) : (members.data?.map((m) => m.user) ?? []);
  const query = mentionQuery(draft, caret);
  const suggestions = query === null ? [] : matchPeople(people, query, me.id);
  const choose = (user: UserSummary) => {
    const next = insertMention(draft, caret, user.username);
    setDraft(next.text);
    setCaret(next.caret);
    setPick(0);
    requestAnimationFrame(() => composer.current?.setSelectionRange(next.caret, next.caret));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setPick((p) => (p + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        choose(suggestions[Math.min(pick, suggestions.length - 1)]!);
        return;
      }
    }
    if (e.key === 'Escape' && context) {
      e.preventDefault();
      resetComposer();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };
  const onChange = (value: string, at: number) => {
    setDraft(value);
    setCaret(at);
    setPick(0);
    if (Date.now() - lastTyping.current > 2500 && c.myRole) {
      lastTyping.current = Date.now();
      typing(chatId);
    }
  };
  const typingNames = Object.keys(typers).filter((id) => id !== me.id);
  const canModerate = c.myRole === 'owner' || c.myRole === 'admin' || can('users.manage');
  const myLast = [...ordered].reverse().find((m) => m.sender?.id === me.id && !m.deleted);
  const seenBy = (m: Message) => receipts.data?.filter((r) => r.lastReadMessageId >= m.id).length ?? 0;

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
              canReact={canReact}
              onToggle={() => setActiveId(activeId === m.id ? null : m.id)}
              actions={actions}
              receipt={
                c.type === 'direct' && m.sender?.id === me.id && c.peerReadMessageId !== null
                  ? c.peerReadMessageId >= m.id
                    ? 'read'
                    : 'sent'
                  : undefined
              }
              seenBy={c.type === 'group' && m.id === myLast?.id ? seenBy(m) : undefined}
              highlighted={flash === m.id}
            />
          );
        })}
        {!messages.isLoading && ordered.length === 0 && <div className="system-message">No messages yet</div>}
      </div>

      <div className="typing">
        {typingNames.length > 0 &&
          (c.type === 'direct' && c.peer ? `${c.peer.displayName} is typing…` : 'Someone is typing…')}
      </div>

      {(send.error || remove.error || react.error) && (
        <div style={{ padding: '0 12px 8px' }}>
          <ErrorAlert error={send.error ?? remove.error ?? react.error} />
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
            <div className="small muted ellipsis">{messageSummary(context.message, 120)}</div>
          </div>
          <button className="btn ghost icon sm" onClick={resetComposer} aria-label="Cancel">
            <Icon name="x" size={16} />
          </button>
        </div>
      )}
      {canPost && uploads.pending}
      {canPost ? (
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (context?.mode !== 'edit') void uploads.add([...e.dataTransfer.files]);
          }}
        >
          {uploads.picker}
          {context?.mode !== 'edit' && (
            <button
              type="button"
              className="btn ghost icon"
              aria-label="Attach files"
              disabled={uploads.busy}
              onClick={uploads.pick}
            >
              {uploads.busy ? <span className="spinner" /> : <Icon name="paperclip" size={18} />}
            </button>
          )}
          <div className="composer-input">
            <MentionList people={suggestions} selected={pick} onPick={choose} />
            <textarea
              ref={composer}
              className="textarea"
              aria-label="Message"
              placeholder={
                c.type === 'support' && can('support.answer') && !c.myRole
                  ? 'Answer as support…'
                  : 'Write a message…'
              }
              value={draft}
              onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
              onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
              onKeyDown={onKeyDown}
              onPaste={(e) => {
                const pasted = [...e.clipboardData.files];
                if (pasted.length && context?.mode !== 'edit') {
                  e.preventDefault();
                  void uploads.add(pasted);
                }
              }}
              maxLength={4000}
            />
          </div>
          <button
            className="btn primary icon"
            disabled={!ready || send.isPending || uploads.busy}
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
      {commentsOf && <CommentsModal chat={c} post={commentsOf} onClose={() => setCommentsOf(null)} />}
    </div>
  );
}
