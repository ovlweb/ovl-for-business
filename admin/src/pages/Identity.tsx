import type { IdentityCheck } from '@ovl/shared';
import {
  AttachmentList,
  Empty,
  ErrorAlert,
  Field,
  formatDate,
  Icon,
  Modal,
  PageHeader,
  Segmented,
  SkeletonList,
  StatusBadge,
  timeAgo,
  useToast,
  humanize,
  t,
  msg,
} from '@ovl/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { useAdmin } from '../auth';

const DOCUMENTS: Record<IdentityCheck['documentType'], string> = {
  passport: 'Passport',
  id_card: msg('National ID card'),
  driver_license: msg('Driving licence'),
  residence_permit: msg('Residence permit'),
};

type Filter = 'pending' | 'approved' | 'all';

function age(dateOfBirth: string): number {
  const born = new Date(`${dateOfBirth}T00:00:00Z`);
  const now = new Date();
  let years = now.getUTCFullYear() - born.getUTCFullYear();
  if (now < new Date(Date.UTC(now.getUTCFullYear(), born.getUTCMonth(), born.getUTCDate()))) years -= 1;
  return years;
}

function ReasonModal({
  check,
  action,
  onClose,
}: {
  check: IdentityCheck;
  action: 'reject' | 'revoke';
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const decide = useMutation({
    mutationFn: () => api.admin.decideIdentity(check.id, action, reason),
    onSuccess: () => {
      for (const k of ['identity', 'stats']) void queryClient.invalidateQueries({ queryKey: [k] });
      toast.success(action === 'reject' ? t('Check rejected') : t('Verification revoked'));
      onClose();
    },
  });
  return (
    <Modal
      title={action === 'reject' ? t('Reject {0}', check.legalName) : t('Revoke {0}', check.legalName)}
      onClose={onClose}
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          decide.mutate();
        }}
      >
        <p className="small muted" style={{ margin: 0 }}>
          {action === 'reject'
            ? t('The person is told the reason and can send a new check.')
            : t('The person and the companies they own lose the verified badge.')}
        </p>
        <Field label={t('Reason')} hint={t('Shown to the person.')}>
          <textarea
            className="textarea"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            minLength={3}
            maxLength={500}
            autoFocus
            required
          />
        </Field>
        <ErrorAlert error={decide.error} />
        <button className="btn danger" disabled={decide.isPending}>
          {action === 'reject' ? t('Reject') : t('Revoke verification')}
        </button>
      </form>
    </Modal>
  );
}

export function IdentityPage() {
  const { me } = useAdmin();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>('pending');
  const [asking, setAsking] = useState<{ check: IdentityCheck; action: 'reject' | 'revoke' } | null>(null);
  const checks = useQuery({
    queryKey: ['identity', filter],
    queryFn: () => api.admin.identityChecks(filter === 'all' ? undefined : filter),
    refetchInterval: 30_000,
  });
  const approve = useMutation({
    mutationFn: (id: string) => api.admin.decideIdentity(id, 'approve'),
    onSuccess: (c) => {
      for (const k of ['identity', 'stats']) void queryClient.invalidateQueries({ queryKey: [k] });
      toast.success(t('{0} is verified', c.legalName));
    },
  });
  return (
    <div className="page stack-lg">
      <PageHeader
        icon="shield"
        title={t('Identity checks')}
        subtitle={t(
          "Compare each person's details with their document photo. Company owners need this before approval; approved owners' companies show “Verified business”.",
        )}
        actions={
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'pending', label: t('Waiting') },
              { value: 'approved', label: t('Verified') },
              { value: 'all', label: t('All') },
            ]}
          />
        }
      />
      <ErrorAlert error={checks.error ?? approve.error} />
      {checks.isLoading && <SkeletonList rows={3} />}
      {checks.data?.length === 0 && (
        <div className="card">
          <Empty title={filter === 'pending' ? t('Nothing is waiting') : t('No checks')} />
        </div>
      )}
      {checks.data?.map((c) => (
        <div key={c.id} className="card stack identity-check">
          <div className="spread" style={{ alignItems: 'flex-start' }}>
            <div>
              <div className="row" style={{ gap: 8 }}>
                <h3>{c.legalName}</h3>
                <StatusBadge status={c.status === 'approved' ? 'verified' : c.status} />
                {c.duplicate && (
                  <span className="badge bad">
                    <Icon name="info" size={12} /> {t('Document used by another verified account')}
                  </span>
                )}
              </div>
              <div className="small muted">
                @{c.user.username} {t('· sent')} {timeAgo(c.createdAt)}
                {c.reviewedBy &&
                  ` ${t('· {0} by @{1}', humanize(c.status).toLowerCase(), c.reviewedBy.username)}`}
              </div>
            </div>
          </div>
          <dl className="dl">
            <dt>{t('Date of birth')}</dt>
            <dd>
              {t('{0} ({1} years)', formatDate(`${c.dateOfBirth}T12:00:00`, false), age(c.dateOfBirth))}
            </dd>
            <dt>{t('Country')}</dt>
            <dd>{c.country}</dd>
            <dt>{t('Document')}</dt>
            <dd>
              {t('{0} ending in', t(DOCUMENTS[c.documentType]))} <code>{c.documentLast4}</code>
            </dd>
            {c.rejectionReason && (
              <>
                <dt>{t('Reason')}</dt>
                <dd>{c.rejectionReason}</dd>
              </>
            )}
          </dl>
          <AttachmentList files={c.files} href={api.files.url} />
          <div className="row-wrap">
            {c.status === 'pending' && (
              <>
                <button
                  className="btn success"
                  disabled={approve.isPending || c.user.id === me.id}
                  title={c.user.id === me.id ? t('Another reviewer must check your own identity') : undefined}
                  onClick={() => approve.mutate(c.id)}
                >
                  <Icon name="check" size={15} /> {t('Verify')}
                </button>
                <button
                  className="btn ghost"
                  disabled={c.user.id === me.id}
                  onClick={() => setAsking({ check: c, action: 'reject' })}
                >
                  {t('Reject')}
                </button>
              </>
            )}
            {c.status === 'approved' && (
              <button className="btn ghost" onClick={() => setAsking({ check: c, action: 'revoke' })}>
                {t('Revoke verification')}
              </button>
            )}
          </div>
        </div>
      ))}
      {asking && <ReasonModal {...asking} onClose={() => setAsking(null)} />}
    </div>
  );
}
