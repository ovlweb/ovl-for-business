import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';

import '../api/currencies.g.dart';
import '../api/models.dart';
import '../state/query.dart';
import '../state/session.dart';
import '../theme/theme.dart';
import '../ui/format.dart';
import '../ui/widgets.dart';
import 'contacts.dart';

const _cardGradients = [
  [Color(0xFF1E3A8A), Color(0xFF2563EB), Color(0xFF7C3AED)],
  [Color(0xFF064E3B), Color(0xFF059669), Color(0xFF0EA5E9)],
  [Color(0xFF312E81), Color(0xFF7C3AED), Color(0xFFDB2777)],
  [Color(0xFF7C2D12), Color(0xFFEA580C), Color(0xFFF59E0B)],
  [Color(0xFF0F172A), Color(0xFF334155), Color(0xFF64748B)],
  [Color(0xFF134E4A), Color(0xFF0D9488), Color(0xFF22D3EE)],
];
const _currencyCard = {'EUR': 0, 'USD': 1, 'GBP': 4, 'JPY': 3, 'CHF': 2, 'CNY': 3, 'RUB': 5};

LinearGradient cardGradient(String currency) {
  final i =
      _currencyCard[currency] ??
      currency.codeUnits.fold<int>(0, (h, c) => (h * 31 + c) & 0x7fffffff) % _cardGradients.length;
  return LinearGradient(colors: _cardGradients[i], begin: Alignment.topLeft, end: Alignment.bottomRight);
}

class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key});

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  String? _selected;

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Query<List<Wallet>>(
          client: session.queries,
          queryKey: 'wallets',
          fetch: session.api.wallets,
          builder: (context, s) {
            final wallets = s.data ?? const <Wallet>[];
            final selected = wallets.where((w) => w.id == _selected).firstOrNull ?? wallets.firstOrNull;
            return PageBody(
              onRefresh: () async {
                session.queries.invalidate('wallets');
                session.queries.invalidate('entries');
              },
              children: [
                PageTitle(
                  icon: LucideIcons.wallet,
                  title: 'Wallet',
                  subtitle: 'Your personal balances in any world currency.',
                  actions: [
                    FilledButton.icon(
                      onPressed: wallets.isEmpty ? null : () => showTransferSheet(context, from: selected),
                      icon: const Icon(LucideIcons.send, size: 17),
                      label: const Text('Send money'),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                const DepositInfo(),
                const SizedBox(height: 16),
                if (!s.hasData)
                  const Skeleton(height: 170, radius: 22)
                else if (wallets.isEmpty)
                  const EmptyState(
                    icon: LucideIcons.wallet,
                    title: 'No balances yet',
                    text: 'Open a balance below, then ask a finance manager for a deposit.',
                  )
                else
                  WalletCards(
                    wallets: wallets,
                    selected: selected?.id,
                    onSelect: (w) => setState(() => _selected = w.id),
                  ),
                const SizedBox(height: 16),
                const _OpenBalance(),
                if (selected != null) ...[const SizedBox(height: 16), Statement(wallet: selected)],
              ],
            );
          },
        ),
      ),
    );
  }
}

