import { REGISTRY_STATUSES, type RegistryEntry } from '@ovl/shared';
import {
  ErrorAlert,
  formatDate,
  formatMoney,
  humanize,
  Modal,
  PageHeader,
  Spinner,
  StatusBadge,
  useDebounced,
} from '@ovl/ui';
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
  const [currency, setCurrency] = useState<string | null>(null);
  /** Staff renewal: one more year from today or from the current expiry, whichever is later. */
  const extend = useMutation({
    mutationFn: (e: RegistryEntry) => {
      const from = e.expiresAt && new Date(e.expiresAt) > new Date() ? new Date(e.expiresAt) : new Date();
      from.setUTCFullYear(from.getUTCFullYear() + 1);
      return api.admin.setRegistryExpiry(e.id, from.toISOString());
    },
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
          aria-label="Status filter"
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
      <ErrorAlert error={entries.error ?? update.error ?? extend.error} />
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
              <th>Valid until</th>
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
                <td>
                  {e.title}
                  {e.currency && (
                    <button
                      className="btn ghost sm"
                      style={{ marginLeft: 6 }}
                      onClick={() => setCurrency(e.currency)}
                    >
                      <code>{e.currency}</code>
                    </button>
                  )}
                </td>
                <td className="small">{humanize(e.licenseType ?? e.kind)}</td>
                <td className="small">{e.holder.name}</td>
                <td className="small">{formatDate(e.issuedAt, false)}</td>
                <td className="small nowrap">
                  {e.expiresAt ? formatDate(e.expiresAt, false) : '—'}
                  {e.expiresAt && can('registry.manage') && (
                    <button
                      className="btn ghost sm"
                      style={{ marginLeft: 6 }}
                      title="Extend by one year"
                      disabled={extend.isPending}
                      onClick={() => extend.mutate(e)}
                    >
                      +1 year
                    </button>
                  )}
                </td>
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
      {currency && <CurrencyModal code={currency} onClose={() => setCurrency(null)} />}
    </div>
  );
}

/** A virtual currency: supply, holders, and suspending new issuance. */
function CurrencyModal({ code, onClose }: { code: string; onClose: () => void }) {
  const { can } = useAdmin();
  const queryClient = useQueryClient();
  const info = useQuery({
    queryKey: ['virtualCurrency', code],
    queryFn: () => api.virtualCurrencies.get(code),
  });
  const toggle = useMutation({
    mutationFn: (status: 'active' | 'suspended') => api.admin.setCurrencyStatus(code, status),
    onSuccess: (c) => queryClient.setQueryData(['virtualCurrency', code], c),
  });
  const c = info.data;
  return (
    <Modal title={c ? `${c.code} · ${c.name}` : code} onClose={onClose}>
      <div className="stack">
        <ErrorAlert error={info.error ?? toggle.error} />
        {c && (
          <dl className="dl">
            <dt>Issued by</dt>
            <dd>
              {c.country} (<code>{c.registryNumber}</code>)
            </dd>
            <dt>In circulation</dt>
            <dd>{formatMoney(c.supply, c.code)}</dd>
            <dt>Balances holding it</dt>
            <dd>{c.holders}</dd>
            <dt>Status</dt>
            <dd>
              <StatusBadge status={c.status} />
            </dd>
          </dl>
        )}
        {c && can('registry.manage') && (
          <button
            className={`btn ${c.status === 'active' ? 'danger' : 'primary'}`}
            disabled={toggle.isPending}
            onClick={() => toggle.mutate(c.status === 'active' ? 'suspended' : 'active')}
          >
            {c.status === 'active' ? 'Suspend new issuance' : 'Allow issuance again'}
          </button>
        )}
      </div>
    </Modal>
  );
}
