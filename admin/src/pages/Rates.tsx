import { CURRENCIES, type ExchangeInfo } from '@ovl/shared';
import {
  Empty,
  ErrorAlert,
  Field,
  formatDate,
  Icon,
  PageHeader,
  SkeletonList,
  timeAgo,
  useToast,
} from '@ovl/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAdmin } from '../auth';

type Row = { currency: string; rate: string };

/** Managed exchange rates: what one unit of each currency is worth in the base currency. */
export function RatesPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAdmin();
  const editable = can('exchange.manage');
  const info = useQuery({ queryKey: ['exchange'], queryFn: api.exchange.info });
  const [base, setBase] = useState('USD');
  const [fee, setFee] = useState('0.5');
  const [rows, setRows] = useState<Row[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [adding, setAdding] = useState('EUR');

  const reset = (data: ExchangeInfo) => {
    setBase(data.base);
    setFee(data.feePercent);
    setRows(data.rates.map((r) => ({ currency: r.currency, rate: r.rate })));
    setRemoved([]);
  };
  useEffect(() => {
    if (info.data) reset(info.data);
  }, [info.data]);

  const save = useMutation({
    mutationFn: () =>
      api.admin.setExchange({
        base,
        feePercent: fee,
        rates: [
          ...rows.map((r) => ({ currency: r.currency, rate: r.rate.trim() })),
          ...removed.map((currency) => ({ currency, rate: null })),
        ],
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['exchange'], data);
      reset(data);
      toast.success('Exchange rates saved');
    },
  });

  const saved = new Map(info.data?.rates.map((r) => [r.currency, r]) ?? []);
  const used = new Set([base, ...rows.map((r) => r.currency)]);
  const available = CURRENCIES.filter((c) => !used.has(c.code));
  const dirty =
    !!info.data &&
    (base !== info.data.base ||
      fee !== info.data.feePercent ||
      removed.length > 0 ||
      rows.length !== info.data.rates.length ||
      rows.some((r) => saved.get(r.currency)?.rate !== r.rate));

  return (
    <div className="stack-lg">
      <PageHeader
        icon="refresh"
        title="Exchange rates"
        subtitle="People and companies convert between their balances at these rates. The fee is taken from the amount before converting."
      />
      <ErrorAlert error={info.error} />
      {info.isLoading && <SkeletonList rows={4} avatar={false} />}
      {info.data && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="card stack">
            <div className="grid-3">
              <Field label="Base currency" hint="Every rate says what one unit is worth in this currency.">
                <select
                  className="select"
                  value={base}
                  disabled={!editable}
                  onChange={(e) => {
                    setBase(e.target.value);
                    setRows(rows.filter((r) => r.currency !== e.target.value));
                  }}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Fee (%)" hint="Up to two decimals, e.g. 0.5">
                <input
                  className="input"
                  inputMode="decimal"
                  value={fee}
                  disabled={!editable}
                  onChange={(e) => setFee(e.target.value.replace(',', '.'))}
                  pattern="\d{1,2}(\.\d{1,2})?"
                  required
                />
              </Field>
            </div>
            {base !== info.data.base && (
              <div className="alert warning small">
                <Icon name="info" size={16} /> Changing the base currency does not convert the rates: enter
                every rate again in {base}.
              </div>
            )}
          </div>

          <div className="card pad-0">
            <div className="card-header" style={{ padding: '16px 18px 0' }}>
              <h3>Rates</h3>
              <span className="small muted">
                {rows.length} {rows.length === 1 ? 'currency' : 'currencies'} besides {base}
              </span>
            </div>
            {rows.length === 0 && (
              <Empty title="No rates yet">Add a currency below; until then nobody can convert money.</Empty>
            )}
            {rows.length > 0 && (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Currency</th>
                      <th>1 unit in {base}</th>
                      <th>1 {base} buys</th>
                      <th>Updated</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const value = Number(r.rate);
                      const s = saved.get(r.currency);
                      return (
                        <tr key={r.currency}>
                          <td>
                            <b>{r.currency}</b>{' '}
                            <span className="small muted">
                              {CURRENCIES.find((c) => c.code === r.currency)?.name}
                            </span>
                          </td>
                          <td style={{ width: 200 }}>
                            <input
                              className="input"
                              inputMode="decimal"
                              aria-label={`${r.currency} rate`}
                              value={r.rate}
                              disabled={!editable}
                              pattern="\d{1,12}(\.\d{1,12})?"
                              required
                              onChange={(e) =>
                                setRows(
                                  rows.map((x, j) =>
                                    j === i ? { ...x, rate: e.target.value.replace(',', '.') } : x,
                                  ),
                                )
                              }
                            />
                          </td>
                          <td className="small">
                            {value > 0
                              ? `${(1 / value).toPrecision(6).replace(/\.?0+$/, '')} ${r.currency}`
                              : '—'}
                          </td>
                          <td className="small muted" title={s ? formatDate(s.updatedAt) : undefined}>
                            {s ? timeAgo(s.updatedAt) : 'New'}
                          </td>
                          <td className="right">
                            {editable && (
                              <button
                                type="button"
                                className="btn ghost sm"
                                aria-label={`Remove ${r.currency}`}
                                onClick={() => {
                                  setRows(rows.filter((x) => x.currency !== r.currency));
                                  if (saved.has(r.currency)) setRemoved([...removed, r.currency]);
                                }}
                              >
                                <Icon name="trash" size={15} />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {editable && (
              <div className="row-wrap" style={{ padding: 14 }}>
                <select
                  className="select"
                  style={{ width: 280 }}
                  aria-label="Currency to add"
                  value={available.some((c) => c.code === adding) ? adding : available[0]?.code}
                  onChange={(e) => setAdding(e.target.value)}
                >
                  {available.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const code = available.some((c) => c.code === adding) ? adding : available[0]?.code;
                    if (!code) return;
                    setRows([...rows, { currency: code, rate: '' }]);
                    setRemoved(removed.filter((c) => c !== code));
                  }}
                >
                  <Icon name="plus" size={15} /> Add currency
                </button>
              </div>
            )}
          </div>
          <ErrorAlert error={save.error} />
          {editable && (
            <div className="row">
              <button className="btn primary" disabled={!dirty || save.isPending}>
                Save rates
              </button>
              {dirty && (
                <button type="button" className="btn ghost" onClick={() => reset(info.data!)}>
                  Discard changes
                </button>
              )}
            </div>
          )}
        </form>
      )}
    </div>
  );
}
