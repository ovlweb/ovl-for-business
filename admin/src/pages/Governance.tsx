import { COUNCIL_VOTING, COUNCIL_VOTING_LABELS, type CouncilVoting, type Governance } from '@ovl/shared';
import { ErrorAlert, Field, formatDate, PageHeader, plural, Spinner, useToast, t, intlLocale } from '@ovl/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAdmin } from '../auth';

const dayInput = (d: Date) => d.toISOString().slice(0, 10);

/** Council voting rules, council terms and transparency reports. */
export function GovernancePage() {
  const { can } = useAdmin();
  const governance = useQuery({ queryKey: ['governance'], queryFn: api.governance.get });
  return (
    <div className="page stack-lg">
      <PageHeader
        icon="award"
        title={t('Governance')}
        subtitle={t(
          'How the council decides, how long seats last, and the transparency reports the platform publishes.',
        )}
      />
      <ErrorAlert error={governance.error} />
      {governance.isLoading && <Spinner center />}
      {governance.data && <Rules governance={governance.data} editable={can('governance.manage')} />}
      {governance.data && <Council governance={governance.data} canRenew={can('users.manage')} />}
      {can('transparency.publish') && <Reports />}
    </div>
  );
}

function Rules({ governance: g, editable }: { governance: Governance; editable: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    voting: g.councilVoting,
    quorum: String(g.councilQuorum),
    term: String(g.councilTermMonths),
  });
  useEffect(
    () =>
      setForm({
        voting: g.councilVoting,
        quorum: String(g.councilQuorum),
        term: String(g.councilTermMonths),
      }),
    [g.councilVoting, g.councilQuorum, g.councilTermMonths],
  );
  const save = useMutation({
    mutationFn: () =>
      api.admin.setGovernance({
        councilVoting: form.voting,
        councilQuorum: Number(form.quorum),
        councilTermMonths: Number(form.term),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['governance'], data);
      toast.success(t('Governance rules saved'));
    },
  });
  return (
    <form
      className="card stack"
      aria-label={t('Council rules')}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div>
        <h3>{t('Council rules')}</h3>
        <p className="small muted" style={{ margin: 0 }}>
          {t('Right now a council stage needs')} {plural(g.votesNeeded, 'vote')} {t('of')}{' '}
          {plural(g.activeCouncilMembers, 'active member')}.
          {!editable && ` ${t('Only the owner changes these rules.')}`}
        </p>
      </div>
      <div className="grid-3">
        <Field label={t('A council stage passes with')}>
          <select
            className="input"
            value={form.voting}
            disabled={!editable}
            onChange={(e) => setForm({ ...form, voting: e.target.value as CouncilVoting })}
          >
            {COUNCIL_VOTING.map((v) => (
              <option key={v} value={v}>
                {t(COUNCIL_VOTING_LABELS[v])}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Quorum (votes)')} hint={t('Used in quorum mode; never more than the council has')}>
          <input
            className="input"
            inputMode="numeric"
            value={form.quorum}
            disabled={!editable || form.voting !== 'quorum'}
            onChange={(e) => setForm({ ...form, quorum: e.target.value.replace(/\D/g, '') })}
          />
        </Field>
        <Field label={t('Council term (months)')} hint={t('0: no term limit. Applies to new seats')}>
          <input
            className="input"
            inputMode="numeric"
            value={form.term}
            disabled={!editable}
            onChange={(e) => setForm({ ...form, term: e.target.value.replace(/\D/g, '') })}
          />
        </Field>
      </div>
      <ErrorAlert error={save.error} />
      {editable && (
        <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={save.isPending}>
          {t('Save rules')}
        </button>
      )}
    </form>
  );
}

function Council({ governance: g, canRenew }: { governance: Governance; canRenew: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const renew = useMutation({
    mutationFn: (userId: string) => api.admin.renewCouncilTerm(userId, g.councilTermMonths),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['governance'] });
      toast.success(
        g.councilTermMonths
          ? t('New term of {0} started', plural(g.councilTermMonths, 'month'))
          : t('Term limit removed'),
      );
    },
  });
  return (
    <div className="card pad-0 table-wrap" aria-label={t('Council members')}>
      <table className="table">
        <thead>
          <tr>
            <th>{t('Council member')}</th>
            <th>{t('Term ends')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {g.council.map((c) => (
            <tr key={c.user.id}>
              <td>
                <b>{c.user.displayName}</b> <span className="small muted">@{c.user.username}</span>
              </td>
              <td className="small">{c.termEndsAt ? formatDate(c.termEndsAt, false) : t('No term limit')}</td>
              <td className="right">
                {canRenew && (
                  <button
                    className="btn sm"
                    disabled={renew.isPending}
                    onClick={() => renew.mutate(c.user.id)}
                  >
                    {g.councilTermMonths ? t('Start a new term') : t('Remove the limit')}
                  </button>
                )}
              </td>
            </tr>
          ))}
          {!g.council.length && (
            <tr>
              <td colSpan={3} className="small muted">
                {t('Nobody is on the council yet.')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <ErrorAlert error={renew.error} />
    </div>
  );
}

function Reports() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const now = new Date();
  const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const firstOfLast = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const [form, setForm] = useState({
    from: dayInput(firstOfLast),
    to: dayInput(firstOfMonth),
    title: firstOfLast.toLocaleDateString(intlLocale(), { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    notes: '',
  });
  const range = { from: `${form.from}T00:00:00Z`, to: `${form.to}T00:00:00Z` };
  const preview = useQuery({
    queryKey: ['transparency', 'preview', range.from, range.to],
    queryFn: () => api.admin.transparencyPreview(range.from, range.to),
    enabled: form.from < form.to,
  });
  const reports = useQuery({ queryKey: ['transparency'], queryFn: api.governance.reports });
  const publish = useMutation({
    mutationFn: () =>
      api.admin.publishTransparency({
        title: form.title,
        periodStart: range.from,
        periodEnd: range.to,
        notes: form.notes,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transparency'] });
      toast.success(t('Report published'));
      setForm({ ...form, notes: '' });
    },
  });
  const retract = useMutation({
    mutationFn: api.admin.retractTransparency,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['transparency'] }),
  });
  const s = preview.data;
  return (
    <div className="grid-2">
      <form
        className="card stack"
        aria-label={t('New transparency report')}
        onSubmit={(e) => {
          e.preventDefault();
          publish.mutate();
        }}
      >
        <h3>{t('New transparency report')}</h3>
        <div className="grid-2" style={{ gap: 12 }}>
          <Field label={t('From')}>
            <input
              className="input"
              type="date"
              value={form.from}
              onChange={(e) => setForm({ ...form, from: e.target.value })}
            />
          </Field>
          <Field label={t('Until (not included)')}>
            <input
              className="input"
              type="date"
              value={form.to}
              onChange={(e) => setForm({ ...form, to: e.target.value })}
            />
          </Field>
        </div>
        <Field label={t('Title')}>
          <input
            className="input"
            value={form.title}
            required
            minLength={3}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </Field>
        <Field label={t('Notes (optional)')}>
          <textarea
            className="textarea"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </Field>
        <ErrorAlert error={preview.error ?? publish.error} />
        {s && (
          <dl className="dl small">
            <dt>{t('Applications')}</dt>
            <dd>
              {t(
                '{0} received · {1} approved · {2} not approved',
                s.applications.received,
                s.applications.approved,
                s.applications.rejected,
              )}
            </dd>
            <dt>{t('Council')}</dt>
            <dd>
              {t(
                '{0} ({1} for, {2} against)',
                plural(s.council.votes, 'vote'),
                s.council.approvals,
                s.council.rejections,
              )}
            </dd>
            <dt>{t('Moderation')}</dt>
            <dd>
              {t(
                '{0} suspended · {1} identities verified',
                s.moderation.accountsSuspended,
                s.moderation.identityApproved,
              )}
            </dd>
            <dt>{t('Registry')}</dt>
            <dd>{t('{0} added · {1} expired', s.registry.added, s.registry.expired)}</dd>
            <dt>{t('Economy')}</dt>
            <dd>
              {t(
                '{0} new accounts · {1} investments · {2} trades',
                s.economy.newAccounts,
                s.economy.investments,
                s.economy.trades,
              )}
            </dd>
          </dl>
        )}
        <button
          className="btn primary"
          style={{ alignSelf: 'flex-start' }}
          disabled={publish.isPending || !s}
        >
          {t('Publish report')}
        </button>
        <p className="tiny muted" style={{ margin: 0 }}>
          {t('The numbers are frozen when you publish; the report is public at /transparency.')}
        </p>
      </form>
      <div className="card stack">
        <h3>{t('Published')}</h3>
        {reports.data?.length === 0 && <p className="small muted">{t('No reports yet.')}</p>}
        {reports.data?.map((r) => (
          <div key={r.id} className="spread small">
            <span>
              <b>{r.title}</b>
              <span className="muted">
                {' '}
                · {formatDate(r.periodStart, false)} – {formatDate(r.periodEnd, false)}
              </span>
            </span>
            <button
              className="btn sm ghost danger-text"
              onClick={() => confirm(t('Take "{0}" down?', r.title)) && retract.mutate(r.id)}
            >
              {t('Retract')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
