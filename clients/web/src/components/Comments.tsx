import type { Chat, Message } from '@ovl/shared';
import { ErrorAlert, Modal, Spinner } from '@ovl/ui';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth, useMe } from '../auth';
import { MessageItem, type MessageActions } from './Conversation';
import { Icon } from './Icon';
import { useChatUploads } from './MessageParts';

const PAGE = 50;

/** Comments under a channel post: subscribers write, channel admins moderate. */
export function CommentsModal({ chat, post, onClose }: { chat: Chat; post: Message; onClose: () => void }) {
  const me = useMe();
  const { can } = useAuth();
  const [draft, setDraft] = useState('');
  const [activeId, setActiveId] = useState<number | null>(null);
  const uploads = useChatUploads(4);
  const comments = useInfiniteQuery({
    queryKey: ['comments', chat.id, post.id],
    queryFn: ({ pageParam }) => api.chats.comments(chat.id, post.id, { before: pageParam, limit: PAGE }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1]!.id : undefined),
  });
  const ordered = useMemo(() => (comments.data?.pages.flat() ?? []).slice().reverse(), [comments.data]);
  const send = useMutation({
    mutationFn: () =>
      api.chats.comment(
        chat.id,
        post.id,
        draft.trim(),
        uploads.files.map((f) => f.id),
      ),
    onSuccess: () => {
      setDraft('');
      uploads.clear();
    },
  });
  const remove = useMutation({ mutationFn: (m: Message) => api.chats.deleteMessage(chat.id, m.id) });
  const react = useMutation({
    mutationFn: ({ m, emoji, mine }: { m: Message; emoji: string; mine: boolean }) =>
      mine ? api.chats.unreact(chat.id, m.id, emoji) : api.chats.react(chat.id, m.id, emoji),
  });
  const isAdmin = chat.myRole === 'owner' || chat.myRole === 'admin';
  const canWrite = chat.myRole !== null && chat.commentsEnabled;
  const actions: MessageActions = {
    onDelete: (m) => {
      setActiveId(null);
      if (confirm('Delete this comment?')) remove.mutate(m);
    },
    onReact: (m, emoji, mine) => {
      setActiveId(null);
      react.mutate({ m, emoji, mine });
    },
  };
  const ready = (draft.trim() || uploads.files.length) && !uploads.busy;

  return (
    <Modal title="Comments" onClose={onClose} wide>
      <div className="stack">
        <div className="card flat small" style={{ whiteSpace: 'pre-wrap' }}>
          {post.body || 'Post with attachments'}
        </div>
        <div className="messages comments" aria-label="Comments">
          {comments.hasNextPage && (
            <button
              className="btn sm"
              style={{ alignSelf: 'center' }}
              onClick={() => comments.fetchNextPage()}
            >
              {comments.isFetchingNextPage ? 'Loading…' : 'Earlier comments'}
            </button>
          )}
          {comments.isLoading && <Spinner center />}
          {ordered.map((m) => (
            <MessageItem
              key={m.id}
              message={m}
              mine={m.sender?.id === me.id}
              showAuthor
              replyTo={undefined}
              active={activeId === m.id}
              canModerate={isAdmin || can('users.manage')}
              canReact={chat.myRole !== null}
              onToggle={() => setActiveId(activeId === m.id ? null : m.id)}
              actions={actions}
            />
          ))}
          {!comments.isLoading && !ordered.length && <div className="system-message">No comments yet</div>}
        </div>
        <ErrorAlert error={comments.error ?? send.error ?? remove.error ?? react.error} />
        {canWrite ? (
          <>
            {uploads.pending}
            <form
              className="composer flat"
              onSubmit={(e) => {
                e.preventDefault();
                if (ready) send.mutate();
              }}
            >
              {uploads.picker}
              <button
                type="button"
                className="btn ghost icon"
                aria-label="Attach files"
                onClick={uploads.pick}
              >
                {uploads.busy ? <span className="spinner" /> : <Icon name="paperclip" size={18} />}
              </button>
              <textarea
                className="textarea"
                aria-label="Comment"
                placeholder="Write a comment…"
                value={draft}
                maxLength={4000}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (ready) send.mutate();
                  }
                }}
              />
              <button
                className="btn primary icon"
                aria-label="Send comment"
                disabled={!ready || send.isPending}
              >
                <Icon name="send" size={18} />
              </button>
            </form>
          </>
        ) : (
          <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>
            {chat.myRole === null
              ? 'Subscribe to the channel to comment.'
              : 'Comments are turned off in this channel.'}
          </p>
        )}
      </div>
    </Modal>
  );
}
