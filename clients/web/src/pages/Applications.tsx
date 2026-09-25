import {
  CURRENCIES,
  LICENSE_TYPE_LABELS,
  LICENSE_TYPES,
  WORKFLOWS,
  type Application,
  type ApplicationType,
  type CreateApplicationInput,
  type FileInfo,
  type SecurityPolicy,
} from '@ovl/shared';
import {
  AttachmentList,
  AttachmentPicker,
  DecisionBadge,
  Empty,
  ErrorAlert,
  Field,
  formatDate,
  Icon,
  Modal,
  PageHeader,
  PayloadView,
  Spinner,
  StatusBadge,
  WorkflowStepper,
} from '@ovl/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useMe } from '../auth';

type Values = Record<string, string | boolean>;

function useForm(initial: Values) {
  const [values, setValues] = useState<Values>(initial);
  const bind = (key: string) => ({
    value: String(values[key] ?? ''),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setValues((v) => ({ ...v, [key]: e.target.value })),
  });
  return { values, setValues, bind };
}

const opt = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

function buildInput(type: ApplicationType, v: Values): CreateApplicationInput {
  switch (type) {
    case 'company':
      return {
        type,
        payload: {
          name: String(v.name),
          description: String(v.description),
          website: opt(v.website),
          country: opt(v.country),
          baseCurrency: String(v.baseCurrency),
          businessPlan: String(v.businessPlan),
          contactEmail: opt(v.contactEmail),
          listOnExchange: !!v.listOnExchange,
          listing: v.listOnExchange
            ? {
                ticker: String(v.ticker),
                sharePrice: String(v.sharePrice),
                totalShares: Number(v.totalShares),
              }
            : undefined,
        },
      };
    case 'license':
      return {
        type,
        payload: {
          licenseType: v.licenseType as Exclude<(typeof LICENSE_TYPES)[number], 'business'>,
          title: String(v.title),
          description: String(v.description),
          website: opt(v.website),
          organizationId: opt(v.organizationId),
          details: opt(v.details),
        },
      };
    case 'moderator':
    case 'council':
      return { type, payload: { motivation: String(v.motivation), experience: opt(v.experience) } };
    case 'news_channel':
      return {
        type,
        payload: { title: String(v.title), handle: String(v.handle), description: String(v.description) },
      };
  }
}

/** Form values from a submitted payload (to edit an application after "request changes"). */
function valuesFromPayload(payload: Record<string, unknown>): Values {
  const values: Values = {};
  for (const [k, v] of Object.entries(payload)) {
    if (k === 'listing' && v && typeof v === 'object') {
      for (const [lk, lv] of Object.entries(v)) values[lk] = String(lv);
    } else if (typeof v === 'boolean') values[k] = v;
    else if (v !== undefined && v !== null) values[k] = String(v);
  }
  return values;
}

