import { formatAmount, parseAmount } from '@ovl/shared';
import {
  Empty,
  ErrorAlert,
  Field,
  Icon,
  formatDate,
  formatMoney,
  Money,
  PageHeader,
  AreaChart,
  Spinner,
  StatusBadge,
} from '@ovl/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';

export function ExchangePage() {
  const navigate = useNavigate();
  const listings = useQuery({ queryKey: ['listings'], queryFn: () => api.stock.listings() });
  return (
    <div className="page stack-lg">
      <PageHeader
        icon="chart"
        title="Stock exchange"
        subtitle="Invest in approved companies. Part of every investment is frozen on the company balance for 3–6 months."
        actions={
          <Link className="btn" to="/exchange/portfolio">
            My portfolio
          </Link>
        }
      />
      {listings.isLoading && <Spinner center />}
      <ErrorAlert error={listings.error} />
      <div className="card pad-0 table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Company</th>
              <th className="right">Share price</th>
              <th className="right">Available</th>
              <th className="right">Raised</th>
              <th className="right">Investors</th>
              <th>Freeze</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {listings.data?.map((l) => (
              <tr key={l.id} className="clickable" onClick={() => navigate(`/exchange/${l.ticker}`)}>
                <td className="bold">{l.ticker}</td>
                <td>{l.organization.name}</td>
                <td className="right">
                  <Money amount={l.sharePrice} currency={l.currency} />
                </td>
                <td className="right num">
                  {Number(l.sharesAvailable).toLocaleString()} / {Number(l.totalShares).toLocaleString()}
                </td>
                <td className="right">
                  <Money amount={l.raised} currency={l.currency} />
                </td>
                <td className="right num">{l.investorsCount}</td>
                <td className="small nowrap">
                  {l.freezePercent}% · {l.lockDays} d
                </td>
                <td>
                  <StatusBadge status={l.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {listings.data?.length === 0 && <Empty title="No companies are listed yet" />}
      </div>
      <p className="small muted">
        Services can read this data through the public API: <code>GET /api/v1/stock/listings</code> (see the
        developer section of your profile for API keys).
      </p>
    </div>
  );
}

export function ListingPage() {
  const { ticker = '' } = useParams();
  const queryClient = useQueryClient();
  const listing = useQuery({ queryKey: ['listings', ticker], queryFn: () => api.stock.listing(ticker) });
  const wallets = useQuery({ queryKey: ['wallets'], queryFn: api.wallets.list });
  const [amount, setAmount] = useState('');
  const invest = useMutation({
    mutationFn: () => api.stock.invest(ticker, amount),
    onSuccess: () => {
      setAmount('');
      for (const key of ['listings', 'wallets', 'portfolio'])
        queryClient.invalidateQueries({ queryKey: [key] });
    },
  });

  if (listing.isLoading) return <Spinner center />;
  if (!listing.data)
    return (
      <div className="page">
        <ErrorAlert error={listing.error} />
      </div>
    );
  const l = listing.data;
  const wallet = wallets.data?.find((w) => w.currency === l.currency);

  let preview: { shares: bigint; cost: string; frozen: string } | null = null;
  try {
    if (amount) {
      const minor = parseAmount(amount, l.currency);
      const price = parseAmount(l.sharePrice, l.currency);
      const shares = minor / price;
      const cost = shares * price;
      const frozen = (cost * BigInt(Math.round(l.freezePercent * 100))) / 10000n;
      preview = { shares, cost: formatAmount(cost, l.currency), frozen: formatAmount(frozen, l.currency) };
    }
  } catch {
    preview = null;
  }

  return (
    <div className="page stack-lg">
      <PageHeader
        title={`${l.ticker} · ${l.organization.name}`}
        subtitle={
          <>
            Registry number <code>{l.organization.registryNumber}</code> · listed{' '}
            {formatDate(l.listedAt, false)} ·{' '}
            <Link to={`/companies/${l.organization.slug}`}>company profile</Link>
          </>
        }
        actions={<StatusBadge status={l.status} />}
      />
      <div className="grid-3">
        <div className="card kpi">
          <span className="kpi-label">Share price</span>
          <span className="kpi-value">{formatMoney(l.sharePrice, l.currency)}</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Market cap</span>
          <span className="kpi-value">{formatMoney(l.marketCap, l.currency)}</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Raised · investors</span>
          <span className="kpi-value">
            {formatMoney(l.raised, l.currency)} · {l.investorsCount}
          </span>
        </div>
      </div>
      <div className="grid-2">
        <div className="card stack">
          <div className="spread">
            <h3>Price history</h3>
            <PriceChange history={l.priceHistory.map((p) => Number(p.price))} />
          </div>
          <AreaChart
            values={l.priceHistory.map((p) => Number(p.price))}
            labels={l.priceHistory.map((p) => formatDate(p.at))}
            format={(v) => formatMoney(v.toFixed(2), l.currency)}
            height={220}
          />
          <p className="small" style={{ whiteSpace: 'pre-wrap' }}>
            {l.description}
          </p>
        </div>
        <form
          className="card stack"
          onSubmit={(e) => {
            e.preventDefault();
            invest.mutate();
          }}
        >
          <h3>Invest</h3>
          <div className="small muted">
            {Number(l.sharesAvailable).toLocaleString()} shares available. {l.freezePercent}% of your
            investment is frozen on the company balance for {l.lockDays} days, the rest is available to the
            company immediately.
          </div>
          <div className="alert info small">
            Your {l.currency} balance:{' '}
            {wallet ? formatMoney(wallet.available, l.currency) : `no ${l.currency} wallet`}
          </div>
          <Field label={`Amount (${l.currency})`}>
            <input
              className="input"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(',', '.'))}
              placeholder={l.sharePrice}
              disabled={l.status !== 'active'}
            />
          </Field>
          {preview && (
            <dl className="dl small">
              <dt>Shares</dt>
              <dd>{preview.shares.toString()}</dd>
              <dt>You pay</dt>
              <dd>{formatMoney(preview.cost, l.currency)}</dd>
              <dt>Frozen for {l.lockDays} days</dt>
              <dd>{formatMoney(preview.frozen, l.currency)}</dd>
            </dl>
          )}
          <ErrorAlert error={invest.error} />
          {invest.data && (
            <div className="alert success">
              Bought {invest.data.shares} shares for {formatMoney(invest.data.amount, invest.data.currency)}.
            </div>
          )}
          <button
            className="btn primary"
            disabled={!preview || preview.shares < 1n || invest.isPending || l.status !== 'active'}
          >
            Invest
          </button>
        </form>
      </div>
    </div>
  );
}

export function PortfolioPage() {
  const portfolio = useQuery({ queryKey: ['portfolio'], queryFn: api.stock.portfolio });
  return (
    <div className="page stack-lg">
      <PageHeader
        icon="pie"
        title="My portfolio"
        actions={
          <Link className="btn" to="/exchange">
            Back to the exchange
          </Link>
        }
      />
      {portfolio.isLoading && <Spinner center />}
      <ErrorAlert error={portfolio.error} />
      <div className="card pad-0 table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Company</th>
              <th className="right">Shares</th>
              <th className="right">Invested</th>
              <th className="right">Current value</th>
            </tr>
          </thead>
          <tbody>
            {portfolio.data?.holdings.map((h) => (
              <tr key={h.ticker}>
                <td className="bold">
                  <Link to={`/exchange/${h.ticker}`}>{h.ticker}</Link>
                </td>
                <td>{h.organizationName}</td>
                <td className="right num">{h.shares}</td>
                <td className="right">
                  <Money amount={h.invested} currency={h.currency} />
                </td>
                <td className="right">
                  <Money amount={h.currentValue} currency={h.currency} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {portfolio.data?.holdings.length === 0 && <Empty title="You have no investments yet" />}
      </div>
      {!!portfolio.data?.investments.length && (
        <div className="card pad-0 table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Ticker</th>
                <th className="right">Shares</th>
                <th className="right">Amount</th>
                <th>Frozen part unlocks</th>
              </tr>
            </thead>
            <tbody>
              {portfolio.data.investments.map((i) => (
                <tr key={i.id}>
                  <td className="small">{formatDate(i.createdAt)}</td>
                  <td>{i.ticker}</td>
                  <td className="right num">{i.shares}</td>
                  <td className="right">
                    <Money amount={i.amount} currency={i.currency} />
                  </td>
                  <td className="small">
                    {formatMoney(i.frozenAmount, i.currency)} · {formatDate(i.unlocksAt, false)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PriceChange({ history }: { history: number[] }) {
  const first = history[0];
  const last = history[history.length - 1];
  if (history.length < 2 || !first || last === undefined) return null;
  const change = ((last - first) / first) * 100;
  const up = change >= 0;
  return (
    <span className={`badge ${up ? 'ok' : 'bad'}`}>
      <Icon name={up ? 'arrowUpRight' : 'arrowDownLeft'} size={13} />
      {up ? '+' : ''}
      {change.toFixed(2)}%
    </span>
  );
}
