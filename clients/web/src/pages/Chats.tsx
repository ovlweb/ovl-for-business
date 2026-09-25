import type { Chat } from '@ovl/shared';
import {
  Avatar,
  Badges,
  Empty,
  ErrorAlert,
  Field,
  Modal,
  shortTime,
  Spinner,
  Tabs,
  useDebounced,
  UserName,
} from '@ovl/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Conversation, messageSummary } from '../components/Conversation';
import { Icon } from '../components/Icon';
import { StoriesBar } from '../components/Stories';

function preview(chat: Chat): string {
  const m = chat.lastMessage;
  if (!m) return chat.type === 'channel' ? chat.description || 'News channel' : 'No messages yet';
  if (m.deleted) return 'Message deleted';
  const author = m.kind === 'system' || chat.type === 'direct' ? '' : `${m.sender?.displayName ?? ''}: `;
  return author + messageSummary(m, 200);
}

function ChatRow({ chat, active }: { chat: Chat; active: boolean }) {
  return (
    <Link to={`/chats/${chat.id}`} className={`chat-item${active ? ' active' : ''}`}>
      <Avatar name={chat.title} url={chat.peer?.avatarUrl} size={46} />
      <div className="grow">
        <div className="row" style={{ gap: 6 }}>
          {chat.type === 'channel' && <Icon name="channel" size={14} />}
          {chat.type === 'council' && <Icon name="shield" size={14} />}
          <span className="bold ellipsis">{chat.title}</span>
          {chat.peer && <Badges badges={chat.peer.badges} />}
        </div>
        <div className="preview ellipsis">{preview(chat)}</div>
      </div>
      <div className="meta">
        <span>{chat.lastMessage ? shortTime(chat.lastMessage.createdAt) : ''}</span>
        <span className="row" style={{ gap: 4 }}>
          {chat.pinned && <Icon name="pin" size={13} />}
          {chat.unreadMentions > 0 && (
            <span className="count mention-count" aria-label={`${chat.unreadMentions} mentions`}>
              @
            </span>
          )}
          {chat.unreadCount > 0 && <span className="count">{chat.unreadCount}</span>}
        </span>
      </div>
    </Link>
  );
}

type NewTab = 'direct' | 'group' | 'channels';

