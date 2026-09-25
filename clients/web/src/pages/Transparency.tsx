import { COUNCIL_VOTING_LABELS, type TransparencyReport } from '@ovl/shared';
import { Empty, ErrorAlert, formatDate, Logo, PageHeader, plural, Spinner, UserName } from '@ovl/ui';
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
            {day(r.periodStart)} – {day(r.periodEnd)} · published {day(r.publishedAt)}
            {r.publishedBy && ` by ${r.publishedBy.displayName}`}
          </div>
        </div>
      </div>
      {r.notes && <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{r.notes}</p>}
      <div className="grid-3">
        <div className="stack-sm">
          <b className="small">Applications</b>
          <Numbers
            rows={[
              ['Received', s.applications.received],
              ['Approved', s.applications.approved],
              ['Not approved', s.applications.rejected],
              ['Sent back for changes', s.applications.changesRequested],
              [
                'Median time to decide',
                s.applications.medianDecisionHours === null
                  ? null
                  : `${s.applications.medianDecisionHours} h`,
              ],
            ]}
          />
        </div>
        <div className="stack-sm">
          <b className="small">Council</b>
          <Numbers
            rows={[
              ['Members', s.council.members],
              ['Votes cast', s.council.votes],
              ['For', s.council.approvals],
              ['Against', s.council.rejections],
            ]}
          />
        </div>
        <div className="stack-sm">
          <b className="small">Moderation and support</b>
          <Numbers
            rows={[
              ['Accounts suspended', s.moderation.accountsSuspended],
              ['Identities verified', s.moderation.identityApproved],
              ['Identity checks declined', s.moderation.identityRejected],
              ['Licences revoked or suspended', s.moderation.registryRevoked],
              ['Support tickets opened', s.support.ticketsOpened],
            ]}
          />
        </div>
        <div className="stack-sm">
          <b className="small">Registry</b>
          <Numbers
            rows={[
              ['Entries added', s.registry.added],
              ['Expired', s.registry.expired],
              ['Active', s.registry.active],
            ]}
          />
        </div>
        <div className="stack-sm">
          <b className="small">Economy</b>
          <Numbers
            rows={[
              ['New accounts', s.economy.newAccounts],
              ['Companies listed', s.economy.companiesListed],
              ['Investments', s.economy.investments],
              ['Trades', s.economy.trades],
            ]}
          />
        </div>
      </div>
      {s.applications.byType.length > 0 && (
        <table className="table small">
          <thead>
            <tr>
              <th>Application</th>
              <th className="right">Received</th>
              <th className="right">Approved</th>
              <th className="right">Not approved</th>
            </tr>
          </thead>
          <tbody>
            {s.applications.byType.map((t) => (
              <tr key={t.type}>
                <td>{t.label}</td>
                <td className="right num">{t.received}</td>
                <td className="right num">{t.approved}</td>
                <td className="right num">{t.rejected}</td>
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
          <h3>How decisions are made</h3>
          <p className="small" style={{ margin: 0 }}>
            Applications pass moderation, then a council vote, then the owner's confirmation. A council vote
            needs <b>{plural(g.votesNeeded, 'vote')}</b> of {plural(g.activeCouncilMembers, 'member')} (
            {COUNCIL_VOTING_LABELS[g.councilVoting].toLowerCase()}). Council seats{' '}
            {g.councilTermMonths ? `last ${plural(g.councilTermMonths, 'month')}` : 'have no fixed term'}.
          </p>
          {g.council.length > 0 && (
            <div className="row-wrap small">
              {g.council.map((c) => (
                <span key={c.user.id} className="chip">
                  <UserName user={c.user} />
                  {c.termEndsAt && <span className="muted"> · until {day(c.termEndsAt)}</span>}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {reports.isLoading && <Spinner center />}
      {reports.data?.length === 0 && (
        <Empty title="No reports yet">
          The platform publishes a report on how it was governed after each period.
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
        title="Transparency"
        subtitle="How the platform is governed: council rules, members, and regular reports on decisions."
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
            <b>OVL For Business</b>
            <div className="small muted">Transparency</div>
          </div>
        </div>
        <TransparencyContent />
      </div>
    </div>
  );
}
