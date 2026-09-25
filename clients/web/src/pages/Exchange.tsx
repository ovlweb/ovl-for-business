import {
  formatAmount,
  parseAmount,
  type CompanyReport,
  type MyStockLimits,
  type OrderSide,
  type Proposal,
  type StockListingDetail,
} from '@ovl/shared';
import {
  Empty,
  ErrorAlert,
  Field,
  Icon,
  formatDate,
  Modal,
  formatMoney,
  Money,
  PageHeader,
  AreaChart,
  AttachmentList,
  Segmented,
  ShareBar,
  Spinner,
  StatusBadge,
  useToast,
  VerifiedBadge,
  plural,
  intlLocale,
  t,
} from '@ovl/ui';
import { OvlApiError } from '@ovl/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';

export function ExchangePage() {
  const navigate = useNavigate();
  const listings = useQuery({ queryKey: ['listings'], queryFn: () => api.stock.listings() });
  return (
    <div className="page stack-lg">
      <PageHeader
        icon="chart"
        title={t('Stock exchange')}
        subtitle={t(
          'Invest in approved companies. Part of every investment is frozen on the company balance for 3–6 months.',
        )}
        actions={
          <Link className="btn" to="/exchange/portfolio">
            {t('My portfolio')}
          </Link>
        }
      />
      {listings.isLoading && <Spinner center />}
      <ErrorAlert error={listings.error} />
      <div className="card pad-0 table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t('Ticker')}</th>
              <th>{t('Company')}</th>
              <th className="right">{t('Share price')}</th>
              <th className="right">{t('Available')}</th>
              <th className="right">{t('Raised')}</th>
              <th className="right">{t('Investors')}</th>
              <th>{t('Freeze')}</th>
              <th>{t('Status')}</th>
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
                  {Number(l.sharesAvailable).toLocaleString(intlLocale())} /{' '}
                  {Number(l.totalShares).toLocaleString(intlLocale())}
                </td>
                <td className="right">
                  <Money amount={l.raised} currency={l.currency} />
                </td>
                <td className="right num">{l.investorsCount}</td>
                <td className="small nowrap">{t('{0}% · {1} d', l.freezePercent, l.lockDays)}</td>
                <td>
                  <StatusBadge status={l.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {listings.data?.length === 0 && <Empty title={t('No companies are listed yet')} />}
      </div>
      <p className="small muted">
        {t('Services can read this data through the public API:')}{' '}
        <code>{t('GET /api/v1/stock/listings')}</code>{' '}
        {t('(see the developer section of your profile for API keys).')}
      </p>
    </div>
  );
}

export function ListingPage() {
  const { ticker = '' } = useParams();
  const queryClient = useQueryClient();
  const listing = useQuery({ queryKey: ['listings', ticker], queryFn: () => api.stock.listing(ticker) });
  const wallets = useQuery({ queryKey: ['wallets'], queryFn: api.wallets.list });
  const limits = useQuery({ queryKey: ['stock', 'limits'], queryFn: api.stock.limits });
  const gate = useRiskGate();
  const [amount, setAmount] = useState('');
  const invest = useMutation({
    mutationFn: () => api.stock.invest(ticker, amount),
    onSuccess: () => {
      setAmount('');
      for (const key of ['listings', 'wallets', 'portfolio', 'stock'])
        queryClient.invalidateQueries({ queryKey: [key] });
    },
    onError: (error) => gate.onError(error, () => invest.mutate()),
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
            {t('Registry number')} <code>{l.organization.registryNumber}</code>{' '}
            {t('· listed {0} ·', formatDate(l.listedAt, false))}{' '}
            <Link to={`/companies/${l.organization.slug}`}>{t('company profile')}</Link>
          </>
        }
        actions={<StatusBadge status={l.status} />}
      />
      <div className="grid-3">
        <div className="card kpi">
          <span className="kpi-label">{t('Share price')}</span>
          <span className="kpi-value">{formatMoney(l.sharePrice, l.currency)}</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">{t('Market cap')}</span>
          <span className="kpi-value">{formatMoney(l.marketCap, l.currency)}</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">{t('Raised · investors')}</span>
          <span className="kpi-value">
            {formatMoney(l.raised, l.currency)} · {l.investorsCount}
          </span>
        </div>
      </div>
      <div className="grid-2">
        <div className="card stack">
          <div className="spread">
            <h3>{t('Price history')}</h3>
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
            gate.guard(() => invest.mutate());
          }}
        >
          <h3>{t('Invest')}</h3>
          <div className="small muted">
            {t(
              '{0} shares available. {1}% of your investment is frozen on the company balance for {2} days, the rest is available to the company immediately.',
              Number(l.sharesAvailable).toLocaleString(intlLocale()),
              l.freezePercent,
              l.lockDays,
            )}
          </div>
          <div className="alert info small">
            {t(
              'Your {0} balance: {1}',
              l.currency,
              wallet ? formatMoney(wallet.available, l.currency) : `no ${l.currency} wallet`,
            )}
          </div>
          <Field label={t('Amount ({0})', l.currency)}>
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
              <dt>{t('Shares')}</dt>
              <dd>{preview.shares.toString()}</dd>
              <dt>{t('You pay')}</dt>
              <dd>{formatMoney(preview.cost, l.currency)}</dd>
              <dt>{t('Frozen for {0} days', l.lockDays)}</dt>
              <dd>{formatMoney(preview.frozen, l.currency)}</dd>
            </dl>
          )}
          {limits.data && <LimitInfo limits={limits.data} />}
          <ErrorAlert error={gate.isGateError(invest.error) ? null : invest.error} />
          {invest.data && (
            <div className="alert success">
              {t(
                'Bought {0} shares for {1}.',
                invest.data.shares,
                formatMoney(invest.data.amount, invest.data.currency),
              )}
            </div>
          )}
          <button
            className="btn primary"
            disabled={!preview || preview.shares < 1n || invest.isPending || l.status !== 'active'}
          >
            {t('Invest')}
          </button>
        </form>
      </div>
      <Market listing={l} />
      <ShareholderInfo listing={l} />
      {gate.modal}
    </div>
  );
}

