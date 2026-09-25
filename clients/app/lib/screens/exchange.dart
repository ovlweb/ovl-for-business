import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../state/query.dart';
import '../state/session.dart';
import '../theme/theme.dart';
import '../ui/chart.dart';
import '../ui/format.dart';
import '../ui/widgets.dart';
import 'contacts.dart';
import 'home.dart';

class ExchangeScreen extends StatelessWidget {
  const ExchangeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Query<List<StockListing>>(
          client: session.queries,
          queryKey: 'listings',
          fetch: session.api.listings,
          builder: (context, s) => PageBody(
            onRefresh: () => s.fetch(),
            children: [
              PageTitle(
                icon: LucideIcons.chartLine,
                title: 'Stock exchange',
                subtitle: 'Invest in approved companies. Part of every investment is frozen for 3–6 months.',
                actions: [
                  OutlinedButton.icon(
                    onPressed: () => context.go('/exchange/portfolio'),
                    icon: const Icon(LucideIcons.chartPie, size: 17),
                    label: const Text('My portfolio'),
                  ),
                ],
              ),
              const SizedBox(height: 18),
              if (!s.hasData)
                const SkeletonList()
              else if (s.data!.isEmpty)
                const EmptyState(icon: LucideIcons.chartLine, title: 'No listed companies yet')
              else
                for (final (i, l) in s.data!.indexed)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: FadeSlideIn(
                      delay: stagger(i),
                      child: _ListingCard(listing: l),
                    ),
                  ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ListingCard extends StatelessWidget {
  const _ListingCard({required this.listing});

  final StockListing listing;

  @override
  Widget build(BuildContext context) {
    final l = listing;
    final sold =
        (double.tryParse(l.sharesSold) ?? 0) / ((double.tryParse(l.totalShares) ?? 1).clamp(1, double.infinity));
    return OvlCard(
      onTap: () => context.go('/exchange/${l.ticker}'),
      child: Row(
        children: [
          Hero(tag: 'ticker-${l.ticker}', child: TickerBadge(l.ticker, size: 50)),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(l.organizationName, style: context.text.titleMedium, overflow: TextOverflow.ellipsis),
                    ),
                    if (l.status != 'active') StatusPill(l.status),
                  ],
                ),
                const SizedBox(height: 3),
                Text(
                  '${plural(l.investorsCount, 'investor')} · ${l.freezePercent.round()}% frozen for ${l.lockDays} d',
                  style: context.text.bodySmall,
                ),
                const SizedBox(height: 8),
                ClipRRect(
                  borderRadius: BorderRadius.circular(99),
                  child: LinearProgressIndicator(value: sold, minHeight: 5),
                ),
                const SizedBox(height: 3),
                Text('${(sold * 100).toStringAsFixed(1)}% of shares sold', style: context.text.bodySmall),
              ],
            ),
          ),
          const SizedBox(width: 14),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(money(l.sharePrice, l.currency), style: context.text.titleMedium),
              const SizedBox(height: 4),
              Text('Cap ${money(l.marketCap, l.currency)}', style: context.text.bodySmall),
            ],
          ),
        ],
      ),
    );
  }
}

class ChangeBadge extends StatelessWidget {
  const ChangeBadge(this.change, {super.key});

  final double? change;

  @override
  Widget build(BuildContext context) {
    if (change == null) return const SizedBox.shrink();
    final c = context.c;
    final up = change! >= 0;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: up ? c.successSoft : c.dangerSoft, borderRadius: BorderRadius.circular(99)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(up ? LucideIcons.arrowUpRight : LucideIcons.arrowDownRight, size: 13, color: up ? c.success : c.danger),
          const SizedBox(width: 3),
          Text(
            '${up ? '+' : ''}${change!.toStringAsFixed(2)}%',
            style: font(body, 12, FontWeight.w800, color: up ? c.success : c.danger),
          ),
        ],
      ),
    );
  }
}

class ListingScreen extends StatelessWidget {
  const ListingScreen({super.key, required this.ticker});

