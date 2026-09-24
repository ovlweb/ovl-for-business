import { Avatar, Badges, ErrorAlert, formatDate, humanize, Spinner } from '@ovl/ui';
import { ROLE_LABELS } from '@ovl/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useMe } from '../auth';

export function UserPage() {
  const { username = '' } = useParams();
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: ['user', username], queryFn: () => api.users.get(username) });
  const registry = useQuery({
    queryKey: ['registry', 'holder', username],
    queryFn: () => api.registry.search({ q: username }),
  });
  const add = useMutation({
    mutationFn: () => api.contacts.add(username),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user', username] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
  const message = useMutation({
    mutationFn: () => api.chats.direct(profile.data!.id),
    onSuccess: (chat) => navigate(`/chats/${chat.id}`),
  });

  if (profile.isLoading) return <Spinner center />;
  if (!profile.data)
    return (
      <div className="page">
        <ErrorAlert error={profile.error} />
      </div>
    );
  const u = profile.data;
  const licenses =
    registry.data?.items.filter((e) => e.holder.type === 'user' && e.holder.handle === u.username) ?? [];

  return (
    <div className="page stack-lg" style={{ maxWidth: 720 }}>
      <div className="card stack">
        <div className="row">
          <Avatar name={u.displayName} url={u.avatarUrl} size={72} />
          <div className="grow stack-sm">
            <div className="row-wrap">
              <h1>{u.displayName}</h1>
              <Badges badges={u.badges} />
            </div>
            <div className="muted">
              @{u.username} · {ROLE_LABELS[u.role]} · joined {formatDate(u.createdAt, false)}
            </div>
          </div>
        </div>
        {u.bio && <p>{u.bio}</p>}
        {u.id !== me.id && (
          <div className="row-wrap">
            <button className="btn primary" onClick={() => message.mutate()}>
              Message
            </button>
            {!u.isContact && (
              <button className="btn" onClick={() => add.mutate()}>
                Add to contacts
              </button>
            )}
          </div>
        )}
      </div>
      {licenses.length > 0 && (
        <div className="card stack">
          <h3>Licenses in the registry</h3>
          {licenses.map((l) => (
            <div key={l.id} className="spread">
              <span>
                {l.title} <span className="muted small">· {humanize(l.licenseType ?? l.kind)}</span>
              </span>
              <code>{l.number}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