/** The investor limits that apply to you, next to the invest form. */
function LimitInfo({ limits }: { limits: MyStockLimits }) {
  return (
    <p className="small muted" style={{ margin: 0 }}>
      {t('One investor may hold at most')} {limits.maxHoldingPercent}
      {t('% of a company.')}
      {limits.monthlyLimit && limits.remaining !== null && (
        <>
          {' '}
          {t('You can invest and buy')} {formatMoney(limits.remaining, limits.base)}{' '}
          {t('more in the next 30 days (limit')} {formatMoney(limits.monthlyLimit, limits.base)}
          {!limits.identityVerified && t('; verify your identity for a higher one')}).
        </>
      )}
    </p>
  );
}

/**
 * Investing and buying need the risk disclosure accepted once: guard() shows it first when it
 * has not been, and onError() catches the server's refusal (then retries after accepting).
 */
function useRiskGate() {
  const queryClient = useQueryClient();
  const risk = useQuery({ queryKey: ['stock', 'risk'], queryFn: api.stock.risk });
  const [next, setNext] = useState<{ run: () => void } | null>(null);
  const accept = useMutation({
    mutationFn: () => api.stock.acceptRisk(risk.data!.version),
    onSuccess: (accepted) => {
      queryClient.setQueryData(['stock', 'risk'], accepted);
      const pending = next;
      setNext(null);
      pending?.run();
    },
  });
  const isGateError = (error: unknown) =>
    error instanceof OvlApiError && error.code === 'risk_disclosure_required';
  const guard = (run: () => void) => (risk.data && !risk.data.acceptedAt ? setNext({ run }) : run());
  const onError = (error: unknown, retry: () => void) => {
    if (!isGateError(error)) return;
    void queryClient.invalidateQueries({ queryKey: ['stock', 'risk'] });
    setNext({ run: retry });
  };
  const modal: ReactNode =
    next && risk.data ? (
      <Modal title={risk.data.title} onClose={() => setNext(null)}>
        <div className="stack">
          <p className="small muted" style={{ margin: 0 }}>
            {t('Please read this once before your first investment or trade.')}
          </p>
          <ul className="stack-sm small" style={{ margin: 0, paddingLeft: 20 }}>
            {risk.data.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <ErrorAlert error={accept.error} />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn ghost" onClick={() => setNext(null)}>
              {t('Not now')}
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={accept.isPending}
              onClick={() => accept.mutate()}
            >
              {t('I understand, continue')}
            </button>
          </div>
        </div>
      </Modal>
    ) : null;
  return { guard, onError, isGateError, modal };
}

type InfoTab = 'reports' | 'votes' | 'dividends';

/** What the company tells and pays its shareholders: reports, votes and dividends. */
function ShareholderInfo({ listing: l }: { listing: StockListingDetail }) {
  const [tab, setTab] = useState<InfoTab>('reports');
  const reports = useQuery({
    queryKey: ['stock', 'reports', l.ticker],
    queryFn: () => api.stock.reports(l.ticker),
  });
  const votes = useQuery({
    queryKey: ['stock', 'proposals', l.ticker],
    queryFn: () => api.stock.proposals(l.ticker),
  });
  const dividends = useQuery({
    queryKey: ['stock', 'dividends', l.ticker],
    queryFn: () => api.stock.dividends(l.ticker),
  });
  const openVotes = votes.data?.filter((v) => v.status === 'open').length ?? 0;
  return (
    <div className="card stack">
      <div className="spread" style={{ flexWrap: 'wrap', gap: 10 }}>
        <h3>{t('For shareholders')}</h3>
        <Segmented<InfoTab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'reports', label: `Reports${reports.data?.length ? ` · ${reports.data.length}` : ''}` },
            { value: 'votes', label: `Votes${openVotes ? ` · ${openVotes} open` : ''}` },
            { value: 'dividends', label: t('Dividends') },
          ]}
        />
      </div>
      {tab === 'reports' &&
        (reports.data?.length ? (
          reports.data.map((r) => <ReportCard key={r.id} report={r} />)
        ) : (
          <p className="small muted">{t('The company has not published results yet.')}</p>
        ))}
      {tab === 'votes' &&
        (votes.data?.length ? (
          votes.data.map((p) => <ProposalCard key={p.id} proposal={p} />)
        ) : (
          <p className="small muted">{t('No shareholder votes yet.')}</p>
        ))}
      {tab === 'dividends' &&
        (dividends.data?.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>{t('Declared')}</th>
                <th className="right">{t('Per share')}</th>
                <th className="right">{t('Total')}</th>
                <th className="right">{t('Shareholders')}</th>
                <th>{t('Status')}</th>
              </tr>
            </thead>
            <tbody>
              {dividends.data.map((d) => (
                <tr key={d.id}>
                  <td className="small">
                    {formatDate(d.createdAt, false)}
                    {d.note && <div className="muted">{d.note}</div>}
                  </td>
                  <td className="right">
                    <Money amount={d.perShare} currency={d.currency} />
                  </td>
                  <td className="right">
                    <Money amount={d.total} currency={d.currency} />
                  </td>
                  <td className="right num">{d.holders}</td>
                  <td>
                    <StatusBadge status={d.status === 'pending' ? 'waiting_for_approval' : d.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="small muted">{t('No dividends so far.')}</p>
        ))}
    </div>
  );
}

function ReportCard({ report: r }: { report: CompanyReport }) {
  return (
    <article className="card flat stack-sm">
      <div className="spread">
        <div>
          <span className="badge info">{r.period}</span> <b>{r.title}</b>
        </div>
        <span className="small muted">{formatDate(r.publishedAt, false)}</span>
      </div>
      {(r.revenue || r.profit) && (
        <div className="row-wrap small">
          {r.revenue && (
            <span>
              {t('Revenue')} <b>{formatMoney(r.revenue, r.currency)}</b>
            </span>
          )}
          {r.profit && (
            <span>
              {r.profit.startsWith('-') ? t('Loss') : t('Profit')}{' '}
              <b className={r.profit.startsWith('-') ? 'neg' : 'pos'}>
                {formatMoney(r.profit.replace(/^-/, ''), r.currency)}
              </b>
            </span>
          )}
        </div>
      )}
      <p className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
        {r.body}
      </p>
      {r.files.length > 0 && <AttachmentList files={r.files} href={api.files.url} />}
    </article>
  );
}

function ProposalCard({ proposal: p }: { proposal: Proposal }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const vote = useMutation({
    mutationFn: (option: string) => api.stock.vote(p.id, option),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['stock', 'proposals'] });
      toast.success(
        t(
          'Voted “{0}” with {1}',
          updated.options.find((o) => o.key === updated.myVote)?.label ?? '',
          plural(Number(updated.myShares), 'share'),
        ),
      );
    },
  });
  const voted = Number(p.votedShares);
  const canVote = p.status === 'open' && Number(p.myShares) > 0 && !p.myVote;
  return (
    <article className="card flat stack-sm">
      <div className="spread">
        <b>{p.title}</b>
        <StatusBadge status={p.status} />
      </div>
      <p className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
        {p.description}
      </p>
      <ShareBar
        parts={p.options.map((o, i) => ({
          label: o.label,
          value: Number(o.shares),
          color: ['var(--success)', 'var(--danger)', 'var(--text-3)', 'var(--accent)'][i % 4]!,
        }))}
      />
      <div className="row-wrap small">
        {p.options.map((o) => (
          <span key={o.key}>
            {o.label}: <b>{voted ? Math.round((Number(o.shares) / voted) * 100) : 0}%</b>{' '}
            <span className="muted">{t('({0} shares)', o.shares)}</span>
            {p.winner === o.key && ' ✓'}
          </span>
        ))}
      </div>
      <div className="small muted">
        {t('Turnout')} {p.turnoutPercent}
        {t('% of')} {p.totalShares} {t('shares ·')}{' '}
        {p.status === 'open'
          ? t('closes {0}', formatDate(p.closesAt))
          : t('closed {0}', formatDate(p.closesAt))}
        {p.myVote &&
          ` · you voted “${p.options.find((o) => o.key === p.myVote)?.label}” with ${p.myShares} shares`}
        {p.status === 'open' &&
          Number(p.myShares) === 0 &&
          ` ${t('· only shareholders at the start can vote')}`}
      </div>
      <ErrorAlert error={vote.error} />
      {canVote && (
        <div className="row-wrap">
          {p.options.map((o) => (
            <button
              key={o.key}
              className="btn sm"
              disabled={vote.isPending}
              onClick={() => vote.mutate(o.key)}
            >
              {t('Vote {0}', o.label)}
            </button>
          ))}
        </div>
      )}
    </article>
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
  const gate = useRiskGate();
  const place = useMutation({
    mutationFn: () => api.stock.placeOrder(l.ticker, { side, shares: Number(shares), price }),
    onError: (error) => gate.onError(error, () => place.mutate()),
    onSuccess: ({ order, trades }) => {
      refresh();
      const traded = trades.reduce((n, t) => n + Number(t.shares), 0);
      toast.success(
        traded
          ? (side === 'buy' ? t('Bought {0} {1}', traded, l.ticker) : t('Sold {0} {1}', traded, l.ticker)) +
              (order.status === 'open' ? t('; {0} left in the book', order.remaining) : '')
          : side === 'buy'
            ? t(
                'Buy order placed: {0} {1} at {2}',
                order.shares,
                l.ticker,
                formatMoney(order.price, l.currency),
              )
            : t(
                'Sell order placed: {0} {1} at {2}',
                order.shares,
                l.ticker,
                formatMoney(order.price, l.currency),
              ),
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
          <td className="right num">{Number(r.shares).toLocaleString(intlLocale())}</td>
          <td className="right small muted">{r.orders}</td>
        </tr>
      ))
    ) : (
      <tr>
        <td colSpan={3} className="small muted">
          {t('No {0} orders', kind === 'bid' ? 'buy' : 'sell')}
        </td>
      </tr>
    );
  return (
    <div className="grid-2">
      <div className="card stack">
        <div className="spread">
          <h3>{t('Order book')}</h3>
          <span className="small muted">
            {t('Last trade {0}', b ? formatMoney(b.lastPrice, l.currency) : '—')}
          </span>
        </div>
        <ErrorAlert error={book.error} />
        <div className="grid-2" style={{ gap: 12 }}>
          <table className="table" aria-label={t('Buy orders')}>
            <thead>
              <tr>
                <th>{t('Bid')}</th>
                <th className="right">{t('Shares')}</th>
                <th className="right">{t('Orders')}</th>
              </tr>
            </thead>
            <tbody>{b && levels(b.bids, 'bid')}</tbody>
          </table>
          <table className="table" aria-label={t('Sell orders')}>
            <thead>
              <tr>
                <th>{t('Ask')}</th>
                <th className="right">{t('Shares')}</th>
                <th className="right">{t('Orders')}</th>
              </tr>
            </thead>
            <tbody>{b && levels(b.asks, 'ask')}</tbody>
          </table>
        </div>
        <h3>{t('Latest trades')}</h3>
        {b?.trades.length ? (
          <table className="table">
            <tbody>
              {b.trades.slice(0, 8).map((trade) => (
                <tr key={trade.id}>
                  <td className="small nowrap">{formatDate(trade.at)}</td>
                  <td className={trade.side === 'buy' ? 'pos' : 'neg'}>
                    {formatMoney(trade.price, l.currency)}
                  </td>
                  <td className="right num">{trade.shares}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="small muted">
            {t('No trades yet: shares change hands once a buy and a sell order meet.')}
          </p>
        )}
      </div>
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (side === 'buy') gate.guard(() => place.mutate());
          else place.mutate();
        }}
      >
        <h3>{t('Trade with other investors')}</h3>
        <p className="small muted" style={{ margin: 0 }}>
          {t(
            'A limit order trades at once with the best matching orders, at their price; the rest waits in the book until you cancel it. Shares from an investment can be sold after its {0}-day lock.',
            l.lockDays,
          )}
        </p>
        <Segmented<OrderSide>
          value={side}
          onChange={setSide}
          options={[
            { value: 'buy', label: t('Buy') },
            { value: 'sell', label: t('Sell') },
          ]}
        />
        {holding && (
          <div className="alert info small">
            {t('You hold')} {holding.shares} {l.ticker}: {holding.sellable} {t('can be sold')}
            {Number(holding.locked) > 0 && t(', {0} still locked', holding.locked)}
            {Number(holding.onSale) > 0 && t(', {0} already offered', holding.onSale)}.
          </div>
        )}
        <div className="grid-2" style={{ gap: 12 }}>
          <Field label={t('Shares')}>
            <input
              className="input"
              inputMode="numeric"
              value={shares}
              onChange={(e) => setShares(e.target.value.replace(/\D/g, ''))}
              required
            />
          </Field>
          <Field label={t('Limit price ({0})', l.currency)}>
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
            <span className="muted">{side === 'buy' ? t('At most') : t('At least')}</span>
            <b>{formatMoney(total, l.currency)}</b>
          </div>
        )}
        <ErrorAlert error={(gate.isGateError(place.error) ? null : place.error) ?? cancel.error} />
        <button
          className={`btn ${side === 'buy' ? 'primary' : 'danger'}`}
          disabled={place.isPending || l.status !== 'active' || !shares || !price}
        >
          {side === 'buy' ? t('Place buy order') : t('Place sell order')}
        </button>
        {mine.length > 0 && (
          <div className="stack-sm">
            <h3>{t('Your open orders')}</h3>
            {mine.map((o) => (
              <div key={o.id} className="spread small">
                <span>
                  <b className={o.side === 'buy' ? 'pos' : 'neg'}>
                    {o.side === 'buy' ? t('Buy') : t('Sell')}
                  </b>{' '}
                  {o.remaining}
                  {o.remaining !== o.shares && ` ${t('of {0}', o.shares)}`} {t('at')}{' '}
                  {formatMoney(o.price, l.currency)}
                </span>
                <button type="button" className="btn ghost sm" onClick={() => cancel.mutate(o.id)}>
                  {t('Cancel')}
                </button>
              </div>
            ))}
          </div>
        )}
      </form>
      {gate.modal}
    </div>
  );
}

