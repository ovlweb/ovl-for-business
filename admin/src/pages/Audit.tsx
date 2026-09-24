import { ErrorAlert, formatDate, PageHeader, Spinner, useDebounced } from '@ovl/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { Pager } from './common';

export function AuditPage() {
  const [action, setAction] = useState('');
  const [offset, setOffset] = useState(0);
  const filter = useDebounced(action);
  const limit = 50;
  const logs = useQuery({
    queryKey: ['audit', filter, offset],
    queryFn: () => api.admin.auditLogs({ action: filter || undefined, limit, offset }),
  });
  return (
    <div className="page">
      <PageHeader
        title="Audit log"
        subtitle="Every privileged action: role changes, money operations, approvals, registry changes…"
      />
      <div className="filters">
        <input
          className="input"
          placeholder="Action prefix, e.g. wallet. or application."
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setOffset(0);
          }}
        />
      </div>
      <ErrorAlert error={logs.error} />
      <div className="card pad-0 table-wrap">
        {logs.isLoading && <Spinner center />}
        <table className="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Target</th>
              <th>Details</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {logs.data?.items.map((l) => (
              <tr key={l.id}>
                <td className="small nowrap">{formatDate(l.createdAt)}</td>
                <td>{l.actor ? `@${l.actor.username}` : 'system'}</td>
                <td>
                  <code>{l.action}</code>
                </td>
                <td className="small">
                  {l.targetType} <span className="muted mono">{l.targetId?.slice(0, 8)}</span>
                </td>
                <td className="small mono" style={{ maxWidth: 360, wordBreak: 'break-all' }}>
                  {Object.keys(l.data).length ? JSON.stringify(l.data) : ''}
                </td>
                <td className="small">{l.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {logs.data && <Pager total={logs.data.total} limit={limit} offset={offset} onChange={setOffset} />}
      </div>
    </div>
  );
}
