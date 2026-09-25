import { LICENSE_TYPE_LABELS, LICENSE_TYPES, type RegistryEntry } from '@ovl/shared';
import {
  Empty,
  ErrorAlert,
  formatDate,
  humanize,
  Icon,
  Modal,
  PageHeader,
  Spinner,
  StatusBadge,
  useDebounced,
  VerifiedBadge,
  t,
  msg,
} from '@ovl/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';

const KINDS = [
  { value: '', label: 'Everything' },
  { value: 'organization', label: 'Organizations' },
  { value: 'license', label: 'Licenses' },
  { value: 'virtual_country', label: msg('Virtual countries') },
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
          <dt>{t('Holder')}</dt>
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
              <dt>{t('Website')}</dt>
              <dd>
                <a href={entry.website} target="_blank" rel="noreferrer">
                  {entry.website}
                </a>
              </dd>
            </>
          )}
          <dt>{t('Issued')}</dt>
          <dd>{formatDate(entry.issuedAt)}</dd>
          {entry.currency && (
            <>
              <dt>{t('Currency')}</dt>
              <dd>
                <code>{entry.currency}</code>
              </dd>
            </>
          )}
          {entry.expiresAt && (
            <>
              <dt>{t('Valid until')}</dt>
              <dd>{formatDate(entry.expiresAt, false)}</dd>
            </>
          )}
          <dt>{t('Updated')}</dt>
          <dd>{formatDate(entry.updatedAt)}</dd>
        </dl>
        <div className="row-wrap">
          <a
            className="btn"
            href={api.registry.certificateUrl(entry.number)}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="award" size={16} /> {t('Certificate (PDF)')}
          </a>
          <Link className="btn ghost" to={`/verify/${entry.number}`} onClick={onClose}>
            <Icon name="shield" size={16} /> {t('Verification page')}
          </Link>
        </div>
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
        title={t('Public registry')}
        subtitle={t(
          'Every approved license, organization and virtual country. Also available to other services via the public API.',
        )}
      />
      <div className="card stack">
        <input
          className="input"
          placeholder={t('Search by name, registry number, holder…')}
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
              {t(k.label)}
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
            <option value="">{t('Any license type')}</option>
            {LICENSE_TYPES.map((kind) => (
              <option key={kind} value={kind}>
                {t(LICENSE_TYPE_LABELS[kind])}
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
                  {e.holder.verified && ` ${t('✓ verified')}`} {t('· issued')} {formatDate(e.issuedAt, false)}
                </div>
              </div>
              <code className="small">{e.number}</code>
            </button>
          ))}
        </div>
        {results.data?.items.length === 0 && <Empty title={t('Nothing found in the registry')} />}
      </div>
      {results.data && results.data.total > limit && (
        <div className="spread">
          <button className="btn sm" disabled={offset === 0} onClick={() => setOffset(offset - limit)}>
            {t('Previous')}
          </button>
          <span className="small muted">
            {t(
              '{0}–{1} of {2}',
              offset + 1,
              Math.min(offset + limit, results.data.total),
              results.data.total,
            )}
          </span>
          <button
            className="btn sm"
            disabled={offset + limit >= results.data.total}
            onClick={() => setOffset(offset + limit)}
          >
            {t('Next')}
          </button>
        </div>
      )}
      {open && <EntryModal entry={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