  final String ticker;

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    return Scaffold(
      appBar: AppBar(leading: BackButton(onPressed: () => context.go('/exchange'))),
      body: Query<StockListing>(
        client: session.queries,
        queryKey: 'listings:$ticker',
        fetch: () => session.api.listing(ticker),
        builder: (context, s) {
          if (!s.hasData) {
            return s.error != null
                ? Padding(padding: const EdgeInsets.all(16), child: ErrorBox(s.error))
                : const Center(child: CircularProgressIndicator());
          }
          final l = s.data!;
          final wide = MediaQuery.sizeOf(context).width >= 1000;
          final chart = OvlCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(child: Text('Price history', style: context.text.titleLarge)),
                    ChangeBadge(l.change),
                  ],
                ),
                const SizedBox(height: 14),
                AreaChart(
                  values: l.priceHistory.map((p) => p.value).toList(),
                  labels: l.priceHistory.map((p) => date(p.at)).toList(),
                  format: (v) => moneyOf(v, l.currency),
                  height: 230,
                ),
                if (l.description.isNotEmpty) ...[
                  const SizedBox(height: 14),
                  Text(l.description, style: context.text.bodyLarge?.copyWith(fontSize: 14)),
                ],
              ],
            ),
          );
          final invest = _InvestCard(listing: l);
          return PageBody(
            children: [
              FadeSlideIn(
                child: Row(
                  children: [
                    Hero(tag: 'ticker-${l.ticker}', child: TickerBadge(l.ticker, size: 56)),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(l.organizationName, style: context.text.headlineLarge),
                          Text(
                            '${l.registryNumber ?? ''} · listed ${date(l.listedAt)}',
                            style: context.text.bodyMedium,
                          ),
                          if (l.verified) ...[const SizedBox(height: 6), const VerifiedBadge()],
                        ],
                      ),
                    ),
                    StatusPill(l.status),
                  ],
                ),
              ),
              const SizedBox(height: 18),
              LayoutBuilder(
                builder: (context, box) {
                  final columns = box.maxWidth > 700 ? 3 : 1;
                  final w = (box.maxWidth - 12 * (columns - 1)) / columns;
                  Widget kpi(String label, String value) => SizedBox(
                    width: w,
                    child: OvlCard(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Caption(label),
                          const SizedBox(height: 8),
                          FittedBox(
                            fit: BoxFit.scaleDown,
                            alignment: Alignment.centerLeft,
                            child: Text(value, style: context.text.headlineMedium),
                          ),
                        ],
                      ),
                    ),
                  );
                  return Wrap(
                    spacing: 12,
                    runSpacing: 12,
                    children: [
                      kpi('Share price', money(l.sharePrice, l.currency)),
                      kpi('Market cap', money(l.marketCap, l.currency)),
                      kpi('Raised · investors', '${money(l.raised, l.currency)} · ${l.investorsCount}'),
                    ],
                  );
                },
              ),
              const SizedBox(height: 16),
              if (wide)
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(flex: 3, child: chart),
                    const SizedBox(width: 16),
                    Expanded(flex: 2, child: invest),
                  ],
                )
              else ...[
                chart,
                const SizedBox(height: 16),
                invest,
              ],
              const SizedBox(height: 16),
              _Market(listing: l),
              const SizedBox(height: 16),
              _ForShareholders(ticker: l.ticker),
            ],
          );
        },
      ),
    );
  }
}

/// Results the company published and shareholder votes (with voting).
class _ForShareholders extends StatelessWidget {
  const _ForShareholders({required this.ticker});

  final String ticker;

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final c = context.c;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Query<List<Proposal>>(
          client: session.queries,
          queryKey: 'listings:$ticker:proposals',
          fetch: () => session.api.proposals(ticker),
          builder: (context, s) {
            final list = s.data ?? const <Proposal>[];
            if (list.isEmpty) return const SizedBox.shrink();
            return OvlCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('Shareholder votes', style: context.text.titleLarge),
                  for (final p in list) ...[
                    const Divider(height: 24),
                    Row(
                      children: [
                        Expanded(child: Text(p.title, style: context.text.titleSmall)),
                        StatusPill(p.status),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(p.description, style: context.text.bodyMedium),
                    const SizedBox(height: 6),
                    Text(
                      [
                        for (final o in p.options) '${o.label} ${o.shares}${p.winner == o.key ? ' ✓' : ''}',
                        'turnout ${p.turnoutPercent}%',
                        if (p.myVote != null) 'you voted ${p.options.firstWhere((o) => o.key == p.myVote).label}',
                      ].join(' · '),
                      style: context.text.bodySmall,
                    ),
                    if (p.canVote)
                      Wrap(
                        spacing: 8,
                        children: [
                          for (final o in p.options)
                            OutlinedButton(
                              onPressed: () async {
                                try {
                                  await session.api.vote(p.id, o.key);
                                  session.queries.invalidate('listings');
                                  if (context.mounted) toast(context, 'Voted “${o.label}” with ${p.myShares} shares');
                                } catch (e) {
                                  if (context.mounted) toast(context, errorText(e), error: true);
                                }
                              },
                              child: Text(o.label),
                            ),
                        ],
                      ),
                  ],
                ],
              ),
            );
          },
        ),
        const SizedBox(height: 16),
        Query<List<CompanyReport>>(
          client: session.queries,
          queryKey: 'listings:$ticker:reports',
          fetch: () => session.api.companyReports(ticker),
          builder: (context, s) {
            final list = s.data ?? const <CompanyReport>[];
            if (list.isEmpty) return const SizedBox.shrink();
            return OvlCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('Company results', style: context.text.titleLarge),
                  for (final r in list) ...[
                    const Divider(height: 24),
                    Text('${r.period} · ${r.title}', style: context.text.titleSmall),
                    if (r.revenue != null || r.profit != null)
                      Text(
                        [
                          if (r.revenue != null) 'Revenue ${money(r.revenue!, r.currency)}',
                          if (r.profit != null)
                            r.profit!.startsWith('-')
                                ? 'Loss ${money(r.profit!.substring(1), r.currency)}'
                                : 'Profit ${money(r.profit!, r.currency)}',
                        ].join(' · '),
                        style: font(body, 13, FontWeight.w700, color: c.text2),
                      ),
                    const SizedBox(height: 4),
                    Text(r.body, style: context.text.bodyMedium),
                  ],
                ],
              ),
            );
          },
        ),
      ],
    );
  }
}