function NewChatModal({ onClose }: { onClose: () => void }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<NewTab>('direct');
  const [q, setQ] = useState('');
  const search = useDebounced(q);
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [channel, setChannel] = useState({ title: '', handle: '', description: '' });

  const users = useQuery({
    queryKey: ['users', search],
    queryFn: () => api.users.search(search),
    enabled: tab === 'direct' && search.length > 0,
  });
  const contacts = useQuery({ queryKey: ['contacts'], queryFn: api.contacts.list, enabled: tab === 'group' });
  const channels = useQuery({
    queryKey: ['channels', search],
    queryFn: () => api.chats.discoverChannels(search || undefined),
    enabled: tab === 'channels',
  });

  const open = (chat: Chat) => {
    queryClient.invalidateQueries({ queryKey: ['chats'] });
    onClose();
    navigate(`/chats/${chat.id}`);
  };
  const direct = useMutation({ mutationFn: api.chats.direct, onSuccess: open });
  const group = useMutation({
    mutationFn: () => api.chats.createGroup({ title, memberIds: selected }),
    onSuccess: open,
  });
  const createChannel = useMutation({ mutationFn: () => api.chats.createChannel(channel), onSuccess: open });

  return (
    <Modal title="New conversation" onClose={onClose}>
      <Tabs<NewTab>
        value={tab}
        onChange={(t) => {
          setTab(t);
          setQ('');
        }}
        tabs={[
          { value: 'direct', label: 'Direct message' },
          { value: 'group', label: 'New group' },
          { value: 'channels', label: 'News channels' },
        ]}
      />

      {tab === 'direct' && (
        <div className="stack">
          <input
            className="input"
            placeholder="Search people by name or username"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <ErrorAlert error={direct.error} />
          <div className="list">
            {users.data?.map((u) => (
              <button key={u.id} className="list-item" onClick={() => direct.mutate(u.id)}>
                <Avatar name={u.displayName} url={u.avatarUrl} />
                <UserName user={u} showHandle />
              </button>
            ))}
            {users.data?.length === 0 && <Empty title="Nobody found" />}
          </div>
        </div>
      )}

      {tab === 'group' && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            group.mutate();
          }}
        >
          <Field label="Group name">
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={128}
            />
          </Field>
          <div className="label">Members (from your contacts)</div>
          <div className="list card flat pad-0" style={{ maxHeight: 260, overflow: 'auto' }}>
            {contacts.data?.map((c) => (
              <label key={c.id} className="list-item">
                <input
                  type="checkbox"
                  checked={selected.includes(c.id)}
                  onChange={(e) =>
                    setSelected(e.target.checked ? [...selected, c.id] : selected.filter((id) => id !== c.id))
                  }
                />
                <Avatar name={c.displayName} url={c.avatarUrl} size={30} />
                <UserName user={c} showHandle />
              </label>
            ))}
            {contacts.data?.length === 0 && (
              <Empty title="No contacts yet">Add people on the Contacts page to invite them.</Empty>
            )}
          </div>
          <ErrorAlert error={group.error} />
          <button className="btn primary" disabled={!title.trim() || group.isPending}>
            Create group
          </button>
        </form>
      )}

      {tab === 'channels' && (
        <div className="stack">
          <input
            className="input"
            placeholder="Search channels"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="list">
            {channels.data?.map((c) => (
              <button key={c.id} className="list-item" onClick={() => open(c)}>
                <Avatar name={c.title} size={36} />
                <div className="grow">
                  <div className="bold">{c.title}</div>
                  <div className="small muted">
                    @{c.handle} · {c.memberCount} subscribers
                  </div>
                </div>
                {c.myRole ? (
                  <span className="badge ok">Subscribed</span>
                ) : (
                  <span className="badge info">View</span>
                )}
              </button>
            ))}
            {channels.data?.length === 0 && <Empty title="No channels found" />}
          </div>
          {can('channels.create') ? (
            <form
              className="stack card flat"
              onSubmit={(e) => {
                e.preventDefault();
                createChannel.mutate();
              }}
            >
              <h3>Create a news channel (moderation)</h3>
              <input
                className="input"
                placeholder="Title"
                value={channel.title}
                onChange={(e) => setChannel({ ...channel, title: e.target.value })}
                required
              />
              <input
                className="input"
                placeholder="handle"
                value={channel.handle}
                onChange={(e) => setChannel({ ...channel, handle: e.target.value })}
                required
              />
              <input
                className="input"
                placeholder="Description"
                value={channel.description}
                onChange={(e) => setChannel({ ...channel, description: e.target.value })}
              />
              <ErrorAlert error={createChannel.error} />
              <button className="btn primary">Create channel</button>
            </form>
          ) : (
            <p className="small muted">
              Want your own news channel? News channels are created through moderation —{' '}
              <Link to="/applications" onClick={onClose}>
                submit a news channel application
              </Link>
              .
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Messages matching the search box, across all your chats. */
function MessageResults({ q }: { q: string }) {
  const results = useQuery({ queryKey: ['search', q], queryFn: () => api.chats.search(q) });
  return (
    <div className="stack-sm" style={{ padding: '4px 0 8px' }}>
      <div className="list-label">Messages</div>
      {results.isLoading && <Spinner center />}
      <ErrorAlert error={results.error} />
      {results.data?.map(({ chat, message }) => (
        <Link
          key={message.id}
          className="chat-item"
          to={`/chats/${chat.id}?message=${message.threadId ?? message.id}`}
        >
          <Avatar name={chat.title} size={38} />
          <div className="grow">
            <div className="row" style={{ gap: 6 }}>
              <span className="bold ellipsis">{chat.title}</span>
            </div>
            <div className="preview ellipsis">
              {message.sender && chat.type !== 'direct' ? `${message.sender.displayName}: ` : ''}
              {messageSummary(message, 200)}
            </div>
          </div>
          <div className="meta">
            <span>{shortTime(message.createdAt)}</span>
          </div>
        </Link>
      ))}
      {results.data?.length === 0 && (
        <p className="small muted" style={{ padding: '0 16px' }}>
          No messages found
        </p>
      )}
    </div>
  );
}

export function ChatsPage() {
  const { chatId } = useParams();
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('');
  const search = useDebounced(filter.trim(), 300);
  const chats = useQuery({ queryKey: ['chats'], queryFn: api.chats.list });
  const list = (chats.data ?? []).filter((c) => c.title.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className={`messenger${chatId ? ' has-chat' : ''}`}>
      <aside className="chat-list-pane">
        <div className="pane-header">
          <h2 className="grow">Chats</h2>
          <button className="btn primary sm" onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} /> New
          </button>
        </div>
        <StoriesBar />
        <div style={{ padding: '10px 14px' }}>
          <input
            className="input"
            type="search"
            aria-label="Search chats and messages"
            placeholder="Search chats and messages"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="chat-list-scroll">
          {chats.isLoading && <Spinner center />}
          <ErrorAlert error={chats.error} />
          {list.map((c) => (
            <ChatRow key={c.id} chat={c} active={c.id === chatId} />
          ))}
          {chats.data && list.length === 0 && !filter && (
            <Empty title="No chats yet">
              Start a conversation with someone or subscribe to a news channel.
            </Empty>
          )}
          {search.length >= 2 && <MessageResults q={search} />}
        </div>
      </aside>
      {chatId ? (
        <Conversation key={chatId} chatId={chatId} backTo="/chats" />
      ) : (
        <div className="conversation">
          <div className="center grow">
            <Empty title="Select a chat">
              Your conversations, groups, channels and staff chats live here.
            </Empty>
          </div>
        </div>
      )}
      {creating && <NewChatModal onClose={() => setCreating(false)} />}
    </div>
  );
}
