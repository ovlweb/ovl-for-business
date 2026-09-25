import { COUNCIL_VOTING_LABELS, type TransparencyReport } from '@ovl/shared';
import { Empty, ErrorAlert, formatDate, Logo, PageHeader, plural, Spinner, UserName, t } from '@ovl/ui';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

const day = (iso: string) => formatDate(iso, false);

function Numbers({ rows }: { rows: [string, number | string | null][] }) {
  return (
    <dl className="dl small">
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: 'contents' }}>
          <dt>{label}</dt>
          <dd className="num">{value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

function Report({ report: r }: { report: TransparencyReport }) {
  const s = r.stats;
  return (
    <article className="card stack" aria-label={r.title}>
      <div className="spread">
        <div>
          <h3>{r.title}</h3>
          <div className="small muted">
            {day(r.periodStart)} – {day(r.periodEnd)} {t('· published')} {day(r.publishedAt)}
            {r.publishedBy && ` ${t('by {0}', r.publishedBy.displayName)}`}
          </div>
        </div>
      </div>
      {r.notes && <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{r.notes}</p>}
      <div className="grid-3">
        <div className="stack-sm">
          <b className="small">{t('Applications')}</b>
          <Numbers
            rows={[
              [t('Received'), s.applications.received],
              [t('Approved'), s.applications.approved],
              [t('Not approved'), s.applications.rejected],
              [t('Sent back for changes'), s.applications.changesRequested],
              [
                t('Median time to decide'),
                s.applications.medianDecisionHours === null
                  ? null
                  : t('{0} h', s.applications.medianDecisionHours),
              ],
            ]}
          />
        </div>
        <div className="stack-sm">
          <b className="small">{t('Council')}</b>
          <Numbers
            rows={[
              [t('Members'), s.council.members],
              [t('Votes cast'), s.council.votes],
              [t('For'), s.council.approvals],
              [t('Against'), s.council.rejections],
            ]}
          />
        </div>
        <div className="stack-sm">
          <b className="small">{t('Moderation and support')}</b>
          <Numbers
            rows={[
              [t('Accounts suspended'), s.moderation.accountsSuspended],
              [t('Identities verified'), s.moderation.identityApproved],
              [t('Identity checks declined'), s.moderation.identityRejected],
              [t('Licences revoked or suspended'), s.moderation.registryRevoked],
              [t('Support tickets opened'), s.support.ticketsOpened],
            ]}
          />
        </div>
        <div className="stack-sm">
          <b className="small">{t('Registry')}</b>
          <Numbers
            rows={[
              [t('Entries added'), s.registry.added],
              [t('Expired'), s.registry.expired],
              [t('Active'), s.registry.active],
            ]}
          />
        </div>
        <div className="stack-sm">
          <b className="small">{t('Economy')}</b>
          <Numbers
            rows={[
              [t('New accounts'), s.economy.newAccounts],
              [t('Companies listed'), s.economy.companiesListed],
              [t('Investments'), s.economy.investments],
              [t('Trades'), s.economy.trades],
            ]}
          />
        </div>
      </div>
      {s.applications.byType.length > 0 && (
        <table className="table small">
          <thead>
            <tr>
              <th>{t('Application')}</th>
              <th className="right">{t('Received')}</th>
              <th className="right">{t('Approved')}</th>
              <th className="right">{t('Not approved')}</th>
            </tr>
          </thead>
          <tbody>
            {s.applications.byType.map((row) => (
              <tr key={row.type}>
                <td>{t(row.label)}</td>
                <td className="right num">{row.received}</td>
                <td className="right num">{row.approved}</td>
                <td className="right num">{row.rejected}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </article>
  );
}

function TransparencyContent() {
  const governance = useQuery({ queryKey: ['governance'], queryFn: api.governance.get });
  const reports = useQuery({ queryKey: ['transparency'], queryFn: api.governance.reports });
  const g = governance.data;
  return (
    <>
      <ErrorAlert error={governance.error ?? reports.error} />
      {g && (
        <div className="card stack">
          <h3>{t('How decisions are made')}</h3>
          <p className="small" style={{ margin: 0 }}>
            {t(
              "Applications pass moderation, then a council vote, then the owner's confirmation. A council vote needs",
            )}{' '}
            <b>{plural(g.votesNeeded, 'vote')}</b>{' '}
            {t(
              'of {0} ({1}). Council seats {2}.',
              plural(g.activeCouncilMembers, 'member'),
              t(COUNCIL_VOTING_LABELS[g.councilVoting]).toLowerCase(),
              g.councilTermMonths
                ? t('last {0}', plural(g.councilTermMonths, 'month'))
                : t('have no fixed term'),
            )}
          </p>
          {g.council.length > 0 && (
            <div className="row-wrap small">
              {g.council.map((c) => (
                <span key={c.user.id} className="chip">
                  <UserName user={c.user} />
                  {c.termEndsAt && <span className="muted">{t('· until {0}', day(c.termEndsAt))}</span>}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {reports.isLoading && <Spinner center />}
      {reports.data?.length === 0 && (
        <Empty title={t('No reports yet')}>
          {t('The platform publishes a report on how it was governed after each period.')}
        </Empty>
      )}
      {reports.data?.map((r) => (
        <Report key={r.id} report={r} />
      ))}
    </>
  );
}

/** Governance rules and published transparency reports (in the app). */
export function TransparencyPage() {
  return (
    <div className="page stack-lg">
      <PageHeader
        icon="award"
        title={t('Transparency')}
        subtitle={t(
          'How the platform is governed: council rules, members, and regular reports on decisions.',
        )}
      />
      <TransparencyContent />
    </div>
  );
}

/** The same for people who are not signed in (a public link). */
export function PublicTransparencyPage() {
  return (
    <div className="link-shell">
      <div className="card link-card stack-lg" style={{ maxWidth: 960 }}>
        <div className="row">
          <Logo size={40} />
          <div>
            <b>{t('OVL For Business')}</b>
            <div className="small muted">{t('Transparency')}</div>
          </div>
        </div>
        <TransparencyContent />
      </div>
    </div>
  );
}
