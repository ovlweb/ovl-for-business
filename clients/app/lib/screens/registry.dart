import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/models.dart';
import '../state/query.dart';
import '../state/session.dart';
import '../theme/theme.dart';
import '../ui/format.dart';
import '../ui/widgets.dart';
import 'contacts.dart';
import '../i18n/i18n.dart';

class RegistryScreen extends StatefulWidget {
  const RegistryScreen({super.key, this.initialQuery});

  final String? initialQuery;

  @override
  State<RegistryScreen> createState() => _RegistryScreenState();
}

class _RegistryScreenState extends State<RegistryScreen> {
  late final _q = TextEditingController(text: widget.initialQuery ?? '');
  late String _search = widget.initialQuery ?? '';
  String? _kind;
  Timer? _debounce;

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final kinds = <(String?, String)>[
      (null, 'Everything'),
      ('organization', 'Organizations'),
      ('license', 'Licenses'),
      ('virtual_country', 'Virtual countries'),
    ];
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: PageBody(
          children: [
            PageTitle(
              icon: LucideIcons.bookOpen,
              title: tr('Public registry'),
              subtitle: tr(
                'Every approved license, organization and virtual country. Also available to other services through the public API.',
              ),
            ),
            const SizedBox(height: 18),
            OvlCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextField(
                    controller: _q,
                    onChanged: (v) {
                      _debounce?.cancel();
                      _debounce = Timer(const Duration(milliseconds: 300), () => setState(() => _search = v.trim()));
                    },
                    decoration: InputDecoration(
                      hintText: tr('Search by name, registry number, holder…'),
                      prefixIcon: Icon(LucideIcons.search, size: 18),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final k in kinds)
                        ChoiceChip(
                          label: Text(tr(k.$2)),
                          selected: _kind == k.$1,
                          onSelected: (_) => setState(() => _kind = k.$1),
                        ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Query<Paged<RegistryEntry>>(
              client: session.queries,
              queryKey: 'registry:$_kind:$_search',
              fetch: () => session.api.registry(q: _search, kind: _kind, limit: 50),
              builder: (context, s) {
                if (!s.hasData) return const SkeletonList();
                final items = s.data!.items;
                if (items.isEmpty) return EmptyState(icon: LucideIcons.searchX, title: tr('Nothing found'));
                return OvlCard(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Column(
                    children: [
                      for (final (i, e) in items.indexed)
                        FadeSlideIn(
                          delay: stagger(i, 25),
                          child: ListTile(
                            onTap: () => _details(context, e),
                            leading: IconTile(
                              e.kind == 'organization'
                                  ? LucideIcons.building2
                                  : e.kind == 'virtual_country'
                                  ? LucideIcons.flag
                                  : LucideIcons.award,
                              size: 40,
                              color: e.kind == 'virtual_country' ? context.c.council : context.c.accent,
                            ),
                            title: Row(
                              children: [
                                Flexible(child: Text(e.title, overflow: TextOverflow.ellipsis)),
                                const SizedBox(width: 8),
                                _KindChip(e.kindLabel),
                              ],
                            ),
                            subtitle: Text(tr('{0} · issued {1}', [e.holder.name, date(e.issuedAt)])),
                            trailing: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: [
                                Text(e.number, style: const TextStyle(fontFamily: 'monospace', fontSize: 12.5)),
                                if (e.status != 'active') ...[const SizedBox(height: 4), StatusPill(e.status)],
                              ],
                            ),
                          ),
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

  void _details(BuildContext context, RegistryEntry e) {
    showModalBottomSheet<void>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      builder: (sheet) => Padding(
        padding: const EdgeInsets.fromLTRB(22, 0, 22, 26),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [_KindChip(e.kindLabel), const SizedBox(width: 8), StatusPill(e.status)]),
            const SizedBox(height: 10),
            Text(e.title, style: sheet.text.headlineMedium),
            const SizedBox(height: 4),
            InkWell(
              onTap: () {
                Clipboard.setData(ClipboardData(text: e.number));
                toast(sheet, tr('Registry number copied'));
              },
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(e.number, style: const TextStyle(fontFamily: 'monospace', fontSize: 14)),
                  const SizedBox(width: 6),
                  Icon(LucideIcons.copy, size: 14, color: sheet.c.text3),
                ],
              ),
            ),
            const SizedBox(height: 14),
            if (e.description.isNotEmpty) Text(e.description, style: sheet.text.bodyLarge),
            const SizedBox(height: 14),
            Text(
              tr('Holder: {0} ({1}{2})', [e.holder.name, e.holder.type == 'user' ? '@' : '', e.holder.handle]),
              style: sheet.text.bodyMedium,
            ),
            if (e.holder.verified) ...[const SizedBox(height: 6), const VerifiedBadge()],
            Text(
              [
                'Issued ${date(e.issuedAt)}',
                if (e.expiresAt != null)
                  e.status == 'expired'
                      ? tr('expired {0}', [date(e.expiresAt!)])
                      : tr('valid until {0}', [date(e.expiresAt!)]),
                if (e.currency != null) 'currency ${e.currency}',
              ].join(' · '),
              style: sheet.text.bodyMedium,
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                FilledButton.tonalIcon(
                  onPressed: () => launchUrl(
                    context.read<Session>().api.certificateUrl(e.number),
                    mode: LaunchMode.externalApplication,
                  ),
                  icon: const Icon(LucideIcons.award, size: 16),
                  label: Text(tr('Certificate (PDF)')),
                ),
                if (e.website != null)
                  OutlinedButton.icon(
                    onPressed: () => launchUrl(Uri.parse(e.website!)),
                    icon: const Icon(LucideIcons.externalLink, size: 16),
                    label: Text(e.website!),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _KindChip extends StatelessWidget {
  const _KindChip(this.label);

  final String label;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
    decoration: BoxDecoration(color: context.c.surface3, borderRadius: BorderRadius.circular(6)),
    child: Text(
      label.toUpperCase(),
      style: font(body, 9.5, FontWeight.w800, letterSpacing: 0.5, color: context.c.text2),
    ),
  );
}
