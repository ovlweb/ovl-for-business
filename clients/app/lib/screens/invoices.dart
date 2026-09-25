import 'package:flutter/material.dart';
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
import '../i18n/i18n.dart';

const _financeRoles = {'owner', 'director', 'accountant'};

BigInt _minor(String amount, String currency) {
  final d = currencyDecimals(currency);
  final parts = amount.trim().split('.');
  final fraction = (parts.length > 1 ? parts[1] : '').padRight(d, '0').substring(0, d);
  return BigInt.tryParse('${parts[0].isEmpty ? '0' : parts[0]}$fraction') ?? BigInt.zero;
}

String _decimal(BigInt minor, String currency) {
  final d = currencyDecimals(currency);
  if (d == 0) return minor.toString();
  final s = minor.toString().padLeft(d + 1, '0');
  return '${s.substring(0, s.length - d)}.${s.substring(s.length - d)}';
}

/// "1,200.00 USD · 80.00 EUR" for a set of invoices.
String _totals(Iterable<Invoice> invoices) {
  final by = <String, BigInt>{};
  for (final i in invoices) {
    by[i.currency] = (by[i.currency] ?? BigInt.zero) + _minor(i.amountDue, i.currency);
  }
  if (by.isEmpty) return '—';
  return by.entries.map((e) => money(_decimal(e.value, e.key), e.key)).join(' · ');
}

const _every = {
  'weekly': 'Every week',
  'monthly': 'Every month',
  'quarterly': 'Every 3 months',
  'yearly': 'Every year',
};