/// The order book, your open orders and a buy/sell sheet.
class _Market extends StatelessWidget {
  const _Market({required this.listing});

  final StockListing listing;

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final c = context.c;
    final l = listing;
    return Query<OrderBook>(
      client: session.queries,
      queryKey: 'listings:${l.ticker}:book',
      fetch: () => session.api.orderBook(l.ticker),
      builder: (context, s) {
        final book = s.data;
        Widget side(String title, List<BookLevel> levels, Color color) => Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Caption(title),
              const SizedBox(height: 6),
              if (levels.isEmpty) Text('None', style: context.text.bodySmall),
              for (final lv in levels.take(8))
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          money(lv.price, l.currency, code: false),
                          style: font(body, 13.5, FontWeight.w700, color: color),
                        ),
                      ),
                      Text(lv.shares, style: context.text.bodyMedium),
                    ],
                  ),
                ),
            ],
          ),
        );
        return OvlCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(child: Text('Order book', style: context.text.titleLarge)),
                  if (book != null) Text('Last ${money(book.lastPrice, l.currency)}', style: context.text.bodySmall),
                ],
              ),
              const SizedBox(height: 12),
              if (book == null)
                const SkeletonList(rows: 3)
              else
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    side('Bids (buy)', book.bids, c.success),
                    const SizedBox(width: 18),
                    side('Asks (sell)', book.asks, c.danger),
                  ],
                ),
              const SizedBox(height: 12),
              Text(
                'Shares from an investment can be sold after its ${l.lockDays}-day lock. Orders trade at the '
                'best matching price; the rest waits in the book.',
                style: context.text.bodySmall,
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                children: [
                  FilledButton(
                    onPressed: l.status == 'active' ? () => _orderSheet(context, 'buy', book) : null,
                    child: const Text('Buy'),
                  ),
                  OutlinedButton(
                    onPressed: l.status == 'active' ? () => _orderSheet(context, 'sell', book) : null,
                    child: const Text('Sell'),
                  ),
                ],
              ),
              Query<List<StockOrder>>(
                client: session.queries,
                queryKey: 'portfolio:orders',
                fetch: () => session.api.myOrders(status: 'open'),
                builder: (context, o) {
                  final mine = (o.data ?? const <StockOrder>[]).where((x) => x.ticker == l.ticker).toList();
                  if (mine.isEmpty) return const SizedBox.shrink();
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Divider(height: 24),
                      Text('Your open orders', style: context.text.titleSmall),
                      for (final x in mine)
                        ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          title: Text(
                            '${x.side == 'buy' ? 'Buy' : 'Sell'} ${x.remaining} at ${money(x.price, x.currency)}',
                          ),
                          trailing: TextButton(
                            onPressed: () async {
                              await session.api.cancelOrder(x.id);
                              for (final k in ['portfolio', 'listings', 'wallets']) {
                                session.queries.invalidate(k);
                              }
                            },
                            child: const Text('Cancel'),
                          ),
                        ),
                    ],
                  );
                },
              ),
            ],
          ),
        );
      },
    );
  }

  void _orderSheet(BuildContext context, String side, OrderBook? book) {
    final session = context.read<Session>();
    final shares = TextEditingController();
    final price = TextEditingController(text: book?.lastPrice ?? listing.sharePrice);
    var busy = false;
    Object? error;
    showModalBottomSheet<void>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      builder: (sheet) => StatefulBuilder(
        builder: (sheet, set) => Padding(
          padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.viewInsetsOf(sheet).bottom),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('${side == 'buy' ? 'Buy' : 'Sell'} ${listing.ticker}', style: sheet.text.headlineSmall),
              const SizedBox(height: 14),
              if (error != null) ...[ErrorBox(error), const SizedBox(height: 12)],
              LabeledField(label: 'Shares', controller: shares, icon: LucideIcons.hash, keyboard: TextInputType.number),
              const SizedBox(height: 12),
              LabeledField(
                label: 'Limit price (${listing.currency})',
                controller: price,
                icon: LucideIcons.banknote,
                keyboard: const TextInputType.numberWithOptions(decimal: true),
              ),
              const SizedBox(height: 18),
              GradientButton(
                label: side == 'buy' ? 'Place buy order' : 'Place sell order',
                icon: side == 'buy' ? LucideIcons.arrowDownLeft : LucideIcons.arrowUpRight,
                busy: busy,
                onPressed: () async {
                  set(() {
                    busy = true;
                    error = null;
                  });
                  try {
                    final r = await withRiskDisclosure(
                      sheet,
                      () => session.api.placeOrder(
                        listing.ticker,
                        side: side,
                        shares: int.tryParse(shares.text.trim()) ?? 0,
                        price: price.text.trim().replaceAll(',', '.'),
                      ),
                    );
                    if (r == null) {
                      set(() => busy = false);
                      return;
                    }
                    for (final k in ['portfolio', 'listings', 'wallets']) {
                      session.queries.invalidate(k);
                    }
                    if (sheet.mounted) Navigator.pop(sheet);
                    if (context.mounted) {
                      toast(
                        context,
                        r.traded > 0
                            ? '${side == 'buy' ? 'Bought' : 'Sold'} ${r.traded} ${listing.ticker}'
                                  '${r.order.status == 'open' ? '; ${r.order.remaining} left in the book' : ''}'
                            : 'Order placed',
                      );
                    }
                  } catch (e) {
                    set(() {
                      busy = false;
                      error = e;
                    });
                  }
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _InvestCard extends StatefulWidget {
  const _InvestCard({required this.listing});

  final StockListing listing;

  @override
  State<_InvestCard> createState() => _InvestCardState();
}

class _InvestCardState extends State<_InvestCard> {
  final _amount = TextEditingController();
  bool _busy = false;
  Object? _error;

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final l = widget.listing;
    final price = double.tryParse(l.sharePrice) ?? 0;
    final amount = double.tryParse(_amount.text.replaceAll(',', '.')) ?? 0;
    final shares = price > 0 ? (amount / price).floor() : 0;
    final cost = shares * price;
    final frozen = cost * l.freezePercent / 100;
    return OvlCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Invest', style: context.text.titleLarge),
          const SizedBox(height: 6),
          Text(
            '${plural(int.tryParse(l.sharesAvailable) ?? 0, 'share')} available. ${l.freezePercent.round()}% of your investment is frozen on the company balance for ${l.lockDays} days, the rest is available to the company immediately.',
            style: context.text.bodyMedium,
          ),
          const SizedBox(height: 12),
          Query<List<Wallet>>(
            client: session.queries,
            queryKey: 'wallets',
            fetch: session.api.wallets,
            builder: (context, ws) {
              final wallet = (ws.data ?? const <Wallet>[]).where((w) => w.currency == l.currency).firstOrNull;
              return Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: context.c.accentSoft, borderRadius: BorderRadius.circular(12)),
                child: Text(
                  !ws.hasData
                      ? 'Checking your ${l.currency} balance…'
                      : wallet == null
                      ? 'You have no ${l.currency} balance yet.'
                      : 'Your ${l.currency} balance: ${money(wallet.available, l.currency)}',
                  style: TextStyle(color: context.c.accent2),
                ),
              );
            },
          ),
          const SizedBox(height: 12),
          if (_error != null) ...[ErrorBox(_error), const SizedBox(height: 12)],
          LabeledField(
            label: 'Amount (${l.currency})',
            controller: _amount,
            icon: LucideIcons.banknote,
            hint: money(l.sharePrice, l.currency, code: false),
            keyboard: const TextInputType.numberWithOptions(decimal: true),
            onChanged: (_) => setState(() {}),
          ),
          AnimatedSize(
            duration: const Duration(milliseconds: 250),
            child: shares > 0
                ? Padding(
                    padding: const EdgeInsets.only(top: 10),
                    child: Text(
                      'You buy $shares shares for ${moneyOf(cost, l.currency)}. ${moneyOf(frozen, l.currency)} stays frozen for ${l.lockDays} days.',
                      style: context.text.bodyMedium,
                    ),
                  )
                : const SizedBox(width: double.infinity),
          ),
          const SizedBox(height: 16),
          GradientButton(
            label: 'Invest',
            busy: _busy,
            onPressed: shares <= 0 || l.status != 'active'
                ? null
                : () async {
                    setState(() {
                      _busy = true;
                      _error = null;
                    });
                    try {
                      final inv = await withRiskDisclosure(
                        context,
                        () => session.api.invest(l.ticker, _amount.text.trim().replaceAll(',', '.')),
                      );
                      if (inv == null) return;
                      for (final k in ['wallets', 'entries', 'portfolio', 'listings']) {
                        session.queries.invalidate(k);
                      }
                      _amount.clear();
                      if (context.mounted) toast(context, 'Bought ${inv.shares} shares of ${l.ticker}');
                    } catch (e) {
                      setState(() => _error = e);
                    } finally {
                      if (mounted) setState(() => _busy = false);
                    }
                  },
          ),
        ],
      ),
    );
  }
}

