import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../state/query.dart';
import '../state/session.dart';
import '../theme/theme.dart';
import '../ui/format.dart';
import '../ui/widgets.dart';
import 'contacts.dart';
import 'home.dart';
import 'wallet.dart';

class CompaniesScreen extends StatelessWidget {
  const CompaniesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Query<List<Organization>>(
          client: session.queries,
          queryKey: 'orgs:mine',
          fetch: session.api.myOrganizations,
          builder: (context, s) => PageBody(
            onRefresh: () => s.fetch(),
            children: [
              PageTitle(
                icon: LucideIcons.building2,
                title: 'Companies',
                subtitle: 'Business accounts you own or work for.',
                actions: [
                  FilledButton.icon(
                    onPressed: () => context.go('/applications/new/company'),
                    icon: const Icon(LucideIcons.plus, size: 17),
                    label: const Text('Register a company'),
                  ),
                ],
              ),
              const SizedBox(height: 18),
              if (!s.hasData)
                const SkeletonList()
              else if (s.data!.isEmpty)
                EmptyState(
                  icon: LucideIcons.building2,
                  title: 'No companies yet',
                  text: 'Apply for a business account — moderation and the council review it, then it appears in the registry.',
                  action: FilledButton(
                    onPressed: () => context.go('/applications/new/company'),
                    child: const Text('Start an application'),
                  ),
                )
              else
                LayoutBuilder(
                  builder: (context, box) {
                    final columns = box.maxWidth > 760 ? 2 : 1;
                    final w = (box.maxWidth - 14 * (columns - 1)) / columns;
                    return Wrap(
                      spacing: 14,
                      runSpacing: 14,
                      children: [
                        for (final (i, o) in s.data!.indexed)
                          SizedBox(
                            width: w,
                            child: FadeSlideIn(
                              delay: stagger(i),
                              child: _CompanyCard(org: o),
                            ),
                          ),
                      ],
                    );
                  },
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CompanyCard extends StatelessWidget {
  const _CompanyCard({required this.org});

  final Organization org;

  @override
  Widget build(BuildContext context) {
    return OvlCard(
      onTap: () => context.go('/companies/${org.slug}'),
      child: Row(
        children: [
          org.ticker != null
              ? TickerBadge(org.ticker!, size: 52)
              : IconTile(LucideIcons.building2, size: 52, gradient: context.ovl.gradient),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(org.name, style: context.text.titleLarge, overflow: TextOverflow.ellipsis),
                    ),
                    if (org.verified) ...[const VerifiedBadge(compact: true), const SizedBox(width: 6)],
                    StatusPill(org.status),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  '${org.registryNumber ?? 'Not registered'} · ${humanize(org.myRole ?? 'member')} · ${plural(org.memberCount, 'member')}',
                  style: context.text.bodySmall,
                ),
                if (org.description.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(org.description, maxLines: 2, overflow: TextOverflow.ellipsis, style: context.text.bodyMedium),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class CompanyScreen extends StatelessWidget {
  const CompanyScreen({super.key, required this.slug});

  final String slug;

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    return Scaffold(
      appBar: AppBar(leading: BackButton(onPressed: () => context.go('/companies'))),
      body: Query<Organization>(
        client: session.queries,
        queryKey: 'orgs:$slug',
        fetch: () => session.api.organization(slug),
        builder: (context, s) {
          if (!s.hasData) {
            return s.error != null
                ? Padding(padding: const EdgeInsets.all(16), child: ErrorBox(s.error))
                : const Center(child: CircularProgressIndicator());
          }
          final o = s.data!;
          return PageBody(
            children: [
              FadeSlideIn(
                child: Row(
                  children: [
                    o.ticker != null
                        ? TickerBadge(o.ticker!, size: 58)
                        : IconTile(LucideIcons.building2, size: 58, gradient: context.ovl.gradient),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(o.name, style: context.text.headlineLarge),
                          Text(
                            '${o.registryNumber ?? ''} · owner @${o.owner.username}',
                            style: context.text.bodyMedium,
                          ),
                          if (o.verified) ...[const SizedBox(height: 6), const VerifiedBadge()],
                        ],
                      ),
                    ),
                    StatusPill(o.status),
                  ],
                ),
              ),
              const SizedBox(height: 18),
              OvlCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('About', style: context.text.titleLarge),
                    const SizedBox(height: 8),
                    Text(o.description, style: context.text.bodyLarge),
                    const SizedBox(height: 14),
                    Wrap(
                      spacing: 18,
                      runSpacing: 8,
                      children: [
                        if (o.website != null) _Fact(LucideIcons.globe, o.website!),
                        if (o.country != null && o.country!.isNotEmpty) _Fact(LucideIcons.mapPin, o.country!),
                        _Fact(LucideIcons.coins, 'Base currency ${o.baseCurrency}'),
                        _Fact(LucideIcons.users, plural(o.memberCount, 'member')),
                        _Fact(LucideIcons.calendar, 'Since ${date(o.createdAt)}'),
                      ],
                    ),
                    if (o.ticker != null) ...[
                      const SizedBox(height: 14),
                      OutlinedButton.icon(
                        onPressed: () => context.go('/exchange/${o.ticker}'),
                        icon: const Icon(LucideIcons.chartLine, size: 17),
                        label: Text('${o.ticker} on the exchange'),
                      ),
                    ],
                  ],
                ),
              ),
              if (o.canSeeMoney) ...[
                const SizedBox(height: 18),
                Text('Company balances', style: context.text.titleLarge),
                const SizedBox(height: 10),
                Query<List<Wallet>>(
                  client: session.queries,
                  queryKey: 'orgs:${o.id}:wallets',
                  fetch: () => session.api.organizationWallets(o.id),
                  builder: (context, w) => !w.hasData
                      ? const Skeleton(height: 170, radius: 22)
                      : w.data!.isEmpty
                      ? Text('No balances yet.', style: context.text.bodyMedium)
                      : _CompanyWallets(wallets: w.data!),
                ),
              ],
            ],
          );
        },
      ),
    );
  }
}

class _CompanyWallets extends StatefulWidget {
  const _CompanyWallets({required this.wallets});

  final List<Wallet> wallets;

  @override
  State<_CompanyWallets> createState() => _CompanyWalletsState();
}

class _CompanyWalletsState extends State<_CompanyWallets> {
  String? _selected;

  @override
  Widget build(BuildContext context) {
    final selected = widget.wallets.where((w) => w.id == _selected).firstOrNull ?? widget.wallets.first;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        WalletCards(wallets: widget.wallets, selected: selected.id, onSelect: (w) => setState(() => _selected = w.id)),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            OutlinedButton.icon(
              onPressed: () => showCashRequestSheet(context, selected, 'deposit'),
              icon: const Icon(LucideIcons.arrowDownLeft, size: 17),
              label: const Text('Deposit'),
            ),
            OutlinedButton.icon(
              onPressed: () => showCashRequestSheet(context, selected, 'withdrawal'),
              icon: const Icon(LucideIcons.arrowUpRight, size: 17),
              label: const Text('Withdraw'),
            ),
          ],
        ),
        CashRequests(wallet: selected),
        const SizedBox(height: 16),
        Statement(wallet: selected),
      ],
    );
  }
}

class _Fact extends StatelessWidget {
  const _Fact(this.icon, this.text);

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Icon(icon, size: 15, color: context.c.text3),
      const SizedBox(width: 6),
      Text(text, style: context.text.bodyMedium),
    ],
  );
}
