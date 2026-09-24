import type { StockListing } from '@ovl/shared';
import { ErrorAlert, Field, formatDate, Modal, Money, PageHeader, Spinner, StatusBadge } from '@ovl/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
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
            label={`Share price (${listing.currency})`}
            hint="Changes are recorded in the price history."
          >
            <input
              className="input"
              value={form.sharePrice}
              onChange={(e) => setForm({ ...form, sharePrice: e.target.value })}
            />
          </Field>
          <Field label="Trading status">
            <select
              className="select"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as StockListing['status'] })}
            >
              <option value="active">Active</option>
              <option value="halted">Halted</option>
              <option value="delisted">Delisted</option>
            </select>
          </Field>
          <Field label="Frozen share of investments (%)" hint="Applies to new investments.">
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
            label="Lock period (days)"
            hint={limits ? `${limits.lockDaysMin}–${limits.lockDaysMax} days (3–6 months)` : undefined}
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
          Save listing
        </button>
      </form>
    </Modal>
  );
}

export function StockPage() {
  const { can } = useAdmin();
  const [editing, setEditing] = useState<StockListing | null>(null);
  const listings = useQuery({ queryKey: ['listings'], queryFn: () => api.stock.listings() });
  return (
    <div className="page">
      <PageHeader
        title="Stock exchange"
        subtitle="Listings created when company applications with a stock listing are approved."
      />
      <ErrorAlert error={listings.error} />
      <div className="card pad-0 table-wrap">
        {listings.isLoading && <Spinner center />}
        <table className="table">
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Company</th>
              <th className="right">Price</th>
              <th className="right">Sold / total</th>
              <th className="right">Raised</th>
              <th>Freeze · lock</th>
              <th>Listed</th>
              <th>Status</th>
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
                  {Number(l.sharesSold).toLocaleString()} / {Number(l.totalShares).toLocaleString()}
                </td>
                <td className="right">
                  <Money amount={l.raised} currency={l.currency} />
                </td>
                <td className="small">
                  {l.freezePercent}% · {l.lockDays} d
                </td>
                <td className="small">{formatDate(l.listedAt, false)}</td>
                <td>
                  <StatusBadge status={l.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <EditListing listing={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
