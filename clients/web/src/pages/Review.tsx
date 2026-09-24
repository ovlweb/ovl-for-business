import { WORKFLOWS, type Application } from '@ovl/shared';
import {
  Avatar,
  Empty,
  ErrorAlert,
  Field,
  formatDate,
  PageHeader,
  PayloadView,
  Spinner,
  StatusBadge,
  Tabs,
  timeAgo,
  UserName,
  WorkflowStepper,
} from '@ovl/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth, useMe } from '../auth';

function ReviewPanel({ application }: { application: Application }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const stage =
    application.status === 'pending' ? WORKFLOWS[application.type].stages[application.stageIndex] : undefined;
  const [checked, setChecked] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const review = useMutation({
    mutationFn: (decision: 'approve' | 'reject') =>
      api.applications.review(application.id, {
        decision,
        comment: comment || undefined,
        checklist: checked,
      }),
    onSuccess: () => {
      setChecked([]);
      setComment('');
      queryClient.invalidateQueries({ queryKey: ['applications'] });
    },
  });
  const alreadyVoted =
    stage && application.reviews.some((r) => r.stageKey === stage.key && r.reviewer.id === me.id);
  const canAct =
    stage &&
    application.applicant.id !== me.id &&
    !alreadyVoted &&
    (stage.approvers.some((g) => g.roles.includes(me.role)) || me.role === 'owner');
  const allChecked = !stage?.checklist || stage.checklist.every((c) => checked.includes(c.key));

  return (
    <div className="stack-lg">
      <div className="card stack">
        <div className="spread">
          <div className="row">
            <Avatar
              name={application.applicant.displayName}
              url={application.applicant.avatarUrl}
              size={44}
            />
            <div>
              <Link to={`/u/${application.applicant.username}`}>
                <UserName user={application.applicant} showHandle />
              </Link>
              <div className="small muted">
                {WORKFLOWS[application.type].label} · submitted {formatDate(application.createdAt)}
              </div>
            </div>
          </div>
          <StatusBadge status={application.status} />
        </div>
        <WorkflowStepper application={application} />
        <PayloadView payload={application.payload} />
      </div>

      {application.reviews.length > 0 && (
        <div className="card stack-sm">
          <h3>Decisions so far</h3>
          {application.reviews.map((r) => (
            <div key={r.id} className="small">
              <span className={`badge ${r.decision === 'approve' ? 'ok' : 'bad'}`}>{r.decision}</span>{' '}
              <b>{r.reviewer.displayName}</b> ({r.reviewerRole}) at stage “{r.stageKey}” ·{' '}
              {timeAgo(r.createdAt)}
              {r.checklist && (
                <span className="muted"> · confirmed {r.checklist.length} checklist items</span>
              )}
              {r.comment && <div className="muted">“{r.comment}”</div>}
            </div>
          ))}
        </div>
      )}

      {stage && (
        <div className="card stack">
          <div>
            <h3>Current stage: {stage.label}</h3>
            <p className="small muted">{stage.description}</p>
          </div>
          {alreadyVoted && (
            <div className="alert info">You already voted at this stage — waiting for the others.</div>
          )}
          {!canAct && !alreadyVoted && (
            <div className="alert warning">
              Your role does not act at this stage (or this is your own application).
            </div>
          )}
          {canAct && (
            <>
              {stage.checklist && (
                <div className="stack-sm">
                  <div className="label">Confirm you reviewed every part of the file</div>
                  {stage.checklist.map((item) => (
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
                      {item.label}
                    </label>
                  ))}
                </div>
              )}
              <Field label="Comment" hint="Required when rejecting.">
                <textarea className="textarea" value={comment} onChange={(e) => setComment(e.target.value)} />
              </Field>
              <ErrorAlert error={review.error} />
              <div className="row-wrap">
                <button
                  className="btn success"
                  disabled={!allChecked || review.isPending}
                  onClick={() => review.mutate('approve')}
                >
                  Approve
                </button>
                <button
                  className="btn danger"
                  disabled={!comment.trim() || review.isPending}
                  onClick={() => review.mutate('reject')}
                >
                  Reject
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function ReviewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [tab, setTab] = useState<'queue' | 'pending' | 'done'>('queue');
  const queue = useQuery({ queryKey: ['applications', 'queue'], queryFn: api.applications.queue });
  const all = useQuery({
    queryKey: ['applications', 'list', tab],
    queryFn: () => api.applications.list({ status: tab === 'pending' ? 'pending' : undefined, limit: 50 }),
    enabled: tab !== 'queue' && can('applications.view_all'),
  });
  const detail = useQuery({
    queryKey: ['applications', id],
    queryFn: () => api.applications.get(id!),
    enabled: !!id,
  });
  const items = tab === 'queue' ? queue.data : all.data?.items;

  return (
    <div className="page stack-lg" style={{ maxWidth: 1200 }}>
      <PageHeader
        title="Review queue"
        subtitle="Moderation, council votes and final confirmations. Council cards also appear in the pinned council chat."
      />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(260px, 360px) 1fr',
          gap: 18,
          alignItems: 'start',
        }}
        className="review-grid"
      >
        <div className="card pad-0">
          <div style={{ padding: '6px 10px 0' }}>
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { value: 'queue', label: `For me (${queue.data?.length ?? 0})` },
                ...(can('applications.view_all')
                  ? [
                      { value: 'pending' as const, label: 'All pending' },
                      { value: 'done' as const, label: 'All' },
                    ]
                  : []),
              ]}
            />
          </div>
          {(queue.isLoading || all.isLoading) && <Spinner center />}
          <div className="list">
            {items?.map((a) => (
              <button
                key={a.id}
                className={`list-item${a.id === id ? ' active' : ''}`}
                onClick={() => navigate(`/review/${a.id}`)}
              >
                <div className="grow">
                  <div className="bold ellipsis">
                    {String(a.payload.name ?? a.payload.title ?? WORKFLOWS[a.type].label)}
                  </div>
                  <div className="small muted">
                    {WORKFLOWS[a.type].label} · @{a.applicant.username} · {timeAgo(a.createdAt)}
                  </div>
                </div>
                <StatusBadge status={a.status} />
              </button>
            ))}
          </div>
          {items?.length === 0 && <Empty title="Nothing waiting for you" />}
        </div>
        <div>
          {!id && (
            <div className="card">
              <Empty title="Select an application">Pick an item on the left to review it.</Empty>
            </div>
          )}
          {id && detail.isLoading && <Spinner center />}
          {id && <ErrorAlert error={detail.error} />}
          {detail.data && (
            <ReviewPanel key={detail.data.id + detail.data.stageIndex} application={detail.data} />
          )}
        </div>
      </div>
      <style>{`@media (max-width: 860px) { .review-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
