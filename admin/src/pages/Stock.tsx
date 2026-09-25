import type { StockLimits, StockListing } from '@ovl/shared';
import {
  ErrorAlert,
  Field,
  formatDate,
  Modal,
  Money,
  PageHeader,
  Spinner,
  StatusBadge,
  useToast,
  intlLocale,
  t,
} from '@ovl/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAdmin } from '../auth';

function EditListing({ listing, onClose }: { listing: StockListing; onClose: () => void }) {
  const queryClient = useQueryClient();
  const meta = useQuery({ queryKey: ['meta'], queryFn: api.meta, staleTime: Infinity });
  const limits = (meta.data as { stock?: { lockDaysMin: number; lockDaysMax: number } } | undefined)?.stock;
  const [form, setForm] = useState({
    sharePrice: listing.sharePrice,
    status: listing.status,
    freezePercent: String(listing.freezePercent),
    lockDays: String(listing.lockDays),
  });
  const save = useMutation({
    mutationFn: () =>
      api.admin.updateListing(listing.id, {
        sharePrice: form.sharePrice,
        status: form.status,
        freezePercent: Number(form.freezePercent),
        lockDays: Number(form.lockDays),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      onClose();
    },
  });
  return (
    <Modal title={`${listing.ticker} · ${listing.organization.name}`} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid-2">
          <Field
            label={t('Share price ({0})', listing.currency)}
            hint={t('Changes are recorded in the price history.')}
          >
            <input
              className="input"
              value={form.sharePrice}
              onChange={(e) => setForm({ ...form, sharePrice: e.target.value })}
            />
          </Field>
          <Field label={t('Trading status')}>
            <select
              className="select"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as StockListing['status'] })}
            >
              <option value="active">{t('Active')}</option>
              <option value="halted">{t('Halted')}</option>
              <option value="delisted">{t('Delisted')}</option>
            </select>
          </Field>
          <Field label={t('Frozen share of investments (%)')} hint={t('Applies to new investments.')}>
            <input
              className="input"
              type="number"
              min={0}
              max={100}
              step="0.5"
              value={form.freezePercent}
              onChange={(e) => setForm({ ...form, freezePercent: e.target.value })}
            />
          </Field>
          <Field
            label={t('Lock period (days)')}
            hint={limits ? t('{0}–{1} days (3–6 months)', limits.lockDaysMin, limits.lockDaysMax) : undefined}
          >
            <input
              className="input"
              type="number"
              min={limits?.lockDaysMin}
              max={limits?.lockDaysMax}
              value={form.lockDays}
              onChange={(e) => setForm({ ...form, lockDays: e.target.value })}
            />
          </Field>
        </div>
        <ErrorAlert error={save.error} />
        <button className="btn primary" disabled={save.isPending}>
          {t('Save listing')}
        </button>
      </form>
    </Modal>
  );
}