class PortfolioScreen extends StatelessWidget {
  const PortfolioScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final c = context.c;
    return Scaffold(
      appBar: AppBar(
        leading: BackButton(onPressed: () => context.go('/exchange')),
        title: const Text('My portfolio'),
      ),
      body: Query<Portfolio>(
        client: session.queries,
        queryKey: 'portfolio',
        fetch: session.api.portfolio,
        builder: (context, s) {
          if (!s.hasData) return const SkeletonList();
          final p = s.data!;
          if (p.holdings.isEmpty) {
            return EmptyState(
              icon: LucideIcons.chartPie,
              title: 'No investments yet',
              text: 'Browse the exchange and buy your first shares.',
              action: FilledButton(onPressed: () => context.go('/exchange'), child: const Text('Open the exchange')),
            );
          }
          return PageBody(
            children: [
              Text('Holdings', style: context.text.titleLarge),
              const SizedBox(height: 10),
              for (final (i, h) in p.holdings.indexed)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: FadeSlideIn(
                    delay: stagger(i),
                    child: OvlCard(
                      onTap: () => context.go('/exchange/${h.ticker}'),
                      child: Row(
                        children: [
                          TickerBadge(h.ticker),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(h.organizationName, style: context.text.titleMedium),
                                Text(
                                  '${h.shares} shares · invested ${money(h.invested, h.currency)}',
                                  style: context.text.bodySmall,
                                ),
                              ],
                            ),
                          ),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Text(money(h.currentValue, h.currency), style: context.text.titleMedium),
                              Builder(
                                builder: (_) {
                                  final invested = double.tryParse(h.invested) ?? 0;
                                  final change = invested == 0
                                      ? null
                                      : ((double.tryParse(h.currentValue) ?? 0) - invested) / invested * 100;
                                  return ChangeBadge(change);
                                },
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              const SizedBox(height: 14),
              Text('Investments', style: context.text.titleLarge),
              const SizedBox(height: 10),
              OvlCard(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Column(
                  children: [
                    for (final inv in p.investments)
                      ListTile(
                        leading: IconTile(
                          LucideIcons.lock,
                          size: 36,
                          color: inv.unlocksAt.isAfter(DateTime.now()) ? c.warning : c.success,
                        ),
                        title: Text('${inv.ticker} · ${inv.shares} shares'),
                        subtitle: Text(
                          '${money(inv.frozenAmount, inv.currency)} frozen until ${date(inv.unlocksAt)} · bought ${date(inv.createdAt)}',
                        ),
                        trailing: Text(money(inv.amount, inv.currency), style: context.text.titleSmall),
                      ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

/// Runs [action]; when the server wants the risk disclosure accepted first, shows it and runs the
/// action again after the person accepts. Returns null when they decline.
Future<T?> withRiskDisclosure<T>(BuildContext context, Future<T> Function() action) async {
  try {
    return await action();
  } on ApiException catch (e) {
    if (e.code != 'risk_disclosure_required' || !context.mounted) rethrow;
    final session = context.read<Session>();
    final risk = await session.api.riskDisclosure();
    if (!context.mounted) return null;
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: Text(risk.title),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Please read this once before your first investment or trade.'),
              const SizedBox(height: 12),
              for (final point in risk.points)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('•  '),
                      Expanded(child: Text(point)),
                    ],
                  ),
                ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialog, false), child: const Text('Not now')),
          FilledButton(onPressed: () => Navigator.pop(dialog, true), child: const Text('I understand, continue')),
        ],
      ),
    );
    if (ok != true) return null;
    await session.api.acceptRisk(risk.version);
    return action();
  }
}
