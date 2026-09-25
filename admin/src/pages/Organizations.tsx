import { ErrorAlert, formatDate, PageHeader, Spinner, StatusBadge, useDebounced, t } from '@ovl/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { useAdmin } from '../auth';
import { Pager } from './common';

export function OrganizationsPage() {
  const { can } = useAdmin();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const search = useDebounced(q);
  const limit = 25;
  const orgs = useQuery({
    queryKey: ['orgs', search, offset],
    queryFn: () => api.admin.organizations({ q: search || undefined, limit, offset }),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'suspended' }) =>
      api.admin.setOrganizationStatus(id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orgs'] }),
  });

  return (
    <div className="page">
      <PageHeader
        icon="building"
        title={t('Organizations')}
        subtitle={t('Companies registered through approved applications.')}
      />
      <div className="filters">
        <input
          className="input"
          placeholder={t('Search by name')}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
        />
      </div>
      <ErrorAlert error={orgs.error ?? setStatus.error} />
      <div className="card pad-0 table-wrap">
        {orgs.isLoading && <Spinner center />}
        <table className="table">
          <thead>
            <tr>
              <th>{t('Company')}</th>
              <th>{t('Registry number')}</th>
              <th>{t('Owner')}</th>
              <th>{t('Ticker')}</th>
              <th>{t('Members')}</th>
              <th>{t('Registered')}</th>
              <th>{t('Status')}</th>
              {can('organizations.manage') && <th />}
            </tr>
          </thead>
          <tbody>
            {orgs.data?.items.map((o) => (
              <tr key={o.id}>
                <td>
                  <b>{o.name}</b>
                  <div className="small muted">{o.slug}</div>
                </td>
                <td>
                  <code>{o.registryNumber}</code>
                </td>
                <td>@{o.owner.username}</td>
                <td>{o.ticker ?? '—'}</td>
                <td className="num">{o.memberCount}</td>
                <td className="small">{formatDate(o.createdAt, false)}</td>
                <td>
                  <StatusBadge status={o.status} />
                </td>
                {can('organizations.manage') && (
                  <td>
                    <button
                      className={`btn sm ${o.status === 'active' ? 'danger' : 'success'}`}
                      onClick={() =>
                        setStatus.mutate({ id: o.id, status: o.status === 'active' ? 'suspended' : 'active' })
                      }
                    >
                      {o.status === 'active' ? t('Suspend') : t('Reactivate')}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {orgs.data && <Pager total={orgs.data.total} limit={limit} offset={offset} onChange={setOffset} />}
      </div>
    </div>
  );
}
