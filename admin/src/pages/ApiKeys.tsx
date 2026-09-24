import { ErrorAlert, formatDate, PageHeader, Spinner } from '@ovl/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { Pager } from './common';

export function ApiKeysPage() {
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const limit = 50;
  const keys = useQuery({
    queryKey: ['apikeys', offset],
    queryFn: () => api.admin.apiKeys({ limit, offset }),
  });
  const revoke = useMutation({
    mutationFn: api.admin.revokeApiKey,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['apikeys'] }),
  });
  return (
    <div className="page">
      <PageHeader
        title="Developer API keys"
        subtitle="Keys that external services use for the public registry and stock API."
      />
      <ErrorAlert error={keys.error ?? revoke.error} />
      <div className="card pad-0 table-wrap">
        {keys.isLoading && <Spinner center />}
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Owner</th>
              <th>Prefix</th>
              <th>Scopes</th>
              <th>Created</th>
              <th>Last used</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {keys.data?.items.map((k) => (
              <tr key={k.id}>
                <td className="bold">{k.name}</td>
                <td>@{k.owner.username}</td>
                <td>
                  <code>{k.prefix}…</code>
                </td>
                <td className="small">{k.scopes.join(', ')}</td>
                <td className="small">{formatDate(k.createdAt, false)}</td>
                <td className="small">{k.lastUsedAt ? formatDate(k.lastUsedAt) : '—'}</td>
                <td>
                  {k.revokedAt ? (
                    <span className="badge bad">Revoked</span>
                  ) : (
                    <button className="btn sm danger" onClick={() => revoke.mutate(k.id)}>
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {keys.data && <Pager total={keys.data.total} limit={limit} offset={offset} onChange={setOffset} />}
      </div>
    </div>
  );
}