/** Per-investor limits: the most of one company a person may hold, and how much they put in per 30 days. */
function InvestorLimits() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAdmin();
  const editable = can('stock.manage');
  const settings = useQuery({ queryKey: ['stock', 'limit-settings'], queryFn: api.stock.limitSettings });
  const [form, setForm] = useState({ maxHoldingPercent: '25', monthlyLimit: '', unverifiedMonthlyLimit: '' });
  const reset = (data: StockLimits) =>
    setForm({
      maxHoldingPercent: String(data.maxHoldingPercent),
      monthlyLimit: data.monthlyLimit ?? '',
      unverifiedMonthlyLimit: data.unverifiedMonthlyLimit ?? '',
    });
  useEffect(() => {
    if (settings.data) reset(settings.data);
  }, [settings.data]);
  const save = useMutation({
    mutationFn: () =>
      api.admin.setStockLimits({
        maxHoldingPercent: Number(form.maxHoldingPercent),
        monthlyLimit: form.monthlyLimit.trim(),
        unverifiedMonthlyLimit: form.unverifiedMonthlyLimit.trim(),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['stock', 'limit-settings'], data);
      toast.success(t('Investor limits saved'));
    },
  });
  const base = settings.data?.base ?? '';
  return (
    <form
      className="card stack"
      aria-label={t('Investor limits')}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div>
        <h3>{t('Investor limits')}</h3>
        <p className="small muted" style={{ margin: 0 }}>
          {t(
            'Investments and buy orders over a limit are refused. Monthly limits count what someone invested and bought in the last 30 days, plus open buy orders, in {0}; leave one empty for no limit. Everyone accepts the risk disclosure once before investing.',
            base || 'the base currency',
          )}
        </p>
      </div>
      <div className="grid-3">
        <Field label={t('Most of one company (%)')}>
          <input
            className="input"
            inputMode="decimal"
            value={form.maxHoldingPercent}
            disabled={!editable}
            onChange={(e) => setForm({ ...form, maxHoldingPercent: e.target.value.replace(',', '.') })}
            required
          />
        </Field>
        <Field label={t('Per 30 days, verified ({0})', base)}>
          <input
            className="input"
            inputMode="decimal"
            value={form.monthlyLimit}
            placeholder={t('No limit')}
            disabled={!editable}
            onChange={(e) => setForm({ ...form, monthlyLimit: e.target.value.replace(',', '.') })}
          />
        </Field>
        <Field label={t('Per 30 days, not verified ({0})', base)}>
          <input
            className="input"
            inputMode="decimal"
            value={form.unverifiedMonthlyLimit}
            placeholder={t('Same as verified')}
            disabled={!editable}
            onChange={(e) => setForm({ ...form, unverifiedMonthlyLimit: e.target.value.replace(',', '.') })}
          />
        </Field>
      </div>
      <ErrorAlert error={settings.error ?? save.error} />
      {editable && (
        <div className="row">
          <button className="btn primary" disabled={save.isPending || !settings.data}>
            {t('Save limits')}
          </button>
          {settings.data && (
            <button type="button" className="btn ghost" onClick={() => reset(settings.data!)}>
              {t('Reset')}
            </button>
          )}
        </div>
      )}
    </form>
  );
}

export function StockPage() {
  const { can } = useAdmin();
  const [editing, setEditing] = useState<StockListing | null>(null);
  const listings = useQuery({ queryKey: ['listings'], queryFn: () => api.stock.listings() });
  return (
    <div className="page stack-lg">
      <PageHeader
        icon="chart"
        title={t('Stock exchange')}
        subtitle={t('Listings created when company applications with a stock listing are approved.')}
      />
      <ErrorAlert error={listings.error} />
      <div className="card pad-0 table-wrap">
        {listings.isLoading && <Spinner center />}
        <table className="table">
          <thead>
            <tr>
              <th>{t('Ticker')}</th>
              <th>{t('Company')}</th>
              <th className="right">{t('Price')}</th>
              <th className="right">{t('Sold / total')}</th>
              <th className="right">{t('Raised')}</th>
              <th>{t('Freeze · lock')}</th>
              <th>{t('Listed')}</th>
              <th>{t('Status')}</th>
            </tr>
          </thead>
          <tbody>
            {listings.data?.map((l) => (
              <tr
                key={l.id}
                className={can('stock.manage') ? 'clickable' : ''}
                onClick={() => can('stock.manage') && setEditing(l)}
              >
                <td className="bold">{l.ticker}</td>
                <td>{l.organization.name}</td>
                <td className="right">
                  <Money amount={l.sharePrice} currency={l.currency} />
                </td>
                <td className="right num">
                  {Number(l.sharesSold).toLocaleString(intlLocale())} /{' '}
                  {Number(l.totalShares).toLocaleString(intlLocale())}
                </td>
                <td className="right">
                  <Money amount={l.raised} currency={l.currency} />
                </td>
                <td className="small">{t('{0}% · {1} d', l.freezePercent, l.lockDays)}</td>
                <td className="small">{formatDate(l.listedAt, false)}</td>
                <td>
                  <StatusBadge status={l.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <InvestorLimits />
      {editing && <EditListing listing={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
