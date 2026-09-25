import { LICENSE_TYPE_LABELS } from '@ovl/shared';
import { ErrorAlert, formatDate, Icon, Logo, Spinner, StatusBadge, VerifiedBadge } from '@ovl/ui';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';

/**
 * Where the QR code on a certificate leads: the live registry entry, for anyone, signed in or
 * not. The printed certificate is only valid while this page says so.
 */
export function VerifyPage() {
  const { number = '' } = useParams();
  const { me } = useAuth();
  const entry = useQuery({
    queryKey: ['registry', 'verify', number],
    queryFn: () => api.registry.get(number),
    retry: false,
  });
  const e = entry.data;
  const valid = e?.status === 'active';
  const kind = e
    ? e.kind === 'organization'
      ? 'Company registration'
      : e.kind === 'virtual_country'
        ? 'Virtual country'
        : `${e.licenseType ? LICENSE_TYPE_LABELS[e.licenseType] : 'Virtual'} licence`
    : '';
  return (
    <div className="link-shell">
      <motion.div
        className="card link-card stack-lg"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="row">
          <Logo size={40} />
          <div>
            <b>OVL For Business</b>
            <div className="small muted">Public registry · verification</div>
          </div>
        </div>
        {entry.isLoading && <Spinner center />}
        {entry.error && (
          <div className="stack">
            <h1 className="auth-title">Not in the registry</h1>
            <p className="muted">
              No entry has the number <code>{number}</code>. A certificate showing it is not genuine.
            </p>
            <ErrorAlert error={entry.error} />
          </div>
        )}
        {e && (
          <div className="stack">
            <div className={`verify-result ${valid ? 'ok' : 'bad'}`}>
              <Icon name={valid ? 'check' : 'x'} size={22} />
              <div>
                <b>{valid ? 'Valid' : `Not valid: ${e.status}`}</b>
                <div className="small">
                  {valid
                    ? `This ${e.kind === 'organization' ? 'registration' : 'licence'} is active in the registry.`
                    : 'The registry no longer recognises it; the certificate is void.'}
                </div>
              </div>
            </div>
            <h1 className="auth-title" style={{ margin: 0 }}>
              {e.title}
            </h1>
            <dl className="dl">
              <dt>Registry number</dt>
              <dd>
                <code>{e.number}</code>
              </dd>
              <dt>Type</dt>
              <dd>{kind}</dd>
              <dt>Holder</dt>
              <dd>
                {e.holder.name} {e.holder.verified && <VerifiedBadge />}
              </dd>
              <dt>Status</dt>
              <dd>
                <StatusBadge status={e.status} />
              </dd>
              <dt>Issued</dt>
              <dd>{formatDate(e.issuedAt, false)}</dd>
              {e.expiresAt && (
                <>
                  <dt>Valid until</dt>
                  <dd>{formatDate(e.expiresAt, false)}</dd>
                </>
              )}
              <dt>Last change</dt>
              <dd>{formatDate(e.updatedAt)}</dd>
            </dl>
            <div className="row-wrap">
              <a
                className="btn"
                href={api.registry.certificateUrl(e.number)}
                target="_blank"
                rel="noreferrer"
              >
                <Icon name="award" size={16} /> Certificate (PDF)
              </a>
              <Link className="btn ghost" to={me ? `/registry?q=${e.number}` : '/'}>
                {me ? 'Open in the registry' : 'Sign in to OVL For Business'}
              </Link>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
