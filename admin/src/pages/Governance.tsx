import { COUNCIL_VOTING, COUNCIL_VOTING_LABELS, type CouncilVoting, type Governance } from '@ovl/shared';
import { ErrorAlert, Field, formatDate, PageHeader, plural, Spinner, useToast } from '@ovl/ui';
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
        title="Governance"
        subtitle="How the council decides, how long seats last, and the transparency reports the platform publishes."
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
      toast.success('Governance rules saved');
    },
  });
  return (
    <form
      className="card stack"
      aria-label="Council rules"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div>
        <h3>Council rules</h3>
        <p className="small muted" style={{ margin: 0 }}>
          Right now a council stage needs {plural(g.votesNeeded, 'vote')} of{' '}
          {plural(g.activeCouncilMembers, 'active member')}.
          {!editable && ' Only the owner changes these rules.'}
        </p>
      </div>
      <div className="grid-3">
        <Field label="A council stage passes with">
          <select
            className="input"
            value={form.voting}
            disabled={!editable}
            onChange={(e) => setForm({ ...form, voting: e.target.value as CouncilVoting })}
          >
            {COUNCIL_VOTING.map((v) => (
              <option key={v} value={v}>
                {COUNCIL_VOTING_LABELS[v]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Quorum (votes)" hint="Used in quorum mode; never more than the council has">
          <input
            className="input"
            inputMode="numeric"
            value={form.quorum}
            disabled={!editable || form.voting !== 'quorum'}
            onChange={(e) => setForm({ ...form, quorum: e.target.value.replace(/\D/g, '') })}
          />
        </Field>
        <Field label="Council term (months)" hint="0: no term limit. Applies to new seats">
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
          Save rules
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
          ? `New term of ${plural(g.councilTermMonths, 'month')} started`
          : 'Term limit removed',
      );
    },
  });
  return (
    <div className="card pad-0 table-wrap" aria-label="Council members">
      <table className="table">
        <thead>
          <tr>
            <th>Council member</th>
            <th>Term ends</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {g.council.map((c) => (
            <tr key={c.user.id}>
              <td>
                <b>{c.user.displayName}</b> <span className="small muted">@{c.user.username}</span>
              </td>
              <td className="small">{c.termEndsAt ? formatDate(c.termEndsAt, false) : 'No term limit'}</td>
              <td className="right">
                {canRenew && (
                  <button
                    className="btn sm"
                    disabled={renew.isPending}
                    onClick={() => renew.mutate(c.user.id)}
                  >
                    {g.councilTermMonths ? 'Start a new term' : 'Remove the limit'}
                  </button>
                )}
              </td>
            </tr>
          ))}
          {!g.council.length && (
            <tr>
              <td colSpan={3} className="small muted">
                Nobody is on the council yet.
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
    title: firstOfLast.toLocaleDateString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
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
      toast.success('Report published');
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
        aria-label="New transparency report"
        onSubmit={(e) => {
          e.preventDefault();
          publish.mutate();
        }}
      >
        <h3>New transparency report</h3>
        <div className="grid-2" style={{ gap: 12 }}>
          <Field label="From">
            <input
              className="input"
              type="date"
              value={form.from}
              onChange={(e) => setForm({ ...form, from: e.target.value })}
            />
          </Field>
          <Field label="Until (not included)">
            <input
              className="input"
              type="date"
              value={form.to}
              onChange={(e) => setForm({ ...form, to: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Title">
          <input
            className="input"
            value={form.title}
            required
            minLength={3}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </Field>
        <Field label="Notes (optional)">
          <textarea
            className="textarea"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </Field>
        <ErrorAlert error={preview.error ?? publish.error} />
        {s && (
          <dl className="dl small">
            <dt>Applications</dt>
            <dd>
              {s.applications.received} received · {s.applications.approved} approved ·{' '}
              {s.applications.rejected} not approved
            </dd>
            <dt>Council</dt>
            <dd>
              {plural(s.council.votes, 'vote')} ({s.council.approvals} for, {s.council.rejections} against)
            </dd>
            <dt>Moderation</dt>
            <dd>
              {s.moderation.accountsSuspended} suspended · {s.moderation.identityApproved} identities verified
            </dd>
            <dt>Registry</dt>
            <dd>
              {s.registry.added} added · {s.registry.expired} expired
            </dd>
            <dt>Economy</dt>
            <dd>
              {s.economy.newAccounts} new accounts · {s.economy.investments} investments · {s.economy.trades}{' '}
              trades
            </dd>
          </dl>
        )}
        <button
          className="btn primary"
          style={{ alignSelf: 'flex-start' }}
          disabled={publish.isPending || !s}
        >
          Publish report
        </button>
        <p className="tiny muted" style={{ margin: 0 }}>
          The numbers are frozen when you publish; the report is public at /transparency.
        </p>
      </form>
      <div className="card stack">
        <h3>Published</h3>
        {reports.data?.length === 0 && <p className="small muted">No reports yet.</p>}
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
              onClick={() => confirm(`Take "${r.title}" down?`) && retract.mutate(r.id)}
            >
              Retract
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
