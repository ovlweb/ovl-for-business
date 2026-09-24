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
    by[i.currency] = (by[i.currency] ?? BigInt.zero) + _minor(i.total, i.currency);
  }
  if (by.isEmpty) return '—';
  return by.entries.map((e) => money(_decimal(e.value, e.key), e.key)).join(' · ');
}

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
              title: 'Invoices',
              subtitle: 'Bill people and companies, and pay what you are billed.',
              actions: [
                FilledButton.icon(
                  onPressed: () => openNewInvoice(context),
                  icon: const Icon(LucideIcons.plus, size: 17),
                  label: const Text('New invoice'),
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
                      label: 'To pay',
                      value: _totals(toPay),
                      caption: [
                        plural(toPay.length, 'open invoice'),
                        if (toPay.any((i) => i.overdue)) '${toPay.where((i) => i.overdue).length} overdue',
                      ].join(' · '),
                      alert: toPay.any((i) => i.overdue),
                    ),
                    _SummaryCard(
                      icon: LucideIcons.arrowDownLeft,
                      label: 'To receive',
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
                    options: const [('incoming', 'Received'), ('outgoing', 'Sent')],
                    onChanged: (d) => setState(() => _direction = d),
                  ),
                ),
                const SizedBox(width: 10),
                FilterChip(
                  label: const Text('Open only'),
                  selected: _onlyOpen,
                  onSelected: (v) => setState(() => _onlyOpen = v),
                ),
              ],
            ),
            const SizedBox(height: 12),
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
                    title: _onlyOpen ? 'Nothing open' : 'No invoices yet',
                    text: _direction == 'incoming'
                        ? 'Invoices people and companies send you appear here.'
                        : 'Create an invoice to bill a person or a company.',
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
      subtitle: Text('${i.number} · due ${date(i.dueDate)}', overflow: TextOverflow.ellipsis),
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(money(i.total, i.currency), style: font(body, 14, FontWeight.w700, color: c.text)),
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
  Object? _error;

  Future<void> _run(Future<Invoice> Function() action, String Function(Invoice) message) async {
    final session = context.read<Session>();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await action();
      for (final k in ['invoices', 'wallets', 'entries', 'orgs']) {
        session.queries.invalidate(k);
      }
      if (mounted) toast(context, message(result));
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
                Expanded(child: Text('Invoice ${i.number}', style: context.text.headlineSmall)),
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
                      Expanded(child: Text('Total', style: context.text.titleMedium)),
                      Text(money(i.total, i.currency), style: font(display, 20, FontWeight.w800, color: c.text)),
                    ],
                  ),
                ],
              ),
            ),
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
              Text('Paid on ${dateTime(i.paidAt!)} by ${i.paidBy ?? ''}.', style: context.text.bodySmall),
            if (i.status == 'cancelled')
              Text('Cancelled${i.cancelReason != null ? ': ${i.cancelReason}' : ''}.', style: context.text.bodySmall),
            if (_error != null) ...[const SizedBox(height: 12), ErrorBox(_error)],
            if (i.incoming && i.isOpen) ...[const SizedBox(height: 12), _payment(session, i)],
            if (!i.incoming && i.isOpen) ...[
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: _busy ? null : () => _confirmCancel(session, i),
                icon: const Icon(LucideIcons.x, size: 17),
                label: const Text('Cancel invoice'),
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
            'To pay, open a ${i.currency} balance and ask for a deposit on the wallet page.',
            style: context.text.bodyMedium,
          );
        }
        final wallet = matching.where((w) => w.id == _walletId).firstOrNull ?? matching.first;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Pay from', style: context.text.labelLarge),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final w in matching)
                  ChoiceChip(
                    label: Text(
                      '${company ? i.recipient.name : 'Personal'} · ${money(w.available, w.currency)} available',
                    ),
                    selected: w.id == wallet.id,
                    onSelected: (_) => setState(() => _walletId = w.id),
                  ),
              ],
            ),
            const SizedBox(height: 14),
            GradientButton(
              label: 'Pay ${money(i.total, i.currency)}',
              icon: LucideIcons.check,
              busy: _busy,
              onPressed: () => _run(
                () => session.api.payInvoice(i.id, wallet.id),
                (paid) => 'Paid ${money(paid.total, paid.currency)} to ${paid.issuer.name}',
              ),
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
        title: Text('Cancel ${i.number}?'),
        content: TextField(
          controller: reason,
          decoration: const InputDecoration(hintText: 'Reason (optional, shown to the recipient)'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialog, false), child: const Text('Keep')),
          FilledButton(onPressed: () => Navigator.pop(dialog, true), child: const Text('Cancel invoice')),
        ],
      ),
    );
    if (ok != true) return;
    await _run(() => session.api.cancelInvoice(i.id, reason: reason.text.trim()), (_) => 'Invoice cancelled');
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
        Text(label.toUpperCase(), style: font(body, 11, FontWeight.w700, letterSpacing: 0.6, color: c.text3)),
        const SizedBox(height: 3),
        Text(value, style: context.text.titleSmall),
        if (detail != null) Text(detail!, style: context.text.bodySmall?.copyWith(color: alert ? c.danger : null)),
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
      toast(context, 'Invoice ${invoice.number} sent to ${invoice.recipient.name}');
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
      appBar: AppBar(title: const Text('New invoice')),
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
                Text('From', style: context.text.labelLarge),
                const SizedBox(height: 7),
                DropdownButtonFormField<String?>(
                  initialValue: _from,
                  isExpanded: true,
                  items: [
                    const DropdownMenuItem(value: null, child: Text('Me (personal)')),
                    for (final o in issuers) DropdownMenuItem(value: o.id, child: Text(o.name)),
                  ],
                  onChanged: (v) => setState(() {
                    _from = v;
                    _fromChosen = true;
                  }),
                ),
                const SizedBox(height: 14),
                Text('Bill to', style: context.text.labelLarge),
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
                    hintText: _toType == 'user' ? 'username' : 'company-handle',
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
                        decoration: const InputDecoration(labelText: 'Currency'),
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
                        label: Text('Due ${date(_due)}'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                Text('Lines', style: context.text.titleMedium),
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
                            decoration: InputDecoration(hintText: 'Line ${n + 1}: what you are billing for'),
                          ),
                        ),
                        const SizedBox(width: 8),
                        SizedBox(
                          width: 64,
                          child: TextField(
                            controller: l.quantity,
                            keyboardType: TextInputType.number,
                            decoration: const InputDecoration(hintText: 'Qty'),
                            onChanged: (_) => setState(() {}),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          flex: 2,
                          child: TextField(
                            controller: l.unitPrice,
                            keyboardType: const TextInputType.numberWithOptions(decimal: true),
                            decoration: const InputDecoration(hintText: 'Unit price'),
                            onChanged: (_) => setState(() {}),
                          ),
                        ),
                        IconButton(
                          tooltip: 'Remove line',
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
                      label: const Text('Add line'),
                    ),
                    const Spacer(),
                    Text('Total  ', style: context.text.bodyMedium),
                    Text(_total, style: font(display, 18, FontWeight.w800, color: c.text)),
                  ],
                ),
                const SizedBox(height: 12),
                LabeledField(
                  label: 'Note (optional)',
                  controller: _note,
                  icon: LucideIcons.stickyNote,
                  maxLines: 2,
                  hint: 'Payment terms, order number, thanks…',
                ),
                const SizedBox(height: 20),
                GradientButton(label: 'Send invoice', icon: LucideIcons.send, busy: _busy, onPressed: _send),
              ],
            );
          },
        ),
      ),
    );
  }
}
