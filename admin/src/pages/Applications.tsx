import { APPLICATION_STATUSES, APPLICATION_TYPES, WORKFLOWS, type Application } from '@ovl/shared';
import {
  ErrorAlert,
  Field,
  formatDate,
  humanize,
  Modal,
  PageHeader,
  PayloadView,
  AttachmentList,
  DecisionBadge,
  Spinner,
  StatusBadge,
  UserName,
  WorkflowStepper,
  t,
} from '@ovl/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { useAdmin } from '../auth';
import { Pager } from './common';

function ApplicationModal({ application, onClose }: { application: Application; onClose: () => void }) {
  const { me } = useAdmin();
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const stage =
    application.status === 'pending' ? WORKFLOWS[application.type].stages[application.stageIndex] : undefined;
  const review = useMutation({
    mutationFn: (decision: 'approve' | 'reject' | 'request_changes') =>
      api.applications.review(application.id, {
        decision,
        comment: comment || undefined,
        checklist: checked,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      onClose();
    },
  });
  const voted =
    stage &&
    application.reviews.some(
      (r) => r.stageKey === stage.key && r.round === application.round && r.reviewer.id === me.id,
    );
  const canAct =
    stage &&
    !voted &&
    application.applicant.id !== me.id &&
    (me.role === 'owner' || stage.approvers.some((g) => g.roles.includes(me.role)));
  const allChecked = !stage?.checklist || stage.checklist.every((c) => checked.includes(c.key));

  return (
    <Modal title={t(WORKFLOWS[application.type].label)} onClose={onClose} wide>
      <div className="stack">
        <div className="spread">
          <UserName user={application.applicant} showHandle />
          <StatusBadge status={application.status} />
        </div>
        <WorkflowStepper application={application} />
        <PayloadView payload={application.payload} />
        {application.attachments.length > 0 && (
          <div className="stack-sm">
            <div className="label">{t('Documents')}</div>
            <AttachmentList files={application.attachments} href={api.files.url} />
          </div>
        )}
        {application.result && (
          <div className="alert success small">
            {t('Result:')} <PayloadView payload={application.result} />
          </div>
        )}
        {application.rejectionReason && (
          <div className="alert error small">{t('Rejected: {0}', application.rejectionReason)}</div>
        )}
        {application.reviews.length > 0 && (
          <div className="stack-sm">
            <h3>{t('Decisions')}</h3>
            {application.reviews.map((r) => (
              <div key={r.id} className="small">
                <DecisionBadge decision={r.decision} /> {r.reviewer.displayName} ({r.reviewerRole}) ·{' '}
                {r.stageKey} · {formatDate(r.createdAt)}
                {r.comment && <div className="muted">“{r.comment}”</div>}
              </div>
            ))}
          </div>
        )}
        {stage && (
          <div className="card flat stack">
            <h3>{t('Stage: {0}', stage.label)}</h3>
            <p className="small muted">{t(stage.description)}</p>
            {voted && <div className="alert info">{t('You already voted at this stage.')}</div>}
            {canAct && (
              <>
                {stage.checklist?.map((item) => (
                  <label key={item.key} className="checkbox">
                    <input
                      type="checkbox"
                      checked={checked.includes(item.key)}
                      onChange={(e) =>
                        setChecked(
                          e.target.checked ? [...checked, item.key] : checked.filter((k) => k !== item.key),
                        )
                      }
                    />
                    {t(item.label)}
                  </label>
                ))}
                <Field label={t('Comment')} hint={t('Required when rejecting or asking for changes.')}>
                  <textarea
                    className="textarea"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                  />
                </Field>
                <ErrorAlert error={review.error} />
                <div className="row-wrap">
                  <button
                    className="btn success"
                    disabled={!allChecked || review.isPending}
                    onClick={() => review.mutate('approve')}
                  >
                    {t('Approve')}
                  </button>
                  <button
                    className="btn danger"
                    disabled={!comment.trim() || review.isPending}
                    onClick={() => review.mutate('reject')}
                  >
                    {t('Reject')}
                  </button>
                  <button
                    className="btn"
                    disabled={!comment.trim() || review.isPending}
                    onClick={() => review.mutate('request_changes')}
                  >
                    {t('Request changes')}
                  </button>
                </div>
              </>
            )}
            {!canAct && !voted && (
              <div className="alert warning small">{t('Your role does not act at this stage.')}</div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

export function ApplicationsPage() {
  const [status, setStatus] = useState<string>('pending');
  const [type, setType] = useState<string>('');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<Application | null>(null);
  const limit = 25;
  const apps = useQuery({
    queryKey: ['applications', status, type, offset],
    queryFn: () =>
      api.applications.list({ status: status || undefined, type: type || undefined, limit, offset }),
  });

  return (
    <div className="page">
      <PageHeader
        icon="review"
        title={t('Applications')}
        subtitle={t('Companies, licenses, staff and channel applications with their approval stages.')}
      />
      <div className="filters">
        <select
          className="select"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">{t('Any status')}</option>
          {APPLICATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {humanize(s)}
            </option>
          ))}
        </select>
        <select
          className="select"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">{t('Any type')}</option>
          {APPLICATION_TYPES.map((kind) => (
            <option key={kind} value={kind}>
              {t(WORKFLOWS[kind].label)}
            </option>
          ))}
        </select>
      </div>
      <ErrorAlert error={apps.error} />
      <div className="card pad-0 table-wrap">
        {apps.isLoading && <Spinner center />}
        <table className="table">
          <thead>
            <tr>
              <th>{t('Application')}</th>
              <th>{t('Applicant')}</th>
              <th>{t('Stage')}</th>
              <th>{t('Submitted')}</th>
              <th>{t('Status')}</th>
            </tr>
          </thead>
          <tbody>
            {apps.data?.items.map((a) => (
              <tr key={a.id} className="clickable" onClick={() => setOpen(a)}>
                <td>
                  <b>{String(a.payload.name ?? a.payload.title ?? WORKFLOWS[a.type].label)}</b>
                  <div className="small muted">{t(WORKFLOWS[a.type].label)}</div>
                </td>
                <td>@{a.applicant.username}</td>
                <td className="small">
                  {a.currentStage ? WORKFLOWS[a.type].stages[a.stageIndex]?.label : '—'}
                </td>
                <td className="small">{formatDate(a.createdAt)}</td>
                <td>
                  <StatusBadge status={a.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {apps.data && <Pager total={apps.data.total} limit={limit} offset={offset} onChange={setOffset} />}
      </div>
      {open && <ApplicationModal application={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