export function PortfolioPage() {
  const portfolio = useQuery({ queryKey: ['portfolio'], queryFn: api.stock.portfolio });
  return (
    <div className="page stack-lg">
      <PageHeader
        icon="pie"
        title={t('My portfolio')}
        actions={
          <Link className="btn" to="/exchange">
            {t('Back to the exchange')}
          </Link>
        }
      />
      {portfolio.isLoading && <Spinner center />}
      <ErrorAlert error={portfolio.error} />
      <div className="card pad-0 table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t('Ticker')}</th>
              <th>{t('Company')}</th>
              <th className="right">{t('Shares')}</th>
              <th className="right">{t('Can sell')}</th>
              <th className="right">{t('Invested')}</th>
              <th className="right">{t('Current value')}</th>
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
                  {Number(h.locked) > 0 && <div className="tiny muted">{t('{0} locked', h.locked)}</div>}
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
        {portfolio.data?.holdings.length === 0 && <Empty title={t('You have no investments yet')} />}
      </div>
      {!!portfolio.data?.investments.length && (
        <div className="card pad-0 table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('Date')}</th>
                <th>{t('Ticker')}</th>
                <th className="right">{t('Shares')}</th>
                <th className="right">{t('Amount')}</th>
                <th>{t('Frozen part unlocks')}</th>
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
