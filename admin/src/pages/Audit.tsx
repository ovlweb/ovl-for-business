import { ErrorAlert, formatDate, PageHeader, saveBlob, Spinner, useDebounced, useToast, t } from '@ovl/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
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
  const toast = useToast();
  const exportLog = useMutation({
    mutationFn: async (format: 'csv' | 'ndjson') => {
      const { blob, filename } = await api.admin.exportAuditLogs({ format, action: filter || undefined });
      saveBlob(blob, filename ?? `audit-log.${format}`);
    },
    onError: toast.error,
  });
  return (
    <div className="page">
      <PageHeader
        icon="shield"
        title={t('Audit log')}
        subtitle={t('Every privileged action: role changes, money operations, approvals, registry changes…')}
        actions={
          <div className="row">
            <button className="btn" disabled={exportLog.isPending} onClick={() => exportLog.mutate('csv')}>
              {t('Export CSV')}
            </button>
            <button className="btn" disabled={exportLog.isPending} onClick={() => exportLog.mutate('ndjson')}>
              {t('Export NDJSON')}
            </button>
          </div>
        }
      />
      <div className="filters">
        <input
          className="input"
          placeholder={t('Action prefix, e.g. wallet. or application.')}
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
              <th>{t('Time')}</th>
              <th>{t('Actor')}</th>
              <th>{t('Action')}</th>
              <th>{t('Target')}</th>
              <th>{t('Details')}</th>
              <th>{t('IP')}</th>
            </tr>
          </thead>
          <tbody>
            {logs.data?.items.map((l) => (
              <tr key={l.id}>
                <td className="small nowrap">{formatDate(l.createdAt)}</td>
                <td>{l.actor ? `@${l.actor.username}` : t('system')}</td>
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
