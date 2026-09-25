import {
  canRenew,
  CURRENCIES,
  registerCurrencies,
  LICENSE_TYPE_LABELS,
  LICENSE_TYPES,
  WORKFLOWS,
  type Application,
  type ApplicationType,
  type CreateApplicationInput,
  type FileInfo,
  type MyLicence,
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
  formatMoney,
  Icon,
  Modal,
  PageHeader,
  PayloadView,
  Spinner,
  StatusBadge,
  useToast,
  WorkflowStepper,
  t,
  msg,
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
    case 'renewal':
      return { type, payload: { registryEntryId: String(v.registryEntryId), note: opt(v.note) } };
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
  licence,
}: {
  type: ApplicationType;
  onClose: () => void;
  /** Edit this application and send it again (after a reviewer asked for changes). */
  resubmit?: Application;
  /** The licence to renew (type "renewal"). */
  licence?: MyLicence;
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
          registryEntryId: licence?.id ?? '',
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
      queryClient.invalidateQueries({ queryKey: ['licences'] });
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
        <Field label={t('Company name')}>
          <input className="input" {...bind('name')} required maxLength={120} />
        </Field>
        <Field label={t('Description')}>
          <textarea className="textarea" {...bind('description')} required minLength={10} />
        </Field>
        <div className="grid-2">
          <Field label={t('Website (optional)')}>
            <input className="input" type="url" {...bind('website')} />
          </Field>
          <Field label={t('Country / virtual country (optional)')}>
            <input className="input" {...bind('country')} />
          </Field>
          <Field label={t('Base currency')}>
            <select className="select" {...bind('baseCurrency')}>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('Contact email (optional)')}>
            <input className="input" type="email" {...bind('contactEmail')} />
          </Field>
        </div>
        <Field label={t('Business plan')} hint={t('What the company does and how it earns money.')}>
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
            {t('List the company on the stock exchange so anyone can invest.')}
            {stock && (
              <span className="muted small">
                {t(
                  '{0}% of every investment stays frozen on your balance for {1} days.',
                  stock.freezePercent,
                  stock.lockDays,
                )}
              </span>
            )}
          </span>
        </label>
        {values.listOnExchange && (
          <div className="grid-3">
            <Field label={t('Ticker')}>
              <input
                className="input"
                {...bind('ticker')}
                required
                pattern="[A-Za-z][A-Za-z0-9]{1,5}"
                placeholder={t('ACME')}
              />
            </Field>
            <Field label={t('Share price ({0})', String(values.baseCurrency ?? ''))}>
              <input className="input" inputMode="decimal" {...bind('sharePrice')} required />
            </Field>
            <Field label={t('Total shares')}>
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
        <Field label={t('License type')} hint={t('Licenses cover virtual things only.')}>
          <select className="select" {...bind('licenseType')}>
            {LICENSE_TYPES.filter((t) => t !== 'business').map((kind) => (
              <option key={kind} value={kind}>
                {t(LICENSE_TYPE_LABELS[kind])}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Title')}>
          <input className="input" {...bind('title')} required maxLength={200} />
        </Field>
        <Field label={t('Description')}>
          <textarea className="textarea" {...bind('description')} required minLength={10} />
        </Field>
        <Field label={t('Website (optional)')}>
          <input className="input" type="url" {...bind('website')} />
        </Field>
        {eligible.length > 0 && (
          <Field label={t('Holder')}>
            <select className="select" {...bind('organizationId')}>
              <option value="">{t('Me personally')}</option>
              {eligible.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t('Additional details (optional)')}>
          <textarea className="textarea" {...bind('details')} />
        </Field>
      </>
    );
  } else if (type === 'news_channel') {
    fields = (
      <>
        <Field label={t('Channel title')}>
          <input className="input" {...bind('title')} required maxLength={128} />
        </Field>
        <Field label={t('Handle')} hint={t('Public address, e.g. market_news')}>
          <input className="input" {...bind('handle')} required pattern="[A-Za-z][A-Za-z0-9_]{3,31}" />
        </Field>
        <Field label={t('Description')}>
          <textarea className="textarea" {...bind('description')} required minLength={10} />
        </Field>
      </>
    );
  } else if (type === 'renewal') {
    const title = licence?.title ?? String(resubmit?.payload.title ?? '');
    const number = licence?.number ?? String(resubmit?.payload.registryNumber ?? '');
    fields = (
      <>
        <div className="card flat stack-sm">
          <b>{title}</b>
          <span className="small muted">
            <code>{number}</code>
            {licence?.expiresAt &&
              ` · ${licence.status === 'expired' ? 'expired' : 'expires'} ${formatDate(licence.expiresAt, false)}`}
          </span>
        </div>
        <Field
          label={t('Note for the moderator (optional)')}
          hint={t('What changed since the last term, links to recent activity…')}
        >
          <textarea className="textarea" {...bind('note')} maxLength={2000} />
        </Field>
      </>
    );
  } else {
    fields = (
      <>
        <Field label={t('Why do you want to join?')} hint={t('At least 20 characters.')}>
          <textarea className="textarea" {...bind('motivation')} required minLength={20} />
        </Field>
        <Field label={t('Relevant experience (optional)')}>
          <textarea className="textarea" {...bind('experience')} />
        </Field>
      </>
    );
  }

  return (
    <Modal title={resubmit ? t('Edit: {0}', t(workflow.label)) : t(workflow.label)} onClose={onClose} wide>
      <form className="stack" onSubmit={onSubmit}>
        {type === 'company' && identityRequired && !me.identityVerified && (
          <div className="alert warning small">
            <Icon name="shield" size={16} />
            <span className="grow">
              {t(
                'Company owners pass an identity check before approval. You can apply now; reviewers approve once your identity is verified.',
              )}
            </span>
            <Link className="btn sm" to="/settings?section=identity" onClick={onClose}>
              {t('Verify identity')}
            </Link>
          </div>
        )}
        {resubmit?.changesRequested ? (
          <div className="alert warning small">
            <Icon name="info" size={16} />
            <span>
              <b>{t('Requested changes:')}</b> {resubmit.changesRequested}
            </span>
          </div>
        ) : (
          <p className="small muted">{t(workflow.description)}</p>
        )}
        <WorkflowStepper application={resubmit ?? { type, status: 'pending', stageIndex: -1 }} />
        {fields}
        <Field
          label={t('Documents (optional)')}
          hint={t('Business license, plans, IDs… Images, PDF or office files.')}
        >
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
          {resubmit
            ? t('Send the changes')
            : type === 'renewal'
              ? t('Ask for a renewal')
              : t('Submit application')}
        </button>
      </form>
    </Modal>
  );
}

const DAY = 86_400_000;

/** Create a virtual country's currency, then issue and redeem it. */
function CurrencyModal({ licence, onClose }: { licence: MyLicence; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const code = licence.currency;
  const info = useQuery({
    queryKey: ['virtualCurrency', code],
    queryFn: () => api.virtualCurrencies.get(code!),
    enabled: !!code,
  });
  const [form, setForm] = useState({ code: '', name: '', decimals: '2' });
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api.virtualCurrencies.create(licence.id, {
        code: form.code,
        name: form.name,
        decimals: Number(form.decimals),
      }),
    onSuccess: (c) => {
      registerCurrencies([{ code: c.code, name: c.name, decimals: c.decimals, virtual: true }]);
      for (const key of ['licences', 'wallets', 'virtualCurrency'])
        queryClient.invalidateQueries({ queryKey: [key] });
      toast.success(t('{0} is ready: issue some to put it into circulation', c.code));
    },
  });
  const change = useMutation({
    mutationFn: (action: 'issue' | 'redeem') =>
      action === 'issue'
        ? api.virtualCurrencies.issue(code!, amount, note || undefined)
        : api.virtualCurrencies.redeem(code!, amount, note || undefined),
    onSuccess: (c, action) => {
      queryClient.setQueryData(['virtualCurrency', code], c);
      for (const key of ['wallets', 'orgWallets', 'entries'])
        queryClient.invalidateQueries({ queryKey: [key] });
      toast.success(`${action === 'issue' ? 'Issued' : 'Redeemed'} ${amount} ${code}`);
      setAmount('');
      setNote('');
    },
  });
  const c = info.data;
  return (
    <Modal
      title={code ? `${code} · ${licence.title}` : t('A currency for {0}', licence.title)}
      onClose={onClose}
    >
      {!code ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <p className="small muted" style={{ margin: 0 }}>
            {t(
              'A virtual country can issue one currency. Anyone can hold it, send it and be invoiced in it; you decide how much is in circulation.',
            )}
          </p>
          <div className="grid-2">
            <Field label={t('Code')} hint={t('Three letters that are not a real-world currency')}>
              <input
                className="input mono"
                value={form.code}
                maxLength={3}
                required
                pattern="[A-Za-z]{3}"
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              />
            </Field>
            <Field label={t('Decimals')}>
              <select
                className="select"
                value={form.decimals}
                onChange={(e) => setForm({ ...form, decimals: e.target.value })}
              >
                {[0, 1, 2, 3, 4].map((d) => (
                  <option key={d} value={d}>
                    {d === 0 ? t('Whole units') : `${d} (${(1 / 10 ** d).toFixed(d)})`}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={t('Name')}>
            <input
              className="input"
              value={form.name}
              minLength={2}
              maxLength={64}
              required
              placeholder={t('Helios lira')}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <ErrorAlert error={create.error} />
          <button className="btn primary" disabled={create.isPending}>
            {t('Create currency')}
          </button>
        </form>
      ) : (
        <div className="stack">
          <ErrorAlert error={info.error} />
          {c && (
            <>
              <div className="row-wrap">
                <StatusBadge status={c.status} />
                <span className="small muted">
                  {t('{0} · issued by {1} ({2})', c.name, c.country, c.registryNumber)}
                </span>
              </div>
              <div className="grid-2">
                <div className="card flat kpi">
                  <span className="kpi-label">{t('In circulation')}</span>
                  <span className="kpi-value compact">{formatMoney(c.supply, c.code)}</span>
                </div>
                <div className="card flat kpi">
                  <span className="kpi-label">{t('Balances holding it')}</span>
                  <span className="kpi-value compact">{c.holders}</span>
                </div>
              </div>
            </>
          )}
          <form className="stack" onSubmit={(e) => e.preventDefault()}>
            <div className="grid-2">
              <Field label={t('Amount ({0})', code)}>
                <input
                  className="input"
                  inputMode="decimal"
                  value={amount}
                  placeholder="0.00"
                  onChange={(e) => setAmount(e.target.value.replace(',', '.'))}
                />
              </Field>
              <Field label={t('Note (optional)')}>
                <input
                  className="input"
                  value={note}
                  maxLength={200}
                  onChange={(e) => setNote(e.target.value)}
                />
              </Field>
            </div>
            <p className="tiny muted" style={{ margin: 0 }}>
              {t(
                'Issued money lands on the {0}{1} balance; redeeming takes it back out of circulation from there.',
                licence.holder.type === 'organization' ? `${licence.holder.name} ` : '',
                code,
              )}
            </p>
            <ErrorAlert error={change.error} />
            <div className="row-wrap">
              <button
                className="btn primary"
                disabled={
                  change.isPending ||
                  !(Number(amount) > 0) ||
                  c?.status !== 'active' ||
                  licence.status !== 'active'
                }
                onClick={() => change.mutate('issue')}
              >
                {t('Issue')}
              </button>
              <button
                className="btn"
                disabled={change.isPending || !(Number(amount) > 0)}
                onClick={() => change.mutate('redeem')}
              >
                {t('Redeem')}
              </button>
            </div>
          </form>
        </div>
      )}
    </Modal>
  );
}

/** Licences you hold, with their expiry and a way to renew. */
function Licences({ licences, onRenew }: { licences: MyLicence[]; onRenew: (l: MyLicence) => void }) {
  const [currencyFor, setCurrencyFor] = useState<MyLicence | null>(null);
  return (
    <div className="stack">
      <h2>{t('Your licences')}</h2>
      <div className="card pad-0 table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t('Licence')}</th>
              <th>{t('Holder')}</th>
              <th>{t('Valid until')}</th>
              <th>{t('Status')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {licences.map((l) => {
              const days = l.expiresAt
                ? Math.ceil((new Date(l.expiresAt).getTime() - Date.now()) / DAY)
                : null;
              return (
                <tr key={l.id}>
                  <td>
                    <b>{l.title}</b>
                    <div className="small muted">
                      <code>{l.number}</code> ·{' '}
                      {l.licenseType ? LICENSE_TYPE_LABELS[l.licenseType] : t('Licence')}
                    </div>
                  </td>
                  <td className="small">{l.holder.type === 'organization' ? l.holder.name : t('You')}</td>
                  <td className={`small nowrap${days !== null && days <= 30 ? ' neg' : ''}`}>
                    {l.expiresAt ? formatDate(l.expiresAt, false) : t('No expiry')}
                    {days !== null && days > 0 && days <= 60 && <div>{t('in {0} days', days)}</div>}
                  </td>
                  <td>
                    <StatusBadge status={l.renewalApplicationId ? 'renewal_pending' : l.status} />
                  </td>
                  <td className="right nowrap">
                    <a
                      className="btn ghost sm"
                      href={api.registry.certificateUrl(l.number)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('Certificate')}
                    </a>
                    {l.kind === 'virtual_country' && (l.currency || l.status === 'active') && (
                      <button className="btn ghost sm" onClick={() => setCurrencyFor(l)}>
                        {l.currency ?? t('Issue a currency')}
                      </button>
                    )}
                    {!l.renewalApplicationId && canRenew(l) && (
                      <button className="btn primary sm" onClick={() => onRenew(l)}>
                        {t('Renew')}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {currencyFor && <CurrencyModal licence={currencyFor} onClose={() => setCurrencyFor(null)} />}
    </div>
  );
}

function ResultLinks({ application }: { application: Application }) {
  const r = application.result ?? {};
  return (
    <div className="row-wrap small">
      {typeof r.organizationSlug === 'string' && (
        <Link to={`/companies/${r.organizationSlug}`}>{t('Open company')}</Link>
      )}
      {typeof r.ticker === 'string' && r.ticker && (
        <Link to={`/exchange/${r.ticker}`}>{t('{0} on the exchange', r.ticker)}</Link>
      )}
      {typeof r.registryNumber === 'string' && <code>{r.registryNumber}</code>}
      {typeof r.licenseNumber === 'string' && <code>{r.licenseNumber}</code>}
      {typeof r.expiresAt === 'string' && <span>{t('Valid until {0}', formatDate(r.expiresAt, false))}</span>}
      {typeof r.chatId === 'string' && <Link to={`/chats/${r.chatId}`}>{t('Open channel')}</Link>}
    </div>
  );
}

const NEW_TYPES: { type: ApplicationType; title: string; text: string; staff?: boolean }[] = [
  {
    type: 'company',
    title: msg('Company / business account'),
    text: msg('Register a company with its business license and optional stock listing.'),
  },
  {
    type: 'license',
    title: 'License',
    text: msg('Projects, fan-projects, TV & radio channels, websites, virtual countries…'),
  },
  { type: 'news_channel', title: msg('News channel'), text: msg('Channels are created through moderation.') },
  {
    type: 'moderator',
    title: msg('Join the moderation team'),
    text: msg('Review applications and answer tech support.'),
    staff: true,
  },
  {
    type: 'council',
    title: msg('Join the council'),
    text: msg('Vote on companies, licenses and new members.'),
    staff: true,
  },
];

export function ApplicationsPage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const creating = params.get('new') as ApplicationType | null;
  const licences = useQuery({ queryKey: ['licences'], queryFn: api.me.licences });
  const renewing = licences.data?.find((l) => l.id === params.get('renew'));
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
        title={t('Applications')}
        subtitle={t(
          'Register companies and licenses or join the moderation team or the council. Every application goes through moderation and confirmations.',
        )}
      />
      <div className="grid-3">
        {NEW_TYPES.filter(
          (t) => !t.staff || me.role === 'user' || (t.type === 'council' && me.role === 'moderator'),
        ).map((tpl) => (
          <button
            key={tpl.type}
            className="card stack-sm"
            style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' }}
            onClick={() => setParams({ new: tpl.type })}
          >
            <h3>{t(tpl.title)}</h3>
            <span className="small muted">{t(tpl.text)}</span>
            <span className="small bold" style={{ color: 'var(--accent)' }}>
              {t('Apply →')}
            </span>
          </button>
        ))}
      </div>

      {!!licences.data?.length && (
        <Licences licences={licences.data} onRenew={(l) => setParams({ renew: l.id })} />
      )}

      <div className="stack">
        <h2>{t('Your applications')}</h2>
        {mine.isLoading && <Spinner center />}
        <ErrorAlert error={mine.error} />
        {mine.data?.length === 0 && (
          <div className="card">
            <Empty title={t('You have not submitted anything yet')} />
          </div>
        )}
        {mine.data?.map((a) => (
          <div key={a.id} className="card stack-sm" onClick={() => setOpen(a)} style={{ cursor: 'pointer' }}>
            <div className="spread">
              <div className="row-wrap">
                <h3>{t(WORKFLOWS[a.type].label)}</h3>
                <span className="muted small">{String(a.payload.name ?? a.payload.title ?? '')}</span>
              </div>
              <StatusBadge status={a.status} />
            </div>
            <WorkflowStepper application={a} />
            {a.status === 'rejected' && a.rejectionReason && (
              <div className="alert error small">{t('Rejected: {0}', a.rejectionReason)}</div>
            )}
            {a.status === 'changes_requested' && (
              <div className="alert warning small">
                <Icon name="info" size={16} />
                <span className="grow">
                  {t('Changes requested:')} {a.changesRequested}
                </span>
                <button
                  className="btn sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(a);
                  }}
                >
                  {t('Edit and resubmit')}
                </button>
              </div>
            )}
            {a.status === 'approved' && <ResultLinks application={a} />}
            <span className="tiny muted">{t('Submitted {0}', formatDate(a.createdAt))}</span>
          </div>
        ))}
      </div>

      {creating && WORKFLOWS[creating] && creating !== 'renewal' && (
        <NewApplicationModal type={creating} onClose={() => setParams({})} />
      )}
      {renewing && <NewApplicationModal type="renewal" licence={renewing} onClose={() => setParams({})} />}
      {editing && (
        <NewApplicationModal type={editing.type} resubmit={editing} onClose={() => setEditing(null)} />
      )}
      {open && (
        <Modal title={t(WORKFLOWS[open.type].label)} onClose={() => setOpen(null)} wide>
          <div className="stack">
            <WorkflowStepper application={open} />
            <PayloadView payload={open.payload} />
            {open.attachments.length > 0 && (
              <div className="stack-sm">
                <h3>{t('Documents')}</h3>
                <AttachmentList files={open.attachments} href={api.files.url} />
              </div>
            )}
            {open.reviews.length > 0 && (
              <div className="stack-sm">
                <h3>{t('Decisions')}</h3>
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
                {t('Edit and resubmit')}
              </button>
            )}
            {(open.status === 'pending' || open.status === 'changes_requested') && (
              <button className="btn danger" onClick={() => withdraw.mutate(open.id)}>
                {t('Withdraw application')}
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
