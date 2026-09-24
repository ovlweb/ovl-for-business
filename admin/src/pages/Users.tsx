import { canAssignRole, ROLE_LABELS, ROLES, type AdminUser, type Role } from '@ovl/shared';
import {
  Avatar,
  ErrorAlert,
  Field,
  formatDate,
  Modal,
  PageHeader,
  Spinner,
  StatusBadge,
  useDebounced,
  UserName,
  useToast,
} from '@ovl/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { useAdmin } from '../auth';
import { Pager } from './common';

function EditUser({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const { me, can } = useAdmin();
  const queryClient = useQueryClient();
  const [role, setRole] = useState<Role>(user.role);
  const assignable = ROLES.filter((r) => r === user.role || canAssignRole(me.role, user.role, r));
  const save = useMutation({
    mutationFn: (input: { role?: Role; status?: 'active' | 'suspended' }) =>
      api.admin.updateUser(user.id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
  });
  const toast = useToast();
  const signOut = useMutation({
    mutationFn: () => api.admin.signOutUser(user.id),
    onSuccess: (r) =>
      toast.success(
        r.signedOut
          ? `Signed out on ${r.signedOut} device${r.signedOut === 1 ? '' : 's'}`
          : 'No active devices',
      ),
  });
  const editable = can('users.manage') && user.id !== me.id && canAssignRole(me.role, user.role, user.role);
  return (
    <Modal title={user.displayName} onClose={onClose}>
      <div className="stack">
        <div className="row">
          <Avatar name={user.displayName} url={user.avatarUrl} size={48} />
          <div>
            <UserName user={user} showHandle />
            <div className="small muted">
              {user.email} · joined {formatDate(user.createdAt, false)}
              {user.lastSeenAt && ` · last seen ${formatDate(user.lastSeenAt)}`}
            </div>
          </div>
        </div>
        {!editable && <div className="alert warning">You cannot change this account.</div>}
        {editable && (
          <>
            <Field
              label="Platform role"
              hint="Council and moderators normally join through applications; the council chat and moderation chat follow the role automatically."
            >
              <select className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {assignable.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </Field>
            <ErrorAlert error={save.error ?? signOut.error} />
            <div className="row-wrap">
              <button
                className="btn primary"
                disabled={role === user.role || save.isPending}
                onClick={() => save.mutate({ role })}
              >
                Save role
              </button>
              <button className="btn" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
                Sign out everywhere
              </button>
              {user.status === 'active' ? (
                <button className="btn danger" onClick={() => save.mutate({ status: 'suspended' })}>
                  Suspend account
                </button>
              ) : (
                <button className="btn success" onClick={() => save.mutate({ status: 'active' })}>
                  Reactivate account
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export function UsersPage() {
  const [q, setQ] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const search = useDebounced(q);
  const limit = 25;
  const users = useQuery({
    queryKey: ['users', search, role, offset],
    queryFn: () => api.admin.users({ q: search || undefined, role: role || undefined, limit, offset }),
  });

  return (
    <div className="page">
      <PageHeader icon="users" title="Users & roles" subtitle={`${users.data?.total ?? 0} accounts`} />
      <div className="filters">
        <input
          className="input"
          placeholder="Search name, username, email"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
        />
        <select
          className="select"
          value={role}
          onChange={(e) => {
            setRole(e.target.value as Role | '');
            setOffset(0);
          }}
        >
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </div>
      <ErrorAlert error={users.error} />
      <div className="card pad-0 table-wrap">
        {users.isLoading && <Spinner center />}
        <table className="table">
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {users.data?.items.map((u) => (
              <tr key={u.id} className="clickable" onClick={() => setEditing(u)}>
                <td>
                  <div className="row">
                    <Avatar name={u.displayName} url={u.avatarUrl} size={28} />
                    <UserName user={u} showHandle />
                  </div>
                </td>
                <td className="small">{u.email}</td>
                <td>{ROLE_LABELS[u.role]}</td>
                <td>
                  <StatusBadge status={u.status} />
                </td>
                <td className="small">{formatDate(u.createdAt, false)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.data && <Pager total={users.data.total} limit={limit} offset={offset} onChange={setOffset} />}
      </div>
      {editing && <EditUser user={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
