import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../state/query.dart';
import '../state/session.dart';
import '../theme/theme.dart';
import '../ui/chart.dart';
import '../ui/format.dart';
import '../ui/widgets.dart';
import 'applications.dart';
import 'chats.dart';
import 'stories.dart';
import 'wallet.dart';
import '../i18n/i18n.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final me = session.me!;
    final q = session.queries;
    final api = session.api;
    final wide = MediaQuery.sizeOf(context).width >= 1000;

    Future<void> refresh() async {
      for (final k in ['wallets', 'chats', 'orgs', 'portfolio', 'applications', 'listings', 'stories']) {
        q.invalidate(k);
      }
    }

    final left = [
      FadeSlideIn(child: _Hero(me: me)),
      const SizedBox(height: 18),
      const FadeSlideIn(delay: Duration(milliseconds: 80), child: _QuickActions()),
      const SizedBox(height: 18),
      const StoriesBar(),
      const SizedBox(height: 10),
      FadeSlideIn(
        delay: const Duration(milliseconds: 160),
        child: _Kpis(session: session),
      ),
      if (me.isStaff) ...[const SizedBox(height: 18), _StaffBanner(session: session)],
    ];
    final recent = OvlCard(
      padding: const EdgeInsets.fromLTRB(4, 14, 4, 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14),
            child: SectionHeader(
              tr('Recent conversations'),
              action: tr('All chats'),
              onAction: () => context.go('/chats'),
            ),
          ),
          Query<List<Chat>>(
            client: q,
            queryKey: 'chats',
            fetch: api.chats,
            builder: (context, s) {
              if (!s.hasData) return const SkeletonList(rows: 3);
              final chats = [...s.data!]..sort((a, b) => b.activityAt.compareTo(a.activityAt));
              if (chats.isEmpty) {
                return EmptyState(icon: LucideIcons.messageCircle, title: tr('No conversations yet'));
              }
              return Column(
                children: [
                  for (final (i, c) in chats.take(4).indexed)
                    FadeSlideIn(
                      delay: stagger(i),
                      child: ChatTile(chat: c, onTap: () => context.go('/chats/${c.id}')),
                    ),
                ],
              );
            },
          ),
        ],
      ),
    );
    final applications = Query<List<Application>>(
      client: q,
      queryKey: 'applications:mine',
      fetch: api.myApplications,
      builder: (context, s) => OvlCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SectionHeader(tr('Your applications'), action: tr('View all'), onAction: () => context.go('/applications')),
            if (!s.hasData)
              const Skeleton(height: 60)
            else if (s.data!.isEmpty)
              Text(
                tr('Nothing submitted yet. Register a company or request a license.'),
                style: context.text.bodyMedium,
              )
            else
              for (final a in s.data!.take(3))
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(color: context.c.surface2, borderRadius: BorderRadius.circular(14)),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(child: Text(a.title, style: context.text.titleSmall)),
                            StatusPill(a.status),
                          ],
                        ),
                        const SizedBox(height: 8),
                        WorkflowSteps(application: a),
                      ],
                    ),
                  ),
                ),
          ],
        ),
      ),
    );
    final exchange = Query<List<StockListing>>(
      client: q,
      queryKey: 'listings',
      fetch: api.listings,
      builder: (context, s) => OvlCard(
        padding: const EdgeInsets.fromLTRB(4, 14, 4, 6),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14),
              child: SectionHeader(tr('Exchange'), action: tr('Open market'), onAction: () => context.go('/exchange')),
            ),
            if (!s.hasData)
              const SkeletonList(rows: 3)
            else if (s.data!.isEmpty)
              EmptyState(icon: LucideIcons.chartLine, title: tr('No listed companies yet'))
            else
              for (final l in s.data!.take(4))
                ListTile(
                  onTap: () => context.go('/exchange/${l.ticker}'),
                  leading: TickerBadge(l.ticker),
                  title: Text(l.organizationName, overflow: TextOverflow.ellipsis),
                  subtitle: Text(
                    tr('{0} · {1}% frozen', [plural(l.investorsCount, 'investor'), l.freezePercent.round()]),
                  ),
                  trailing: Text(money(l.sharePrice, l.currency), style: context.text.titleSmall),
                ),
          ],
        ),
      ),
    );

    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: PageBody(
          onRefresh: refresh,
          children: wide
              ? [
                  ...left,
                  const SizedBox(height: 18),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(child: recent),
                      const SizedBox(width: 18),
                      Expanded(child: Column(children: [applications, const SizedBox(height: 18), exchange])),
                    ],
                  ),
                ]
              : [
                  ...left,
                  const SizedBox(height: 18),
                  recent,
                  const SizedBox(height: 18),
                  applications,
                  const SizedBox(height: 18),
                  exchange,
                ],
        ),
      ),
    );
  }
}

