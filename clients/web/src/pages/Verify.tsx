import { LICENSE_TYPE_LABELS } from '@ovl/shared';
import {
  ErrorAlert,
  formatDate,
  Icon,
  Logo,
  humanize,
  Spinner,
  StatusBadge,
  VerifiedBadge,
  t,
} from '@ovl/ui';
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
      ? t('Company registration')
      : e.kind === 'virtual_country'
        ? t('Virtual country')
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
            <b>{t('OVL For Business')}</b>
            <div className="small muted">{t('Public registry · verification')}</div>
          </div>
        </div>
        {entry.isLoading && <Spinner center />}
        {entry.error && (
          <div className="stack">
            <h1 className="auth-title">{t('Not in the registry')}</h1>
            <p className="muted">
              {t('No entry has the number')} <code>{number}</code>
              {t('. A certificate showing it is not genuine.')}
            </p>
            <ErrorAlert error={entry.error} />
          </div>
        )}
        {e && (
          <div className="stack">
            <div className={`verify-result ${valid ? 'ok' : 'bad'}`}>
              <Icon name={valid ? 'check' : 'x'} size={22} />
              <div>
                <b>{valid ? t('Valid') : t('Not valid: {0}', humanize(e.status).toLowerCase())}</b>
                <div className="small">
                  {valid
                    ? e.kind === 'organization'
                      ? t('This registration is active in the registry.')
                      : t('This licence is active in the registry.')
                    : t('The registry no longer recognises it; the certificate is void.')}
                </div>
              </div>
            </div>
            <h1 className="auth-title" style={{ margin: 0 }}>
              {e.title}
            </h1>
            <dl className="dl">
              <dt>{t('Registry number')}</dt>
              <dd>
                <code>{e.number}</code>
              </dd>
              <dt>{t('Type')}</dt>
              <dd>{kind}</dd>
              <dt>{t('Holder')}</dt>
              <dd>
                {e.holder.name} {e.holder.verified && <VerifiedBadge />}
              </dd>
              <dt>{t('Status')}</dt>
              <dd>
                <StatusBadge status={e.status} />
              </dd>
              <dt>{t('Issued')}</dt>
              <dd>{formatDate(e.issuedAt, false)}</dd>
              {e.expiresAt && (
                <>
                  <dt>{t('Valid until')}</dt>
                  <dd>{formatDate(e.expiresAt, false)}</dd>
                </>
              )}
              <dt>{t('Last change')}</dt>
              <dd>{formatDate(e.updatedAt)}</dd>
            </dl>
            <div className="row-wrap">
              <a
                className="btn"
                href={api.registry.certificateUrl(e.number)}
                target="_blank"
                rel="noreferrer"
              >
                <Icon name="award" size={16} /> {t('Certificate (PDF)')}
              </a>
              <Link className="btn ghost" to={me ? `/registry?q=${e.number}` : '/'}>
                {me ? t('Open in the registry') : t('Sign in to OVL For Business')}
              </Link>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