class DepositInfo extends StatelessWidget {
  const DepositInfo({super.key});

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: c.accentSoft, borderRadius: BorderRadius.circular(16)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(LucideIcons.info, size: 18, color: c.accent),
          const SizedBox(width: 10),
          Expanded(
            child: Text.rich(
              TextSpan(
                style: TextStyle(color: c.accent2, fontSize: 13.5, height: 1.4),
                children: [
                  const TextSpan(
                    text: 'Deposits and withdrawals are handled by finance managers — by bank transfer or physically at the cash desk. ',
                  ),
                  WidgetSpan(
                    alignment: PlaceholderAlignment.baseline,
                    baseline: TextBaseline.alphabetic,
                    child: GestureDetector(
                      onTap: () => context.go('/support'),
                      child: Text(
                        'Contact support',
                        style: TextStyle(
                          color: c.accent,
                          fontWeight: FontWeight.w700,
                          decoration: TextDecoration.underline,
                        ),
                      ),
                    ),
                  ),
                  const TextSpan(text: ' to top up.'),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Balances as bank cards; the frozen part shows as a split bar.
class WalletCards extends StatelessWidget {
  const WalletCards({super.key, required this.wallets, required this.selected, required this.onSelect});

  final List<Wallet> wallets;
  final String? selected;
  final ValueChanged<Wallet> onSelect;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, box) {
        final phone = box.maxWidth < 560;
        final w = phone
            ? box.maxWidth * 0.86
            : (box.maxWidth - 16) / 2 > 380
            ? 360.0
            : (box.maxWidth - 16) / 2;
        final cards = [
          for (final (i, wallet) in wallets.indexed)
            FadeSlideIn(
              delay: stagger(i, 70),
              child: SizedBox(
                width: w,
                child: BankCard(wallet: wallet, selected: wallet.id == selected, onTap: () => onSelect(wallet)),
              ),
            ),
        ];
        if (phone) {
          return SizedBox(
            height: 186,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              clipBehavior: Clip.none,
              itemCount: cards.length,
              separatorBuilder: (_, _) => const SizedBox(width: 12),
              itemBuilder: (_, i) => cards[i],
            ),
          );
        }
        return Wrap(spacing: 16, runSpacing: 16, children: cards);
      },
    );
  }
}

class BankCard extends StatelessWidget {
  const BankCard({super.key, required this.wallet, this.selected = false, this.onTap});