String _day(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

class InvoicesScreen extends StatefulWidget {
  const InvoicesScreen({super.key});

  @override
  State<InvoicesScreen> createState() => _InvoicesScreenState();
}

class _InvoicesScreenState extends State<InvoicesScreen> {
  String _direction = 'incoming';
  bool _onlyOpen = true;

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: PageBody(
          onRefresh: () async => session.queries.invalidate('invoices'),
          children: [
            PageTitle(
              icon: LucideIcons.receipt,
              title: tr('Invoices'),
              subtitle: tr('Bill people and companies, and pay what you are billed.'),
              actions: [
                FilledButton.icon(
                  onPressed: () => openNewInvoice(context),
                  icon: const Icon(LucideIcons.plus, size: 17),
                  label: Text(tr('New invoice')),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Query<List<Invoice>>(
              client: session.queries,
              queryKey: 'invoices:open',
              fetch: () => session.api.invoices(status: 'open'),
              builder: (context, s) {
                final open = s.data ?? const <Invoice>[];
                final toPay = open.where((i) => i.incoming);
                final toReceive = open.where((i) => !i.incoming);
                return Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: [
                    _SummaryCard(
                      icon: LucideIcons.arrowUpRight,
                      label: tr('To pay'),
                      value: _totals(toPay),
                      caption: [
                        plural(toPay.length, 'open invoice'),
                        if (toPay.any((i) => i.overdue)) '${toPay.where((i) => i.overdue).length} overdue',
                      ].join(' · '),
                      alert: toPay.any((i) => i.overdue),
                    ),
                    _SummaryCard(
                      icon: LucideIcons.arrowDownLeft,
                      label: tr('To receive'),
                      value: _totals(toReceive),
                      caption: plural(toReceive.length, 'open invoice'),
                    ),
                  ],
                );
              },
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: Segmented<String>(
                    value: _direction,
                    options: const [('incoming', 'Received'), ('outgoing', 'Sent'), ('recurring', 'Recurring')],
                    onChanged: (d) => setState(() => _direction = d),
                  ),
                ),
                if (_direction != 'recurring') ...[
                  const SizedBox(width: 10),
                  FilterChip(
                    label: Text(tr('Open only')),
                    selected: _onlyOpen,
                    onSelected: (v) => setState(() => _onlyOpen = v),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 12),
            if (_direction == 'recurring')
              const _Schedules()
            else
              Query<List<Invoice>>(
                client: session.queries,
                queryKey: 'invoices:$_direction:$_onlyOpen',
                fetch: () => session.api.invoices(direction: _direction, status: _onlyOpen ? 'open' : null),
                builder: (context, s) {
                  if (!s.hasData) return const SkeletonList(rows: 3);
                  final list = s.data!;
                  if (list.isEmpty) {
                    return EmptyState(
                      icon: LucideIcons.receipt,
                      title: _onlyOpen ? tr('Nothing open') : tr('No invoices yet'),
                      text: _direction == 'incoming'
                          ? tr('Invoices people and companies send you appear here.')
                          : tr('Create an invoice to bill a person or a company.'),
                    );
                  }
                  return OvlCard(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: Column(
                      children: [
                        for (final (n, i) in list.indexed)
                          FadeSlideIn(
                            delay: stagger(n, 30),
                            child: _InvoiceTile(invoice: i),
                          ),
                      ],
                    ),
                  );
                },
              ),
          ],
        ),
      ),
    );
  }
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({
    required this.icon,
    required this.label,
    required this.value,
    required this.caption,
    this.alert = false,
  });

  final IconData icon;
  final String label;
  final String value;
  final String caption;
  final bool alert;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return ConstrainedBox(
      constraints: const BoxConstraints(minWidth: 240, maxWidth: 420),
      child: OvlCard(
        child: Row(
          children: [
            IconTile(icon, size: 40),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label.toUpperCase(),
                    style: font(body, 11.5, FontWeight.w700, letterSpacing: 0.6, color: c.text3),
                  ),
                  const SizedBox(height: 4),
                  Text(value, style: font(display, 19, FontWeight.w800, color: c.text)),
                  const SizedBox(height: 2),
                  Text(caption, style: context.text.bodySmall?.copyWith(color: alert ? c.danger : null)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _InvoiceTile extends StatelessWidget {
  const _InvoiceTile({required this.invoice});

  final Invoice invoice;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final i = invoice;
    return ListTile(
      onTap: () => showInvoiceSheet(context, i.id),
      leading: IconTile(
        i.incoming ? LucideIcons.arrowUpRight : LucideIcons.arrowDownLeft,
        size: 40,
        color: i.overdue ? c.danger : c.accent,
      ),
      title: Text(i.counterparty.name, style: context.text.titleSmall, overflow: TextOverflow.ellipsis),
      subtitle: Text(tr('{0} · due {1}', [i.number, date(i.dueDate)]), overflow: TextOverflow.ellipsis),
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(
            i.partlyPaid ? tr('{0} due', [money(i.amountDue, i.currency)]) : money(i.total, i.currency),
            style: font(body, 14, FontWeight.w700, color: c.text),
          ),
          const SizedBox(height: 4),
          StatusPill(i.displayStatus),
        ],
      ),
    );
  }
}

/// The invoice with its lines; pay it (received) or cancel it (sent).
void showInvoiceSheet(BuildContext context, String id) {
  showModalBottomSheet<void>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    builder: (sheet) => ConstrainedBox(
      constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(sheet).height * 0.9),
      child: _InvoiceSheet(id: id),
    ),
  );
}

class _InvoiceSheet extends StatefulWidget {
  const _InvoiceSheet({required this.id});

  final String id;

  @override
  State<_InvoiceSheet> createState() => _InvoiceSheetState();
}

class _InvoiceSheetState extends State<_InvoiceSheet> {
  String? _walletId;
  bool _busy = false;
  bool _partial = false;
  final _part = TextEditingController();
  Object? _error;

  @override
  void dispose() {
    _part.dispose();
    super.dispose();
  }

  /// Runs an action that returns the message to show when it worked.
  Future<void> _run(Future<String> Function() action) async {
    final session = context.read<Session>();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final message = await action();
      for (final k in ['invoices', 'wallets', 'entries', 'orgs', 'paymentApprovals']) {
        session.queries.invalidate(k);
      }
      if (mounted) toast(context, message);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final c = context.c;
    return Query<Invoice>(
      client: session.queries,
      queryKey: 'invoices:one:${widget.id}',
      fetch: () => session.api.invoice(widget.id),
      builder: (context, s) {
        final i = s.data;
        if (i == null) {
          return const Padding(padding: EdgeInsets.all(20), child: SkeletonList(rows: 4));
        }
        return ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
          children: [
            Row(
              children: [
                Expanded(child: Text(tr('Invoice {0}', [i.number]), style: context.text.headlineSmall)),
                StatusPill(i.displayStatus),
              ],
            ),
            const SizedBox(height: 14),
            Wrap(
              spacing: 28,
              runSpacing: 12,
              children: [
                _Fact('From', i.issuer.name, i.issuer.handle),
                _Fact('Bill to', i.recipient.name, i.recipient.handle),
                _Fact('Issued', date(i.createdAt), null),
                _Fact('Due', date(i.dueDate), i.overdue ? 'Overdue' : null, alert: i.overdue),
              ],
            ),
            const SizedBox(height: 16),
            OvlCard(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
              child: Column(
                children: [
                  for (final item in i.items)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(item.description, style: context.text.bodyLarge),
                                Text(
                                  '${item.quantity} × ${money(item.unitPrice, i.currency, code: false)}',
                                  style: context.text.bodySmall,
                                ),
                              ],
                            ),
                          ),
                          Text(money(item.amount, i.currency, code: false), style: context.text.bodyLarge),
                        ],
                      ),
                    ),
                  Divider(color: c.border),
                  Row(
                    children: [
                      Expanded(child: Text(tr('Total'), style: context.text.titleMedium)),
                      Text(money(i.total, i.currency), style: font(display, 20, FontWeight.w800, color: c.text)),
                    ],
                  ),
                  if (i.partlyPaid) ...[
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        Expanded(child: Text(tr('Paid so far'), style: context.text.bodyMedium)),
                        Text(money(i.amountPaid, i.currency), style: context.text.bodyMedium),
                      ],
                    ),
                    Row(
                      children: [
                        Expanded(child: Text(tr('Still due'), style: context.text.titleSmall)),
                        Text(money(i.amountDue, i.currency), style: context.text.titleSmall),
                      ],
                    ),
                  ],
                ],
              ),
            ),
            if (i.payments.length > 1 || (i.payments.isNotEmpty && i.isOpen)) ...[
              const SizedBox(height: 12),
              Text(tr('Payments'), style: context.text.labelLarge),
              for (final p in i.payments)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Row(
                    children: [
                      Expanded(child: Text('${dateTime(p.at)} · ${p.paidBy}', style: context.text.bodySmall)),
                      Text(money(p.amount, i.currency), style: context.text.bodyMedium),
                    ],
                  ),
                ),
            ],
            if (i.recurringInterval != null) ...[
              const SizedBox(height: 10),
              Row(
                children: [
                  Icon(LucideIcons.repeat, size: 14, color: c.text3),
                  const SizedBox(width: 6),
                  Text(
                    tr('Recurring invoice · {0}', [
                      (_every[i.recurringInterval] ?? i.recurringInterval!).toLowerCase(),
                    ]),
                    style: context.text.bodySmall,
                  ),
                ],
              ),
            ],
            if (i.note.isNotEmpty) ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: c.surface2, borderRadius: BorderRadius.circular(12)),
                child: Text(i.note, style: context.text.bodyMedium),
              ),
            ],
            const SizedBox(height: 12),
            if (i.status == 'paid' && i.paidAt != null)
              Text(tr('Paid on {0} by {1}.', [dateTime(i.paidAt!), i.paidBy ?? '']), style: context.text.bodySmall),
            if (i.status == 'cancelled')
              Text(
                tr('Cancelled{0}.', [i.cancelReason != null ? ': ${i.cancelReason}' : '']),
                style: context.text.bodySmall,
              ),
            if (_error != null) ...[const SizedBox(height: 12), ErrorBox(_error)],
            if (i.incoming && i.isOpen) ...[const SizedBox(height: 12), _payment(session, i)],
            if (!i.incoming && i.isOpen && !i.partlyPaid) ...[
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: _busy ? null : () => _confirmCancel(session, i),
                icon: const Icon(LucideIcons.x, size: 17),
                label: Text(tr('Cancel invoice')),
              ),
            ],
          ],
        );
      },
    );
  }

  Widget _payment(Session session, Invoice i) {
    final company = i.recipient.isCompany;
    return Query<List<Wallet>>(
      client: session.queries,
      queryKey: company ? 'orgs:${i.recipient.id}:wallets' : 'wallets',
      fetch: company ? () => session.api.organizationWallets(i.recipient.id) : session.api.wallets,
      builder: (context, s) {
        if (!s.hasData) return const Skeleton(height: 48, radius: 14);
        final matching = s.data!.where((w) => w.currency == i.currency).toList();
        if (matching.isEmpty) {
          return Text(
            tr('To pay, open a {0} balance and ask for a deposit on the wallet page.', [i.currency]),
            style: context.text.bodyMedium,
          );
        }
        final wallet = matching.where((w) => w.id == _walletId).firstOrNull ?? matching.first;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(tr('Pay from'), style: context.text.labelLarge),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final w in matching)
                  ChoiceChip(
                    label: Text(
                      tr('{0} · {1} available', [
                        company ? i.recipient.name : tr('Personal'),
                        money(w.available, w.currency),
                      ]),
                    ),
                    selected: w.id == wallet.id,
                    onSelected: (_) => setState(() => _walletId = w.id),
                  ),
              ],
            ),
            if (_partial) ...[
              const SizedBox(height: 12),
              LabeledField(
                label: tr('Amount to pay now (of {0})', [money(i.amountDue, i.currency)]),
                controller: _part,
                icon: LucideIcons.banknote,
                keyboard: const TextInputType.numberWithOptions(decimal: true),
                onChanged: (_) => setState(() {}),
              ),
            ],
            const SizedBox(height: 14),
            Builder(
              builder: (context) {
                final amount = _partial ? _part.text.trim().replaceAll(',', '.') : i.amountDue;
                final valid = (double.tryParse(amount) ?? 0) > 0;
                return GradientButton(
                  label: valid ? tr('Pay {0}', [money(amount, i.currency)]) : tr('Pay'),
                  icon: LucideIcons.check,
                  busy: _busy,
                  onPressed: !valid
                      ? null
                      : () => _run(() async {
                          final (paid, approval) = await session.api.payInvoice(
                            i.id,
                            wallet.id,
                            amount: _partial ? amount : null,
                          );
                          if (mounted) setState(() => _partial = false);
                          _part.clear();
                          return approval != null
                              ? tr('Above the approval limit: another finance member has to approve this payment')
                              : tr('Paid {0} to {1}', [money(amount, paid!.currency), paid.issuer.name]);
                        }),
                );
              },
            ),
            TextButton(
              onPressed: () => setState(() => _partial = !_partial),
              child: Text(_partial ? tr('Pay everything instead') : tr('Pay part of it')),
            ),
          ],
        );
      },
    );
  }

  Future<void> _confirmCancel(Session session, Invoice i) async {
    final reason = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: Text(tr('Cancel {0}?', [i.number])),
        content: TextField(
          controller: reason,
          decoration: InputDecoration(hintText: tr('Reason (optional, shown to the recipient)')),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialog, false), child: Text(tr('Keep'))),
          FilledButton(onPressed: () => Navigator.pop(dialog, true), child: Text(tr('Cancel invoice'))),
        ],
      ),
    );
    if (ok != true) return;
    await _run(() async {
      await session.api.cancelInvoice(i.id, reason: reason.text.trim());
      return tr('Invoice cancelled');
    });
  }
}

