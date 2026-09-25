import type { Chat } from '@ovl/shared';
import { Avatar, Empty, ErrorAlert, Field, humanize, Modal, Spinner, UserName } from '@ovl/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useMe } from '../auth';
import { Icon } from './Icon';

const LEAVABLE: Chat['type'][] = ['group', 'channel'];

function EditDetails({ chat }: { chat: Chat }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    title: chat.title,
    description: chat.description,
    ...(chat.type === 'channel' ? { commentsEnabled: chat.commentsEnabled } : {}),
  });
  const save = useMutation({
    mutationFn: () => api.chats.update(chat.id, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat', chat.id] });
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });
  return (
    <form
      className="card flat stack"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field label="Title">
        <input
          className="input"
          value={form.title}
          maxLength={128}
          required
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
      </Field>
      <Field label="Description">
        <textarea
          className="textarea"
          value={form.description}
          maxLength={2000}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </Field>
      {chat.type === 'channel' && (
        <label className="row small">
          <input
            type="checkbox"
            checked={!!form.commentsEnabled}
            onChange={(e) => setForm({ ...form, commentsEnabled: e.target.checked })}
          />
          Subscribers can comment on posts
        </label>
      )}
      <ErrorAlert error={save.error} />
      {save.isSuccess && <div className="alert success small">Saved</div>}
      <button className="btn" disabled={save.isPending}>
        Save details
      </button>
    </form>
  );
}

function InviteContacts({ chat, memberIds }: { chat: Chat; memberIds: Set<string> }) {
  const queryClient = useQueryClient();
  const contacts = useQuery({ queryKey: ['contacts'], queryFn: api.contacts.list });
  const [selected, setSelected] = useState<string[]>([]);
  const candidates = contacts.data?.filter((c) => !memberIds.has(c.id)) ?? [];
  const invite = useMutation({
    mutationFn: () => api.chats.invite(chat.id, selected),
    onSuccess: () => {
      setSelected([]);
      queryClient.invalidateQueries({ queryKey: ['chatMembers', chat.id] });
      queryClient.invalidateQueries({ queryKey: ['chat', chat.id] });
    },
  });
  if (!candidates.length) {
    return (
      <p className="small muted">
        Everyone from your contacts is already here. Add more people on the Contacts page.
      </p>
    );
  }
  return (
    <div className="stack-sm">
      <div className="label">Invite from your contacts</div>
      <div className="list card flat pad-0" style={{ maxHeight: 200, overflow: 'auto' }}>
        {candidates.map((c) => (
          <label key={c.id} className="list-item">
            <input
              type="checkbox"
              checked={selected.includes(c.id)}
              onChange={(e) =>
                setSelected(e.target.checked ? [...selected, c.id] : selected.filter((id) => id !== c.id))
              }
            />
            <Avatar name={c.displayName} url={c.avatarUrl} size={28} />
            <UserName user={c} showHandle />
          </label>
        ))}
      </div>
      <ErrorAlert error={invite.error} />
      <button
        className="btn primary"
        disabled={!selected.length || invite.isPending}
        onClick={() => invite.mutate()}
      >
        Invite {selected.length || ''}
      </button>
    </div>
  );
}

export function ChatInfoModal({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isAdmin = chat.myRole === 'owner' || chat.myRole === 'admin';
  const showMembers =
    chat.type !== 'direct' && chat.type !== 'support' && (chat.type !== 'channel' || isAdmin);
  const members = useQuery({
    queryKey: ['chatMembers', chat.id],
    queryFn: () => api.chats.members(chat.id),
    enabled: showMembers,
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['chat', chat.id] });
    queryClient.invalidateQueries({ queryKey: ['chats'] });
    queryClient.invalidateQueries({ queryKey: ['chatMembers', chat.id] });
  };
  const pin = useMutation({ mutationFn: () => api.chats.pin(chat.id, !chat.pinned), onSuccess: refresh });
  const remove = useMutation({
    mutationFn: (userId: string) => api.chats.removeMember(chat.id, userId),
    onSuccess: refresh,
  });
  const leave = useMutation({
    mutationFn: () => api.chats.removeMember(chat.id, me.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      onClose();
      navigate('/chats');
    },
  });

  const canLeave = LEAVABLE.includes(chat.type) && chat.myRole !== null && chat.myRole !== 'owner';
  const memberIds = new Set(members.data?.map((m) => m.user.id));

  return (
    <Modal
      title={
        chat.type === 'direct'
          ? 'Conversation'
          : humanize(chat.type === 'channel' ? 'news channel' : chat.type)
      }
      onClose={onClose}
    >
      <div className="stack">
        <div className="row">
          <Avatar name={chat.title} url={chat.peer?.avatarUrl} size={56} />
          <div className="grow">
            <h2 className="ellipsis">{chat.title}</h2>
            <div className="small muted">
              {chat.handle && `@${chat.handle} · `}
              {chat.type === 'direct' && chat.peer
                ? `@${chat.peer.username}`
                : `${chat.memberCount} ${chat.type === 'channel' ? 'subscribers' : 'members'}`}
            </div>
          </div>
        </div>
        {chat.description && <p style={{ whiteSpace: 'pre-wrap' }}>{chat.description}</p>}

        <div className="row-wrap">
          {chat.myRole && (
            <button className="btn sm" onClick={() => pin.mutate()} disabled={pin.isPending}>
              <Icon name="pin" size={15} /> {chat.pinned ? 'Unpin' : 'Pin to top'}
            </button>
          )}
          {chat.peer && (
            <Link className="btn sm" to={`/u/${chat.peer.username}`} onClick={onClose}>
              View profile
            </Link>
          )}
          {canLeave && (
            <button
              className="btn sm danger"
              disabled={leave.isPending}
              onClick={() => {
                if (confirm(chat.type === 'channel' ? 'Unsubscribe from this channel?' : 'Leave this group?'))
                  leave.mutate();
              }}
            >
              {chat.type === 'channel' ? 'Unsubscribe' : 'Leave group'}
            </button>
          )}
        </div>
        <ErrorAlert error={pin.error ?? leave.error ?? remove.error} />

        {isAdmin && (chat.type === 'group' || chat.type === 'channel') && <EditDetails chat={chat} />}
        {isAdmin && chat.type === 'group' && members.data && (
          <InviteContacts chat={chat} memberIds={memberIds} />
        )}

        {showMembers && (
          <div className="stack-sm">
            <div className="label">{chat.type === 'channel' ? 'Subscribers' : 'Members'}</div>
            {members.isLoading && <Spinner />}
            <div className="list card flat pad-0" style={{ maxHeight: 300, overflow: 'auto' }}>
              {members.data?.map((m) => (
                <div key={m.user.id} className="list-item" style={{ cursor: 'default' }}>
                  <Avatar name={m.user.displayName} url={m.user.avatarUrl} size={30} />
                  <Link
                    to={`/u/${m.user.username}`}
                    className="grow"
                    style={{ color: 'inherit' }}
                    onClick={onClose}
                  >
                    <UserName user={m.user} showHandle />
                  </Link>
                  {m.role !== 'member' && <span className="badge">{humanize(m.role)}</span>}
                  {isAdmin && chat.type === 'group' && m.role === 'member' && m.user.id !== me.id && (
                    <button
                      className="btn sm ghost"
                      onClick={() => remove.mutate(m.user.id)}
                      aria-label={`Remove ${m.user.displayName}`}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
            {members.data?.length === 0 && <Empty title="No members" />}
          </div>
        )}
      </div>
    </Modal>
  );
}