  final Wallet wallet;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final frozen = double.tryParse(wallet.frozen) ?? 0;
    final available = double.tryParse(wallet.available) ?? 0;
    final white70 = Colors.white.withValues(alpha: 0.8);
    return AnimatedContainer(
      duration: const Duration(milliseconds: 250),
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: selected ? context.c.accent : Colors.transparent, width: 2),
      ),
      child: Material(
        borderRadius: BorderRadius.circular(20),
        clipBehavior: Clip.antiAlias,
        elevation: selected ? 10 : 4,
        shadowColor: Colors.black45,
        child: InkWell(
          onTap: onTap,
          child: Ink(
            height: 170,
            decoration: BoxDecoration(gradient: cardGradient(wallet.currency)),
            child: Stack(
              children: [
                Positioned(
                  right: -70,
                  top: -90,
                  child: Container(
                    width: 220,
                    height: 220,
                    decoration: BoxDecoration(shape: BoxShape.circle, color: Colors.white.withValues(alpha: 0.12)),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 18, 20, 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text(
                            wallet.currency,
                            style: font(
                              body,
                              13,
                              FontWeight.w800,
                              letterSpacing: 1.2,
                              color: Colors.white.withValues(alpha: 0.9),
                            ),
                          ),
                          const Spacer(),
                          if (frozen > 0) ...[
                            Icon(LucideIcons.lock, size: 13, color: white70),
                            const SizedBox(width: 4),
                            Text(
                              '${money(wallet.frozen, wallet.currency, code: false)} frozen',
                              style: TextStyle(color: white70, fontSize: 12.5),
                            ),
                          ],
                        ],
                      ),
                      const Spacer(),
                      AnimatedAmount(
                        value: wallet.balance,
                        format: (v) => money(v, wallet.currency, code: false),
                        style: font(display, 30, FontWeight.w800, color: Colors.white, letterSpacing: -0.5),
                      ),
                      const SizedBox(height: 8),
                      if (frozen > 0)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: ShareBar(
                            parts: [
                              (available, Colors.white.withValues(alpha: 0.9)),
                              (frozen, Colors.white.withValues(alpha: 0.35)),
                            ],
                          ),
                        ),
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              'Available: ${money(wallet.available, wallet.currency)}',
                              style: TextStyle(color: white70, fontSize: 12.5),
                            ),
                          ),
                          Icon(LucideIcons.creditCard, size: 17, color: white70),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class ShareBar extends StatelessWidget {
  const ShareBar({super.key, required this.parts});

  final List<(double, Color)> parts;

  @override
  Widget build(BuildContext context) {
    final total = parts.fold<double>(0, (s, p) => s + p.$1);
    return ClipRRect(
      borderRadius: BorderRadius.circular(99),
      child: SizedBox(
        height: 6,
        child: TweenAnimationBuilder<double>(
          tween: Tween(begin: 0, end: 1),
          duration: const Duration(milliseconds: 900),
          curve: Curves.easeOutCubic,
          builder: (_, t, _) => Row(
            children: [
              for (final p in parts)
                Expanded(
                  flex: total == 0 ? 1 : (p.$1 / total * 1000 * (p == parts.first ? t : 1)).round().clamp(1, 1000),
                  child: Container(color: p.$2),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class Statement extends StatefulWidget {
  const Statement({super.key, required this.wallet, this.title});

  final Wallet wallet;
  final String? title;

  @override
  State<Statement> createState() => _StatementState();
}

class _StatementState extends State<Statement> {
  int _limit = 20;

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final c = context.c;
    final w = widget.wallet;
    return OvlCard(
      padding: const EdgeInsets.fromLTRB(4, 16, 4, 8),
      child: Query<Paged<LedgerEntry>>(
        client: session.queries,
        queryKey: 'entries:${w.id}:$_limit',
        fetch: () => session.api.entries(w.id, limit: _limit),
        builder: (context, s) {
          final page = s.data;
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 0, 14, 8),
                child: Row(
                  children: [
                    Expanded(child: Text(widget.title ?? 'Statement · ${w.currency}', style: context.text.titleLarge)),
                    if (page != null) Text(plural(page.total, 'operation'), style: context.text.bodySmall),
                  ],
                ),
              ),
              if (page == null)
                const SkeletonList(rows: 4)
              else if (page.items.isEmpty)
                const EmptyState(icon: LucideIcons.receipt, title: 'No operations yet')
              else ...[
                for (final (i, e) in page.items.indexed)
                  FadeSlideIn(
                    delay: stagger(i, 25),
                    child: ListTile(
                      leading: IconTile(_entryIcon(e.kind), size: 38, color: e.incoming ? c.success : c.text2),
                      title: Text(
                        humanize(e.kind.replaceAll('_in', '').replaceAll('_out', '')),
                        style: context.text.titleSmall,
                      ),
                      subtitle: Text(
                        '${e.description}\n${dateTime(e.createdAt)}',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      isThreeLine: true,
                      trailing: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text(
                            '${e.incoming ? '+' : ''}${money(e.amount, e.currency)}',
                            style: font(body, 14, FontWeight.w700, color: e.incoming ? c.success : c.text),
                          ),
                          Text(money(e.balanceAfter, e.currency), style: context.text.bodySmall),
                        ],
                      ),
                    ),
                  ),
                if (page.total > page.items.length)
                  TextButton(onPressed: () => setState(() => _limit += 20), child: const Text('Load more')),
              ],
            ],
          );
        },
      ),
    );
  }

  IconData _entryIcon(String kind) => switch (kind) {
    'deposit' => LucideIcons.arrowDownLeft,
    'withdrawal' => LucideIcons.arrowUpRight,
    'transfer_in' => LucideIcons.arrowDownLeft,
    'transfer_out' => LucideIcons.send,
    'investment_in' || 'investment_out' => LucideIcons.chartLine,
    _ => LucideIcons.receipt,
  };
}

class _OpenBalance extends StatefulWidget {
  const _OpenBalance();

  @override
  State<_OpenBalance> createState() => _OpenBalanceState();
}

class _OpenBalanceState extends State<_OpenBalance> {
  String _currency = 'USD';
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    return OvlCard(
      child: Builder(
        builder: (context) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Open a balance in another currency', style: context.text.titleMedium),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      initialValue: _currency,
                      isExpanded: true,
                      items: [
                        for (final c in currencies.entries)
                          DropdownMenuItem(
                            value: c.key,
                            child: Text('${c.key} — ${c.value.$1}', overflow: TextOverflow.ellipsis),
                          ),
                      ],
                      onChanged: (v) => setState(() => _currency = v ?? _currency),
                    ),
                  ),
                  const SizedBox(width: 10),
                  OutlinedButton(
                    onPressed: _busy
                        ? null
                        : () async {
                            setState(() => _busy = true);
                            try {
                              await session.api.openWallet(_currency);
                              session.queries.invalidate('wallets');
                              if (context.mounted) toast(context, '$_currency balance opened');
                            } catch (e) {
                              if (context.mounted) toast(context, errorText(e), error: true);
                            } finally {
                              if (mounted) setState(() => _busy = false);
                            }
                          },
                    child: const Text('Open balance'),
                  ),
                ],
              ),
            ],
          );
        },
      ),
    );
  }
}

