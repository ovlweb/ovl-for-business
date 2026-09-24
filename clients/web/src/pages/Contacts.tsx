import { Avatar, Empty, ErrorAlert, PageHeader, Spinner, useDebounced, UserName } from '@ovl/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';

export function ContactsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const search = useDebounced(q);
  const contacts = useQuery({ queryKey: ['contacts'], queryFn: api.contacts.list });
  const results = useQuery({
    queryKey: ['users', search],
    queryFn: () => api.users.search(search),
    enabled: !!search,
  });
  const known = new Set(contacts.data?.map((c) => c.id));

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['contacts'] });
  const add = useMutation({ mutationFn: api.contacts.add, onSuccess: refresh });
  const remove = useMutation({ mutationFn: api.contacts.remove, onSuccess: refresh });
  const message = useMutation({
    mutationFn: api.chats.direct,
    onSuccess: (chat) => navigate(`/chats/${chat.id}`),
  });

  return (
    <div className="page stack-lg">
      <PageHeader
        title="Contacts"
        subtitle="People you can invite to groups. Staff show their badge — council members get a unique council badge."
      />
      <div className="card stack">
        <h3>Find people</h3>
        <input
          className="input"
          placeholder="Search by name or username"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <ErrorAlert error={add.error} />
        {search && (
          <div className="list">
            {results.data?.map((u) => (
              <div key={u.id} className="list-item" style={{ cursor: 'default' }}>
                <Avatar name={u.displayName} url={u.avatarUrl} />
                <div className="grow">
                  <UserName user={u} showHandle />
                </div>
                {known.has(u.id) ? (
                  <span className="badge ok">In contacts</span>
                ) : (
                  <button className="btn sm primary" onClick={() => add.mutate(u.username)}>
                    Add
                  </button>
                )}
              </div>
            ))}
            {results.data?.length === 0 && <Empty title="Nobody found" />}
          </div>
        )}
      </div>

      <div className="card pad-0">
        <div className="card-header" style={{ padding: '16px 18px 0' }}>
          <h3>Your contacts</h3>
          <span className="muted small">{contacts.data?.length ?? 0}</span>
        </div>
        {contacts.isLoading && <Spinner center />}
        <div className="list">
          {contacts.data?.map((c) => (
            <div key={c.id} className="list-item" style={{ cursor: 'default' }}>
              <Avatar name={c.displayName} url={c.avatarUrl} />
              <Link to={`/u/${c.username}`} className="grow" style={{ color: 'inherit' }}>
                <UserName user={c} showHandle />
              </Link>
              <button className="btn sm" onClick={() => message.mutate(c.id)}>
                Message
              </button>
              <button className="btn sm ghost" onClick={() => remove.mutate(c.id)}>
                Remove
              </button>
            </div>
          ))}
        </div>
        {contacts.data?.length === 0 && (
          <Empty title="No contacts yet">Search for people above to add them.</Empty>
        )}
      </div>
    </div>
  );
}
