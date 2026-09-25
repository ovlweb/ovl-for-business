import { REGISTRY_STATUSES, type RegistryEntry } from '@ovl/shared';
import { ErrorAlert, formatDate, humanize, PageHeader, Spinner, StatusBadge, useDebounced } from '@ovl/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { useAdmin } from '../auth';
import { Pager } from './common';

export function RegistryPage() {
  const { can } = useAdmin();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<RegistryEntry['status']>('active');
  const [offset, setOffset] = useState(0);
  const search = useDebounced(q);
  const limit = 25;
  const entries = useQuery({
    queryKey: ['registry', search, status, offset],
    queryFn: () => api.registry.search({ q: search || undefined, status, limit, offset }),
  });
  const update = useMutation({
    mutationFn: ({ id, next }: { id: string; next: RegistryEntry['status'] }) =>
      api.admin.setRegistryStatus(id, next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['registry'] }),
  });

  return (
    <div className="page">
      <PageHeader
        icon="book"
        title="Registry"
        subtitle="Licenses, organizations and virtual countries rolled out to the public registry."
      />
      <div className="filters">
        <input
          className="input"
          placeholder="Search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
        />
        <select
          className="select"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as RegistryEntry['status']);
            setOffset(0);
          }}
        >
          {REGISTRY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {humanize(s)}
            </option>
          ))}
        </select>
      </div>
      <ErrorAlert error={entries.error ?? update.error} />
      <div className="card pad-0 table-wrap">
        {entries.isLoading && <Spinner center />}
        <table className="table">
          <thead>
            <tr>
              <th>Number</th>
              <th>Title</th>
              <th>Type</th>
              <th>Holder</th>
              <th>Issued</th>
              <th>Status</th>
              {can('registry.manage') && <th>Change status</th>}
            </tr>
          </thead>
          <tbody>
            {entries.data?.items.map((e) => (
              <tr key={e.id}>
                <td>
                  <a
                    href={api.registry.certificateUrl(e.number)}
                    target="_blank"
                    rel="noreferrer"
                    title="Certificate (PDF)"
                  >
                    <code>{e.number}</code>
                  </a>
                </td>
                <td>{e.title}</td>
                <td className="small">{humanize(e.licenseType ?? e.kind)}</td>
                <td className="small">{e.holder.name}</td>
                <td className="small">{formatDate(e.issuedAt, false)}</td>
                <td>
                  <StatusBadge status={e.status} />
                </td>
                {can('registry.manage') && (
                  <td>
                    <select
                      className="select"
                      style={{ height: 32, width: 130 }}
                      value={e.status}
                      onChange={(ev) =>
                        update.mutate({ id: e.id, next: ev.target.value as RegistryEntry['status'] })
                      }
                    >
                      {REGISTRY_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {humanize(s)}
                        </option>
                      ))}
                    </select>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {entries.data && (
          <Pager total={entries.data.total} limit={limit} offset={offset} onChange={setOffset} />
        )}
      </div>
    </div>
  );
}
