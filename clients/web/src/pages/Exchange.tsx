import { formatAmount, parseAmount, type OrderSide, type StockListingDetail } from '@ovl/shared';
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
  Segmented,
  Spinner,
  StatusBadge,
  useToast,
  VerifiedBadge,
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
                <td>
                  <span className="row" style={{ gap: 6 }}>
                    {l.organization.name}
                    {l.organization.verified && <VerifiedBadge compact />}
                  </span>
                </td>
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
            {l.organization.verified && (
              <>
                <VerifiedBadge />{' '}
              </>
            )}
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
      <Market listing={l} />
    </div>
  );
}

/** The secondary market: the order book, a buy/sell form and your open orders. */
function Market({ listing: l }: { listing: StockListingDetail }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const book = useQuery({
    queryKey: ['stock', 'book', l.ticker],
    queryFn: () => api.stock.book(l.ticker),
    refetchInterval: 15_000,
  });
  const portfolio = useQuery({ queryKey: ['portfolio'], queryFn: api.stock.portfolio });
  const orders = useQuery({ queryKey: ['stock', 'orders'], queryFn: () => api.stock.orders('open') });
  const holding = portfolio.data?.holdings.find((h) => h.ticker === l.ticker);
  const mine = orders.data?.filter((o) => o.ticker === l.ticker) ?? [];
  const [side, setSide] = useState<OrderSide>('buy');
  const [shares, setShares] = useState('');
  const [price, setPrice] = useState('');
  const refresh = () => {
    for (const key of ['stock', 'portfolio', 'wallets', 'listings'])
      queryClient.invalidateQueries({ queryKey: [key] });
  };
  const place = useMutation({
    mutationFn: () => api.stock.placeOrder(l.ticker, { side, shares: Number(shares), price }),
    onSuccess: ({ order, trades }) => {
      refresh();
      const traded = trades.reduce((n, t) => n + Number(t.shares), 0);
      toast.success(
        traded
          ? `${side === 'buy' ? 'Bought' : 'Sold'} ${traded} ${l.ticker}${order.status === 'open' ? `; ${order.remaining} left in the book` : ''}`
          : `Order placed: ${side} ${order.shares} ${l.ticker} at ${formatMoney(order.price, l.currency)}`,
      );
      setShares('');
    },
  });
  const cancel = useMutation({ mutationFn: api.stock.cancelOrder, onSuccess: refresh });
  let total: string | null = null;
  try {
    if (shares && price)
      total = formatAmount(parseAmount(price, l.currency) * BigInt(parseInt(shares) || 0), l.currency);
  } catch {
    total = null;
  }
  const b = book.data;
  const levels = (rows: { price: string; shares: string; orders: number }[], kind: 'bid' | 'ask') =>
    rows.length ? (
      rows.map((r) => (
        <tr key={r.price} className="clickable" onClick={() => setPrice(r.price)}>
          <td className={kind === 'bid' ? 'pos bold' : 'neg bold'}>
            {formatMoney(r.price, l.currency, false)}
          </td>
          <td className="right num">{Number(r.shares).toLocaleString()}</td>
          <td className="right small muted">{r.orders}</td>
        </tr>
      ))
    ) : (
      <tr>
        <td colSpan={3} className="small muted">
          No {kind === 'bid' ? 'buy' : 'sell'} orders
        </td>
      </tr>
    );
  return (
    <div className="grid-2">
      <div className="card stack">
        <div className="spread">
          <h3>Order book</h3>
          <span className="small muted">Last trade {b ? formatMoney(b.lastPrice, l.currency) : '—'}</span>
        </div>
        <ErrorAlert error={book.error} />
        <div className="grid-2" style={{ gap: 12 }}>
          <table className="table" aria-label="Buy orders">
            <thead>
              <tr>
                <th>Bid</th>
                <th className="right">Shares</th>
                <th className="right">Orders</th>
              </tr>
            </thead>
            <tbody>{b && levels(b.bids, 'bid')}</tbody>
          </table>
          <table className="table" aria-label="Sell orders">
            <thead>
              <tr>
                <th>Ask</th>
                <th className="right">Shares</th>
                <th className="right">Orders</th>
              </tr>
            </thead>
            <tbody>{b && levels(b.asks, 'ask')}</tbody>
          </table>
        </div>
        <h3>Latest trades</h3>
        {b?.trades.length ? (
          <table className="table">
            <tbody>
              {b.trades.slice(0, 8).map((t) => (
                <tr key={t.id}>
                  <td className="small nowrap">{formatDate(t.at)}</td>
                  <td className={t.side === 'buy' ? 'pos' : 'neg'}>{formatMoney(t.price, l.currency)}</td>
                  <td className="right num">{t.shares}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="small muted">No trades yet: shares change hands once a buy and a sell order meet.</p>
        )}
      </div>
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          place.mutate();
        }}
      >
        <h3>Trade with other investors</h3>
        <p className="small muted" style={{ margin: 0 }}>
          A limit order trades at once with the best matching orders, at their price; the rest waits in the
          book until you cancel it. Shares from an investment can be sold after its {l.lockDays}-day lock.
        </p>
        <Segmented<OrderSide>
          value={side}
          onChange={setSide}
          options={[
            { value: 'buy', label: 'Buy' },
            { value: 'sell', label: 'Sell' },
          ]}
        />
        {holding && (
          <div className="alert info small">
            You hold {holding.shares} {l.ticker}: {holding.sellable} can be sold
            {Number(holding.locked) > 0 && `, ${holding.locked} still locked`}
            {Number(holding.onSale) > 0 && `, ${holding.onSale} already offered`}.
          </div>
        )}
        <div className="grid-2" style={{ gap: 12 }}>
          <Field label="Shares">
            <input
              className="input"
              inputMode="numeric"
              value={shares}
              onChange={(e) => setShares(e.target.value.replace(/\D/g, ''))}
              required
            />
          </Field>
          <Field label={`Limit price (${l.currency})`}>
            <input
              className="input"
              inputMode="decimal"
              value={price}
              placeholder={b?.lastPrice ?? l.sharePrice}
              onChange={(e) => setPrice(e.target.value.replace(',', '.'))}
              required
            />
          </Field>
        </div>
        {total && (
          <div className="spread small">
            <span className="muted">{side === 'buy' ? 'At most' : 'At least'}</span>
            <b>{formatMoney(total, l.currency)}</b>
          </div>
        )}
        <ErrorAlert error={place.error ?? cancel.error} />
        <button
          className={`btn ${side === 'buy' ? 'primary' : 'danger'}`}
          disabled={place.isPending || l.status !== 'active' || !shares || !price}
        >
          {side === 'buy' ? 'Place buy order' : 'Place sell order'}
        </button>
        {mine.length > 0 && (
          <div className="stack-sm">
            <h3>Your open orders</h3>
            {mine.map((o) => (
              <div key={o.id} className="spread small">
                <span>
                  <b className={o.side === 'buy' ? 'pos' : 'neg'}>{o.side === 'buy' ? 'Buy' : 'Sell'}</b>{' '}
                  {o.remaining}
                  {o.remaining !== o.shares && ` of ${o.shares}`} at {formatMoney(o.price, l.currency)}
                </span>
                <button type="button" className="btn ghost sm" onClick={() => cancel.mutate(o.id)}>
                  Cancel
                </button>
              </div>
            ))}
          </div>
        )}
      </form>
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
              <th className="right">Can sell</th>
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
                <td className="right num">
                  {h.sellable}
                  {Number(h.locked) > 0 && <div className="tiny muted">{h.locked} locked</div>}
                </td>
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