class _Hero extends StatelessWidget {
  const _Hero({required this.me});

  final Me me;

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final c = context.c;
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(26),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color.lerp(c.gradFrom, Colors.black, 0.35)!, Color.lerp(c.gradTo, Colors.black, 0.2)!],
        ),
        boxShadow: [BoxShadow(color: c.gradFrom.withValues(alpha: 0.3), blurRadius: 30, offset: const Offset(0, 14))],
      ),
      child: Wrap(
        alignment: WrapAlignment.spaceBetween,
        crossAxisAlignment: WrapCrossAlignment.center,
        runSpacing: 18,
        spacing: 18,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                DateFormat('EEEE, MMMM d').format(DateTime.now()).toUpperCase(),
                style: font(body, 11.5, FontWeight.w700, letterSpacing: 1.2, color: Colors.white70),
              ),
              const SizedBox(height: 6),
              Text(
                '${greeting()}, ${me.firstName}',
                style: font(display, 28, FontWeight.w800, color: Colors.white, letterSpacing: -0.6),
              ),
              const SizedBox(height: 4),
              Query<List<Chat>>(
                client: session.queries,
                queryKey: 'chats',
                fetch: session.api.chats,
                builder: (context, s) {
                  final unread = (s.data ?? const <Chat>[]).fold<int>(0, (n, c) => n + c.unreadCount);
                  return Text(
                    unread > 0 ? plural(unread, 'unread message') : tr('You are all caught up'),
                    style: const TextStyle(color: Colors.white70, fontSize: 14.5),
                  );
                },
              ),
            ],
          ),
          Query<List<Wallet>>(
            client: session.queries,
            queryKey: 'wallets',
            fetch: session.api.wallets,
            builder: (context, s) {
              final wallets = [...?s.data]
                ..sort((a, b) => (double.tryParse(b.balance) ?? 0).compareTo(double.tryParse(a.balance) ?? 0));
              final primary = wallets.firstOrNull;
              return Container(
                width: MediaQuery.sizeOf(context).width < 600 ? double.infinity : null,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: Colors.white.withValues(alpha: 0.18)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(LucideIcons.wallet, size: 14, color: Colors.white70),
                        const SizedBox(width: 6),
                        Text(
                          primary == null ? tr('BALANCE') : tr('{0} BALANCE', [primary.currency]),
                          style: font(body, 11, FontWeight.w700, letterSpacing: 0.8, color: Colors.white70),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    if (!s.hasData)
                      const SizedBox(width: 160, child: Skeleton(height: 30))
                    else if (primary == null)
                      Text(tr('No balance yet'), style: font(display, 20, FontWeight.w800, color: Colors.white))
                    else
                      AnimatedAmount(
                        value: primary.balance,
                        format: (v) => money(v, primary.currency),
                        style: font(display, 28, FontWeight.w800, color: Colors.white),
                      ),
                    if (wallets.length > 1)
                      Text(
                        '+${plural(wallets.length - 1, 'more currency', 'more currencies')}',
                        style: const TextStyle(color: Colors.white70, fontSize: 12),
                      ),
                  ],
                ),
              );
            },
          ),
        ],
      ),
    );
  }
}