void showTransferSheet(BuildContext context, {Wallet? from}) {
  final session = context.read<Session>();
  final username = TextEditingController();
  final amount = TextEditingController();
  final note = TextEditingController();
  Wallet? wallet = from;
  var busy = false;
  Object? error;
  final walletsFuture = session.queries.fetch('wallets', session.api.wallets);
  showModalBottomSheet<void>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    builder: (sheet) => StatefulBuilder(
      builder: (sheet, set) => Padding(
        padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.viewInsetsOf(sheet).bottom),
        child: FutureBuilder<List<Wallet>>(
          future: walletsFuture,
          builder: (sheet, snap) {
            final wallets = snap.data ?? const <Wallet>[];
            wallet ??= wallets.firstOrNull;
            return Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('Send money', style: sheet.text.headlineSmall),
                const SizedBox(height: 4),
                Text('Instant transfers between accounts in the same currency.', style: sheet.text.bodyMedium),
                const SizedBox(height: 16),
                if (error != null) ...[ErrorBox(error), const SizedBox(height: 12)],
                if (wallets.isEmpty && snap.hasData)
                  const EmptyState(icon: LucideIcons.wallet, title: 'No balances to send from')
                else ...[
                  SizedBox(
                    height: 44,
                    child: ListView(
                      scrollDirection: Axis.horizontal,
                      children: [
                        for (final w in wallets)
                          Padding(
                            padding: const EdgeInsets.only(right: 8),
                            child: ChoiceChip(
                              label: Text('${w.currency} · ${money(w.available, w.currency, code: false)}'),
                              selected: w.id == wallet?.id,
                              onSelected: (_) => set(() => wallet = w),
                            ),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),
                  LabeledField(
                    label: 'Username',
                    controller: username,
                    icon: LucideIcons.atSign,
                    hint: 'who receives the money',
                  ),
                  const SizedBox(height: 12),
                  LabeledField(
                    label: 'Amount (${wallet?.currency ?? ''})',
                    controller: amount,
                    icon: LucideIcons.banknote,
                    keyboard: const TextInputType.numberWithOptions(decimal: true),
                  ),
                  const SizedBox(height: 12),
                  LabeledField(label: 'Note (optional)', controller: note, icon: LucideIcons.stickyNote),
                  const SizedBox(height: 18),
                  GradientButton(
                    label: 'Send',
                    icon: LucideIcons.send,
                    busy: busy,
                    onPressed: wallet == null
                        ? null
                        : () async {
                            set(() {
                              busy = true;
                              error = null;
                            });
                            try {
                              await session.api.transfer(
                                fromWalletId: wallet!.id,
                                username: username.text.trim().replaceFirst('@', '').toLowerCase(),
                                amount: amount.text.trim().replaceAll(',', '.'),
                                note: note.text.trim(),
                              );
                              session.queries.invalidate('wallets');
                              session.queries.invalidate('entries');
                              if (sheet.mounted) Navigator.pop(sheet);
                              if (context.mounted) {
                                toast(
                                  context,
                                  'Sent ${money(amount.text.trim(), wallet!.currency)} to @${username.text.trim()}',
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
              ],
            );
          },
        ),
      ),
    ),
  );
}
