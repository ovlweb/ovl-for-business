import { LICENSE_TYPE_LABELS, LICENSE_TYPES, type RegistryEntry } from '@ovl/shared';
import {
  Empty,
  ErrorAlert,
  formatDate,
  humanize,
  Modal,
  PageHeader,
  Spinner,
  StatusBadge,
  useDebounced,
  VerifiedBadge,
} from '@ovl/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';

const KINDS = [
  { value: '', label: 'Everything' },
  { value: 'organization', label: 'Organizations' },
  { value: 'license', label: 'Licenses' },
  { value: 'virtual_country', label: 'Virtual countries' },
] as const;

function EntryModal({ entry, onClose }: { entry: RegistryEntry; onClose: () => void }) {
  return (
    <Modal title={entry.title} onClose={onClose}>
      <div className="stack">
        <div className="row-wrap">
          <code className="badge info">{entry.number}</code>
          <StatusBadge status={entry.status} />
          <span className="badge">{humanize(entry.licenseType ?? entry.kind)}</span>
        </div>
        <p style={{ whiteSpace: 'pre-wrap' }}>{entry.description}</p>
        <dl className="dl">
          <dt>Holder</dt>
          <dd>
            {entry.holder.type === 'organization' ? (
              <>
                <Link to={`/companies/${entry.holder.handle}`} onClick={onClose}>
                  {entry.holder.name}
                </Link>{' '}
                {entry.holder.verified && <VerifiedBadge />}
              </>
            ) : (
              <Link to={`/u/${entry.holder.handle}`} onClick={onClose}>
                {entry.holder.name} (@{entry.holder.handle})
              </Link>
            )}
          </dd>
          {entry.website && (
            <>
              <dt>Website</dt>
              <dd>
                <a href={entry.website} target="_blank" rel="noreferrer">
                  {entry.website}
                </a>
              </dd>
            </>
          )}
          <dt>Issued</dt>
          <dd>{formatDate(entry.issuedAt)}</dd>
          <dt>Updated</dt>
          <dd>{formatDate(entry.updatedAt)}</dd>
        </dl>
      </div>
    </Modal>
  );
}

export function RegistryPage() {
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [kind, setKind] = useState('');
  const [licenseType, setLicenseType] = useState('');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<RegistryEntry | null>(null);
  const search = useDebounced(q);
  const limit = 20;
  const query = {
    q: search || undefined,
    kind: (kind || undefined) as RegistryEntry['kind'] | undefined,
    licenseType: (licenseType || undefined) as (typeof LICENSE_TYPES)[number] | undefined,
    limit,
    offset,
  };
  const results = useQuery({ queryKey: ['registry', query], queryFn: () => api.registry.search(query) });

  return (
    <div className="page stack-lg">
      <PageHeader
        icon="book"
        title="Public registry"
        subtitle="Every approved license, organization and virtual country. Also available to other services via the public API."
      />
      <div className="card stack">
        <input
          className="input"
          placeholder="Search by name, registry number, holder…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
        />
        <div className="row-wrap">
          {KINDS.map((k) => (
            <button
              key={k.value}
              className={`chip${kind === k.value ? ' active' : ''}`}
              onClick={() => {
                setKind(k.value);
                setOffset(0);
              }}
            >
              {k.label}
            </button>
          ))}
          <select
            className="select"
            style={{ width: 220 }}
            value={licenseType}
            onChange={(e) => {
              setLicenseType(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">Any license type</option>
            {LICENSE_TYPES.map((t) => (
              <option key={t} value={t}>
                {LICENSE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {results.isLoading && <Spinner center />}
      <ErrorAlert error={results.error} />
      <div className="card pad-0">
        <div className="list">
          {results.data?.items.map((e) => (
            <button key={e.id} className="list-item" onClick={() => setOpen(e)}>
              <div className="grow">
                <div className="row-wrap">
                  <span className="bold">{e.title}</span>
                  <span className="badge">{humanize(e.licenseType ?? e.kind)}</span>
                </div>
                <div className="small muted">
                  {e.holder.name}
                  {e.holder.verified && ' ✓ verified'} · issued {formatDate(e.issuedAt, false)}
                </div>
              </div>
              <code className="small">{e.number}</code>
            </button>
          ))}
        </div>
        {results.data?.items.length === 0 && <Empty title="Nothing found in the registry" />}
      </div>
      {results.data && results.data.total > limit && (
        <div className="spread">
          <button className="btn sm" disabled={offset === 0} onClick={() => setOffset(offset - limit)}>
            Previous
          </button>
          <span className="small muted">
            {offset + 1}–{Math.min(offset + limit, results.data.total)} of {results.data.total}
          </span>
          <button
            className="btn sm"
            disabled={offset + limit >= results.data.total}
            onClick={() => setOffset(offset + limit)}
          >
            Next
          </button>
        </div>
      )}
      {open && <EntryModal entry={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