function NewApplicationModal({
  type,
  onClose,
  resubmit,
}: {
  type: ApplicationType;
  onClose: () => void;
  /** Edit this application and send it again (after a reviewer asked for changes). */
  resubmit?: Application;
}) {
  const queryClient = useQueryClient();
  const orgs = useQuery({
    queryKey: ['orgs', 'mine'],
    queryFn: api.organizations.mine,
    enabled: type === 'license',
  });
  const me = useMe();
  const meta = useQuery({
    queryKey: ['meta'],
    queryFn: api.meta,
    enabled: type === 'company',
    staleTime: Infinity,
  });
  const identityRequired = (meta.data?.security as SecurityPolicy | undefined)?.identityForCompanies;
  const { values, setValues, bind } = useForm(
    resubmit
      ? valuesFromPayload(resubmit.payload)
      : {
          baseCurrency: 'USD',
          licenseType: 'project',
          listOnExchange: false,
          totalShares: '1000000',
          sharePrice: '1.00',
        },
  );
  const [files, setFiles] = useState<FileInfo[]>([]);
  const submit = useMutation({
    mutationFn: () => {
      const attachments = files.map((f) => f.id);
      const input = buildInput(type, values);
      return resubmit
        ? api.applications.resubmit(resubmit.id, input.payload as Record<string, unknown>, attachments)
        : api.applications.submit({ ...input, attachments });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      onClose();
    },
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit.mutate();
  };
  const workflow = WORKFLOWS[type];
  const stock = (meta.data as { stock?: { freezePercent: number; lockDays: number } } | undefined)?.stock;

  let fields: ReactNode;
  if (type === 'company') {
    fields = (
      <>
        <Field label="Company name">
          <input className="input" {...bind('name')} required maxLength={120} />
        </Field>
        <Field label="Description">
          <textarea className="textarea" {...bind('description')} required minLength={10} />
        </Field>
        <div className="grid-2">
          <Field label="Website (optional)">
            <input className="input" type="url" {...bind('website')} />
          </Field>
          <Field label="Country / virtual country (optional)">
            <input className="input" {...bind('country')} />
          </Field>
          <Field label="Base currency">
            <select className="select" {...bind('baseCurrency')}>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Contact email (optional)">
            <input className="input" type="email" {...bind('contactEmail')} />
          </Field>
        </div>
        <Field label="Business plan" hint="What the company does and how it earns money.">
          <textarea
            className="textarea"
            {...bind('businessPlan')}
            required
            minLength={10}
            style={{ minHeight: 120 }}
          />
        </Field>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={!!values.listOnExchange}
            onChange={(e) => setValues({ ...values, listOnExchange: e.target.checked })}
          />
          <span>
            List the company on the stock exchange so anyone can invest.
            {stock && (
              <span className="muted small">
                {' '}
                {stock.freezePercent}% of every investment stays frozen on your balance for {stock.lockDays}{' '}
                days.
              </span>
            )}
          </span>
        </label>
        {values.listOnExchange && (
          <div className="grid-3">
            <Field label="Ticker">
              <input
                className="input"
                {...bind('ticker')}
                required
                pattern="[A-Za-z][A-Za-z0-9]{1,5}"
                placeholder="ACME"
              />
            </Field>
            <Field label={`Share price (${values.baseCurrency})`}>
              <input className="input" inputMode="decimal" {...bind('sharePrice')} required />
            </Field>
            <Field label="Total shares">
              <input className="input" type="number" min={1} {...bind('totalShares')} required />
            </Field>
          </div>
        )}
      </>
    );
  } else if (type === 'license') {
    const eligible = orgs.data?.filter((o) => o.myRole === 'owner' || o.myRole === 'director') ?? [];
    fields = (
      <>
        <Field label="License type" hint="Licenses cover virtual things only.">
          <select className="select" {...bind('licenseType')}>
            {LICENSE_TYPES.filter((t) => t !== 'business').map((t) => (
              <option key={t} value={t}>
                {LICENSE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Title">
          <input className="input" {...bind('title')} required maxLength={200} />
        </Field>
        <Field label="Description">
          <textarea className="textarea" {...bind('description')} required minLength={10} />
        </Field>
        <Field label="Website (optional)">
          <input className="input" type="url" {...bind('website')} />
        </Field>
        {eligible.length > 0 && (
          <Field label="Holder">
            <select className="select" {...bind('organizationId')}>
              <option value="">Me personally</option>
              {eligible.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Additional details (optional)">
          <textarea className="textarea" {...bind('details')} />
        </Field>
      </>
    );
  } else if (type === 'news_channel') {
    fields = (
      <>
        <Field label="Channel title">
          <input className="input" {...bind('title')} required maxLength={128} />
        </Field>
        <Field label="Handle" hint="Public address, e.g. market_news">
          <input className="input" {...bind('handle')} required pattern="[A-Za-z][A-Za-z0-9_]{3,31}" />
        </Field>
        <Field label="Description">
          <textarea className="textarea" {...bind('description')} required minLength={10} />
        </Field>
      </>
    );
  } else {
    fields = (
      <>
        <Field label="Why do you want to join?" hint="At least 20 characters.">
          <textarea className="textarea" {...bind('motivation')} required minLength={20} />
        </Field>
        <Field label="Relevant experience (optional)">
          <textarea className="textarea" {...bind('experience')} />
        </Field>
      </>
    );
  }

  return (
    <Modal title={resubmit ? `Edit: ${workflow.label}` : workflow.label} onClose={onClose} wide>
      <form className="stack" onSubmit={onSubmit}>
        {type === 'company' && identityRequired && !me.identityVerified && (
          <div className="alert warning small">
            <Icon name="shield" size={16} />
            <span className="grow">
              Company owners pass an identity check before approval. You can apply now; reviewers approve once
              your identity is verified.
            </span>
            <Link className="btn sm" to="/settings?section=identity" onClick={onClose}>
              Verify identity
            </Link>
          </div>
        )}
        {resubmit?.changesRequested ? (
          <div className="alert warning small">
            <Icon name="info" size={16} />
            <span>
              <b>Requested changes:</b> {resubmit.changesRequested}
            </span>
          </div>
        ) : (
          <p className="small muted">{workflow.description}</p>
        )}
        <WorkflowStepper application={resubmit ?? { type, status: 'pending', stageIndex: -1 }} />
        {fields}
        <Field label="Documents (optional)" hint="Business license, plans, IDs… Images, PDF or office files.">
          <div className="stack-sm">
            {resubmit && <AttachmentList files={resubmit.attachments} href={api.files.url} />}
            <AttachmentPicker
              value={files}
              onChange={setFiles}
              upload={(file) => api.files.upload(file, file.name)}
              remove={(file) => api.files.remove(file.id)}
              href={api.files.url}
              max={10 - (resubmit?.attachments.length ?? 0)}
            />
          </div>
        </Field>
        <ErrorAlert error={submit.error} />
        <button className="btn primary" disabled={submit.isPending}>
          {resubmit ? 'Send the changes' : 'Submit application'}
        </button>
      </form>
    </Modal>
  );
}

function ResultLinks({ application }: { application: Application }) {
  const r = application.result ?? {};
  return (
    <div className="row-wrap small">
      {typeof r.organizationSlug === 'string' && (
        <Link to={`/companies/${r.organizationSlug}`}>Open company</Link>
      )}
      {typeof r.ticker === 'string' && r.ticker && (
        <Link to={`/exchange/${r.ticker}`}>{r.ticker} on the exchange</Link>
      )}
      {typeof r.registryNumber === 'string' && <code>{r.registryNumber}</code>}
      {typeof r.licenseNumber === 'string' && <code>{r.licenseNumber}</code>}
      {typeof r.chatId === 'string' && <Link to={`/chats/${r.chatId}`}>Open channel</Link>}
    </div>
  );
}

const NEW_TYPES: { type: ApplicationType; title: string; text: string; staff?: boolean }[] = [
  {
    type: 'company',
    title: 'Company / business account',
    text: 'Register a company with its business license and optional stock listing.',
  },
  {
    type: 'license',
    title: 'License',
    text: 'Projects, fan-projects, TV & radio channels, websites, virtual countries…',
  },
  { type: 'news_channel', title: 'News channel', text: 'Channels are created through moderation.' },
  {
    type: 'moderator',
    title: 'Join the moderation team',
    text: 'Review applications and answer tech support.',
    staff: true,
  },
  {
    type: 'council',
    title: 'Join the council',
    text: 'Vote on companies, licenses and new members.',
    staff: true,
  },
];

export function ApplicationsPage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const creating = params.get('new') as ApplicationType | null;
  const [open, setOpen] = useState<Application | null>(null);
  const [editing, setEditing] = useState<Application | null>(null);
  const mine = useQuery({ queryKey: ['applications', 'mine'], queryFn: api.applications.mine });
  const withdraw = useMutation({
    mutationFn: api.applications.withdraw,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      setOpen(null);
    },
  });

  return (
    <div className="page stack-lg">
      <PageHeader
        icon="file"
        title="Applications"
        subtitle="Register companies and licenses or join the moderation team or the council. Every application goes through moderation and confirmations."
      />
      <div className="grid-3">
        {NEW_TYPES.filter(
          (t) => !t.staff || me.role === 'user' || (t.type === 'council' && me.role === 'moderator'),
        ).map((t) => (
          <button
            key={t.type}
            className="card stack-sm"
            style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' }}
            onClick={() => setParams({ new: t.type })}
          >
            <h3>{t.title}</h3>
            <span className="small muted">{t.text}</span>
            <span className="small bold" style={{ color: 'var(--accent)' }}>
              Apply →
            </span>
          </button>
        ))}
      </div>

      <div className="stack">
        <h2>Your applications</h2>
        {mine.isLoading && <Spinner center />}
        <ErrorAlert error={mine.error} />
        {mine.data?.length === 0 && (
          <div className="card">
            <Empty title="You have not submitted anything yet" />
          </div>
        )}
        {mine.data?.map((a) => (
          <div key={a.id} className="card stack-sm" onClick={() => setOpen(a)} style={{ cursor: 'pointer' }}>
            <div className="spread">
              <div className="row-wrap">
                <h3>{WORKFLOWS[a.type].label}</h3>
                <span className="muted small">{String(a.payload.name ?? a.payload.title ?? '')}</span>
              </div>
              <StatusBadge status={a.status} />
            </div>
            <WorkflowStepper application={a} />
            {a.status === 'rejected' && a.rejectionReason && (
              <div className="alert error small">Rejected: {a.rejectionReason}</div>
            )}
            {a.status === 'changes_requested' && (
              <div className="alert warning small">
                <Icon name="info" size={16} />
                <span className="grow">Changes requested: {a.changesRequested}</span>
                <button
                  className="btn sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(a);
                  }}
                >
                  Edit and resubmit
                </button>
              </div>
            )}
            {a.status === 'approved' && <ResultLinks application={a} />}
            <span className="tiny muted">Submitted {formatDate(a.createdAt)}</span>
          </div>
        ))}
      </div>

      {creating && WORKFLOWS[creating] && (
        <NewApplicationModal type={creating} onClose={() => setParams({})} />
      )}
      {editing && (
        <NewApplicationModal type={editing.type} resubmit={editing} onClose={() => setEditing(null)} />
      )}
      {open && (
        <Modal title={WORKFLOWS[open.type].label} onClose={() => setOpen(null)} wide>
          <div className="stack">
            <WorkflowStepper application={open} />
            <PayloadView payload={open.payload} />
            {open.attachments.length > 0 && (
              <div className="stack-sm">
                <h3>Documents</h3>
                <AttachmentList files={open.attachments} href={api.files.url} />
              </div>
            )}
            {open.reviews.length > 0 && (
              <div className="stack-sm">
                <h3>Decisions</h3>
                {open.reviews.map((r) => (
                  <div key={r.id} className="small">
                    <DecisionBadge decision={r.decision} /> {r.reviewer.displayName} ({r.reviewerRole}) ·{' '}
                    {r.stageKey} · {formatDate(r.createdAt)}
                    {r.comment && <div className="muted">“{r.comment}”</div>}
                  </div>
                ))}
              </div>
            )}
            <ErrorAlert error={withdraw.error} />
            {open.status === 'changes_requested' && (
              <button
                className="btn primary"
                onClick={() => {
                  setEditing(open);
                  setOpen(null);
                }}
              >
                Edit and resubmit
              </button>
            )}
            {(open.status === 'pending' || open.status === 'changes_requested') && (
              <button className="btn danger" onClick={() => withdraw.mutate(open.id)}>
                Withdraw application
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