class _QuickActions extends StatelessWidget {
  const _QuickActions();

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final actions = <(IconData, String, Color, VoidCallback)>[
      (LucideIcons.send, 'Send money', c.accent, () => showTransferSheet(context)),
      (LucideIcons.messageCircle, 'Messages', c.council, () => context.go('/chats')),
      (LucideIcons.chartLine, 'Invest', c.success, () => context.go('/exchange')),
      (LucideIcons.building2, 'New company', c.warning, () => context.go('/applications/new/company')),
      (LucideIcons.bookOpen, 'Registry', c.support, () => context.go('/registry')),
      (LucideIcons.lifeBuoy, 'Support', c.danger, () => context.go('/support')),
    ];
    return LayoutBuilder(
      builder: (context, box) {
        final columns = box.maxWidth > 760 ? 6 : 3;
        final w = (box.maxWidth - 10 * (columns - 1)) / columns;
        return Wrap(
          spacing: 10,
          runSpacing: 10,
          children: [
            for (final a in actions)
              SizedBox(
                width: w,
                child: OvlCard(
                  padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 6),
                  onTap: a.$4,
                  child: Column(
                    children: [
                      Container(
                        width: 42,
                        height: 42,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(13),
                          gradient: LinearGradient(colors: [a.$3, Color.lerp(a.$3, Colors.black, 0.25)!]),
                          boxShadow: [
                            BoxShadow(color: a.$3.withValues(alpha: 0.35), blurRadius: 10, offset: const Offset(0, 4)),
                          ],
                        ),
                        child: Icon(a.$1, size: 19, color: Colors.white),
                      ),
                      const SizedBox(height: 9),
                      Text(
                        tr(a.$2),
                        textAlign: TextAlign.center,
                        style: context.text.labelMedium?.copyWith(color: c.text),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

class _Kpis extends StatelessWidget {
  const _Kpis({required this.session});

  final Session session;

  @override
  Widget build(BuildContext context) {
    final q = session.queries;
    final api = session.api;
    Widget kpi(IconData icon, String label, Widget value) => OvlCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              IconTile(icon, size: 30),
              const SizedBox(width: 10),
              Expanded(child: Caption(label)),
            ],
          ),
          const SizedBox(height: 12),
          DefaultTextStyle.merge(style: context.text.headlineMedium, child: value),
        ],
      ),
    );
    final items = [
      kpi(
        LucideIcons.messageCircle,
        'Unread',
        Query<List<Chat>>(
          client: q,
          queryKey: 'chats',
          fetch: api.chats,
          builder: (_, s) => Text('${s.data?.fold<int>(0, (a, c) => a + c.unreadCount) ?? '–'}'),
        ),
      ),
      kpi(
        LucideIcons.building2,
        'Companies',
        Query<List<Organization>>(
          client: q,
          queryKey: 'orgs:mine',
          fetch: api.myOrganizations,
          builder: (_, s) => Text('${s.data?.length ?? '–'}'),
        ),
      ),
      kpi(
        LucideIcons.chartPie,
        'Portfolio',
        Query<Portfolio>(
          client: q,
          queryKey: 'portfolio',
          fetch: api.portfolio,
          builder: (_, s) {
            final holdings = s.data?.holdings ?? const <Holding>[];
            if (holdings.isEmpty) return const Text('–');
            final byCurrency = <String, double>{};
            for (final h in holdings) {
              byCurrency[h.currency] = (byCurrency[h.currency] ?? 0) + (double.tryParse(h.currentValue) ?? 0);
            }
            final top = byCurrency.entries.reduce((a, b) => a.value >= b.value ? a : b);
            return FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(moneyOf(top.value, top.key)),
            );
          },
        ),
      ),
      kpi(
        LucideIcons.fileText,
        'In review',
        Query<List<Application>>(
          client: q,
          queryKey: 'applications:mine',
          fetch: api.myApplications,
          builder: (_, s) => Text('${s.data?.where((a) => a.status == 'pending').length ?? '–'}'),
        ),
      ),
    ];
    return LayoutBuilder(
      builder: (context, box) {
        final columns = box.maxWidth > 760 ? 4 : 2;
        final w = (box.maxWidth - 12 * (columns - 1)) / columns;
        return Wrap(
          spacing: 12,
          runSpacing: 12,
          children: [for (final i in items) SizedBox(width: w, child: i)],
        );
      },
    );
  }
}

class _StaffBanner extends StatelessWidget {
  const _StaffBanner({required this.session});

  final Session session;

  @override
  Widget build(BuildContext context) {
    return Query<List<Application>>(
      client: session.queries,
      queryKey: 'applications:queue',
      fetch: session.api.reviewQueue,
      builder: (context, s) {
        final n = s.data?.length ?? 0;
        if (n == 0) return const SizedBox.shrink();
        final c = context.c;
        return FadeSlideIn(
          child: Material(
            color: c.warningSoft,
            borderRadius: BorderRadius.circular(18),
            child: InkWell(
              borderRadius: BorderRadius.circular(18),
              onTap: () => context.go('/review'),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    Icon(LucideIcons.clipboardCheck, color: c.warning),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        tr('{0} waiting for your decision', [plural(n, 'application')]),
                        style: context.text.titleSmall,
                      ),
                    ),
                    Icon(LucideIcons.arrowRight, size: 18, color: c.warning),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class TickerBadge extends StatelessWidget {
  const TickerBadge(this.ticker, {super.key, this.size = 42});

  final String ticker;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(gradient: context.ovl.gradient, borderRadius: BorderRadius.circular(size * 0.3)),
      child: FittedBox(
        child: Padding(
          padding: const EdgeInsets.all(4),
          child: Text(ticker, style: font(display, 12, FontWeight.w800, color: Colors.white, letterSpacing: 0.4)),
        ),
      ),
    );
  }
}

/// Used by listing rows: price history as a tiny chart.
class ListingSpark extends StatelessWidget {
  const ListingSpark(this.listing, {super.key});

  final StockListing listing;

  @override
  Widget build(BuildContext context) => Sparkline(listing.priceHistory.map((p) => p.value).toList());
}