/// Recurring invoices this person or their companies send.
class _Schedules extends StatelessWidget {
  const _Schedules();

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final c = context.c;
    return Query<List<InvoiceSchedule>>(
      client: session.queries,
      queryKey: 'invoices:schedules',
      fetch: session.api.invoiceSchedules,
      builder: (context, s) {
        if (!s.hasData) return const SkeletonList(rows: 3);
        if (s.data!.isEmpty) {
          return EmptyState(
            icon: LucideIcons.repeat,
            title: tr('No recurring invoices'),
            text: tr('Set them up on the web: “Repeat” on a new invoice bills someone every week, month or year.'),
          );
        }
        return OvlCard(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Column(
            children: [
              for (final (n, r) in s.data!.indexed)
                FadeSlideIn(
                  delay: stagger(n, 30),
                  child: ListTile(
                    leading: IconTile(LucideIcons.repeat, size: 40, color: c.accent),
                    title: Text(r.recipient.name, style: context.text.titleSmall, overflow: TextOverflow.ellipsis),
                    subtitle: Text(
                      [
                        _every[r.interval] ?? r.interval,
                        if (r.nextRunOn != null) 'next ${date(r.nextRunOn!)}',
                        plural(r.invoiceCount, 'invoice'),
                      ].join(' · '),
                    ),
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(money(r.total, r.currency), style: font(body, 14, FontWeight.w700, color: c.text)),
                            const SizedBox(height: 4),
                            StatusPill(r.status),
                          ],
                        ),
                        if (r.status != 'ended')
                          PopupMenuButton<String>(
                            tooltip: tr('Change'),
                            onSelected: (status) async {
                              try {
                                await session.api.setInvoiceScheduleStatus(r.id, status);
                                session.queries.invalidate('invoices');
                              } catch (e) {
                                if (context.mounted) toast(context, errorText(e), error: true);
                              }
                            },
                            itemBuilder: (_) => [
                              PopupMenuItem(
                                value: r.status == 'active' ? 'paused' : 'active',
                                child: Text(r.status == 'active' ? tr('Pause') : tr('Resume')),
                              ),
                              PopupMenuItem(value: 'ended', child: Text(tr('End'))),
                            ],
                          ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

class _Fact extends StatelessWidget {
  const _Fact(this.label, this.value, this.detail, {this.alert = false});

  final String label;
  final String value;
  final String? detail;
  final bool alert;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(tr(label).toUpperCase(), style: font(body, 11, FontWeight.w700, letterSpacing: 0.6, color: c.text3)),
        const SizedBox(height: 3),
        Text(value, style: context.text.titleSmall),
        if (detail != null) Text(tr(detail!), style: context.text.bodySmall?.copyWith(color: alert ? c.danger : null)),
      ],
    );
  }
}

void openNewInvoice(BuildContext context) {
  Navigator.of(
    context,
    rootNavigator: true,
  ).push(MaterialPageRoute<void>(fullscreenDialog: true, builder: (_) => const NewInvoiceScreen()));
}

class _Line {
  final description = TextEditingController();
  final quantity = TextEditingController(text: '1');
  final unitPrice = TextEditingController();

  void dispose() {
    description.dispose();
    quantity.dispose();
    unitPrice.dispose();
  }
}

class NewInvoiceScreen extends StatefulWidget {
  const NewInvoiceScreen({super.key});

  @override
  State<NewInvoiceScreen> createState() => _NewInvoiceScreenState();
}

class _NewInvoiceScreenState extends State<NewInvoiceScreen> {
  String? _from;
  bool _fromChosen = false;
  String _toType = 'organization';
  final _to = TextEditingController();
  String _currency = 'USD';
  DateTime _due = DateTime.now().add(const Duration(days: 14));
  final _note = TextEditingController();
  final _lines = [_Line()];
  bool _busy = false;
  Object? _error;

  @override
  void dispose() {
    _to.dispose();
    _note.dispose();
    for (final l in _lines) {
      l.dispose();
    }
    super.dispose();
  }

  String get _total {
    var sum = BigInt.zero;
    for (final l in _lines) {
      sum += _minor(l.unitPrice.text.replaceAll(',', '.'), _currency) * BigInt.from(int.tryParse(l.quantity.text) ?? 0);
    }
    return money(_decimal(sum, _currency), _currency);
  }

  Future<void> _send() async {
    final session = context.read<Session>();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final handle = _to.text.trim().replaceFirst('@', '').toLowerCase();
      final invoice = await session.api.createInvoice(
        from: _from,
        to: _toType == 'user' ? {'type': 'user', 'username': handle} : {'type': 'organization', 'slug': handle},
        currency: _currency,
        dueDate: _day(_due),
        items: [
          for (final l in _lines)
            {
              'description': l.description.text.trim(),
              'quantity': int.tryParse(l.quantity.text) ?? 0,
              'unitPrice': l.unitPrice.text.trim().replaceAll(',', '.'),
            },
        ],
        note: _note.text.trim(),
      );
      session.queries.invalidate('invoices');
      if (!mounted) return;
      Navigator.pop(context);
      toast(context, tr('Invoice {0} sent to {1}', [invoice.number, invoice.recipient.name]));
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = e;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final c = context.c;
    return Scaffold(
      appBar: AppBar(title: Text(tr('New invoice'))),
      body: SafeArea(
        child: Query<List<Organization>>(
          client: session.queries,
          queryKey: 'orgs:mine',
          fetch: session.api.myOrganizations,
          builder: (context, s) {
            if (!s.hasData) return const Padding(padding: EdgeInsets.all(24), child: SkeletonList(rows: 5));
            final issuers = s.data!.where((o) => _financeRoles.contains(o.myRole)).toList();
            // Business first: default to the first company the person can invoice for.
            if (!_fromChosen) _from ??= issuers.firstOrNull?.id;
            return PageBody(
              maxWidth: 760,
              children: [
                if (_error != null) ...[ErrorBox(_error), const SizedBox(height: 12)],
                Text(tr('From'), style: context.text.labelLarge),
                const SizedBox(height: 7),
                DropdownButtonFormField<String?>(
                  initialValue: _from,
                  isExpanded: true,
                  items: [
                    DropdownMenuItem(value: null, child: Text(tr('Me (personal)'))),
                    for (final o in issuers) DropdownMenuItem(value: o.id, child: Text(o.name)),
                  ],
                  onChanged: (v) => setState(() {
                    _from = v;
                    _fromChosen = true;
                  }),
                ),
                const SizedBox(height: 14),
                Text(tr('Bill to'), style: context.text.labelLarge),
                const SizedBox(height: 7),
                Segmented<String>(
                  value: _toType,
                  options: const [('organization', 'Company'), ('user', 'Person')],
                  onChanged: (t) => setState(() => _toType = t),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _to,
                  decoration: InputDecoration(
                    hintText: _toType == 'user' ? tr('username') : tr('company-handle'),
                    prefixIcon: Icon(_toType == 'user' ? LucideIcons.atSign : LucideIcons.building2, size: 18),
                  ),
                ),
                const SizedBox(height: 14),
                Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: _currency,
                        isExpanded: true,
                        decoration: InputDecoration(labelText: tr('Currency')),
                        items: [
                          for (final e in currencies.entries)
                            DropdownMenuItem(
                              value: e.key,
                              child: Text('${e.key} — ${e.value.$1}', overflow: TextOverflow.ellipsis),
                            ),
                        ],
                        onChanged: (v) => setState(() => _currency = v ?? _currency),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () async {
                          final picked = await showDatePicker(
                            context: context,
                            initialDate: _due,
                            firstDate: DateTime.now(),
                            lastDate: DateTime.now().add(const Duration(days: 730)),
                          );
                          if (picked != null) setState(() => _due = picked);
                        },
                        icon: const Icon(LucideIcons.calendar, size: 17),
                        label: Text(tr('Due {0}', [date(_due)])),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                Text(tr('Lines'), style: context.text.titleMedium),
                const SizedBox(height: 8),
                for (final (n, l) in _lines.indexed)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Row(
                      children: [
                        Expanded(
                          flex: 5,
                          child: TextField(
                            controller: l.description,
                            decoration: InputDecoration(hintText: tr('Line {0}: what you are billing for', [n + 1])),
                          ),
                        ),
                        const SizedBox(width: 8),
                        SizedBox(
                          width: 64,
                          child: TextField(
                            controller: l.quantity,
                            keyboardType: TextInputType.number,
                            decoration: InputDecoration(hintText: tr('Qty')),
                            onChanged: (_) => setState(() {}),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          flex: 2,
                          child: TextField(
                            controller: l.unitPrice,
                            keyboardType: const TextInputType.numberWithOptions(decimal: true),
                            decoration: InputDecoration(hintText: tr('Unit price')),
                            onChanged: (_) => setState(() {}),
                          ),
                        ),
                        IconButton(
                          tooltip: tr('Remove line'),
                          onPressed: _lines.length == 1 ? null : () => setState(() => _lines.removeAt(n).dispose()),
                          icon: Icon(LucideIcons.trash2, size: 18, color: c.text3),
                        ),
                      ],
                    ),
                  ),
                Row(
                  children: [
                    TextButton.icon(
                      onPressed: _lines.length >= 50 ? null : () => setState(() => _lines.add(_Line())),
                      icon: const Icon(LucideIcons.plus, size: 17),
                      label: Text(tr('Add line')),
                    ),
                    const Spacer(),
                    Text(tr('Total  '), style: context.text.bodyMedium),
                    Text(_total, style: font(display, 18, FontWeight.w800, color: c.text)),
                  ],
                ),
                const SizedBox(height: 12),
                LabeledField(
                  label: tr('Note (optional)'),
                  controller: _note,
                  icon: LucideIcons.stickyNote,
                  maxLines: 2,
                  hint: tr('Payment terms, order number, thanks…'),
                ),
                const SizedBox(height: 20),
                GradientButton(label: tr('Send invoice'), icon: LucideIcons.send, busy: _busy, onPressed: _send),
              ],
            );
          },
        ),
      ),
    );
  }
}
