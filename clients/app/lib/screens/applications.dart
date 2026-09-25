import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/currencies.g.dart';
import '../api/models.dart';
import '../state/query.dart';
import '../state/session.dart';
import '../theme/theme.dart';
import '../ui/format.dart';
import '../ui/widgets.dart';
import 'contacts.dart';

/// Horizontal approval stepper: done stages get a check, the current one pulses.
class WorkflowSteps extends StatelessWidget {
  const WorkflowSteps({super.key, required this.application});

  final Application application;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final stages = workflows[application.type]?.stages ?? const <WorkflowStage>[];
    final a = application;
    return Wrap(
      crossAxisAlignment: WrapCrossAlignment.center,
      spacing: 6,
      runSpacing: 6,
      children: [
        for (final (i, s) in stages.indexed) ...[
          if (i > 0) Container(width: 16, height: 1.5, color: c.border),
          Builder(
            builder: (_) {
              final done = a.status == 'approved' || i < a.stageIndex;
              final failed = a.status == 'rejected' && i == a.stageIndex;
              final current = (a.status == 'pending' || a.status == 'changes_requested') && i == a.stageIndex;
              final color = failed
                  ? c.danger
                  : done
                  ? c.success
                  : current
                  ? c.accent
                  : c.text3;
              return Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 20,
                    height: 20,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: done || failed ? color : Colors.transparent,
                      border: Border.all(color: color, width: 1.6),
                    ),
                    child: done
                        ? const Icon(LucideIcons.check, size: 12, color: Colors.white)
                        : failed
                        ? const Icon(LucideIcons.x, size: 12, color: Colors.white)
                        : current
                        ? Center(
                            child: Container(
                              width: 7,
                              height: 7,
                              decoration: BoxDecoration(color: color, shape: BoxShape.circle),
                            ),
                          )
                        : null,
                  ),
                  const SizedBox(width: 6),
                  Text(
                    s.label,
                    style: font(
                      body,
                      12.5,
                      current ? FontWeight.w700 : FontWeight.w500,
                      color: current ? c.text : c.text2,
                    ),
                  ),
                ],
              );
            },
          ),
        ],
      ],
    );
  }
}

const _types = <(String, IconData, String)>[
  ('company', LucideIcons.building2, 'Business account with its license and an optional stock listing.'),
  ('license', LucideIcons.award, 'Projects, fan-projects, TV / radio channels, websites, virtual countries.'),
  ('news_channel', LucideIcons.radio, 'A broadcast channel for your subscribers.'),
  ('moderator', LucideIcons.shield, 'Review applications and answer tech support.'),
  ('council', LucideIcons.landmark, 'A vote on companies, licenses and new members.'),
];

class ApplicationsScreen extends StatelessWidget {
  const ApplicationsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Query<List<Application>>(
          client: session.queries,
          queryKey: 'applications:mine',
          fetch: session.api.myApplications,
          builder: (context, s) => PageBody(
            onRefresh: () => s.fetch(),
            children: [
              const PageTitle(
                icon: LucideIcons.fileText,
                title: 'Applications',
                subtitle: 'Register a company, request a license, open a news channel or join the staff.',
              ),
              const SizedBox(height: 18),
              Text('Start a new application', style: context.text.titleLarge),
              const SizedBox(height: 10),
              LayoutBuilder(
                builder: (context, box) {
                  final columns = box.maxWidth > 900
                      ? 3
                      : box.maxWidth > 560
                      ? 2
                      : 1;
                  final w = (box.maxWidth - 12 * (columns - 1)) / columns;
                  return Wrap(
                    spacing: 12,
                    runSpacing: 12,
                    children: [
                      for (final (i, t) in _types.indexed)
                        SizedBox(
                          width: w,
                          child: FadeSlideIn(
                            delay: stagger(i),
                            child: OvlCard(
                              onTap: () => context.go('/applications/new/${t.$1}'),
                              child: Row(
                                children: [
                                  IconTile(t.$2, size: 42),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(workflows[t.$1]!.label, style: context.text.titleSmall),
                                        const SizedBox(height: 2),
                                        Text(
                                          t.$3,
                                          style: context.text.bodySmall,
                                          maxLines: 2,
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                    ],
                  );
                },
              ),
              const SizedBox(height: 24),
              Text('Your applications', style: context.text.titleLarge),
              const SizedBox(height: 10),
              if (!s.hasData)
                const SkeletonList(rows: 3)
              else if (s.data!.isEmpty)
                Text('Nothing submitted yet.', style: context.text.bodyMedium)
              else
                for (final (i, a) in s.data!.indexed)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: FadeSlideIn(
                      delay: stagger(i),
                      child: _ApplicationCard(application: a),
                    ),
                  ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ApplicationCard extends StatelessWidget {
  const _ApplicationCard({required this.application});

  final Application application;

  @override
  Widget build(BuildContext context) {
    final a = application;
    final session = context.read<Session>();
    return OvlCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(a.title, style: context.text.titleMedium),
                    Text(
                      '${workflows[a.type]?.label ?? a.type} · submitted ${date(a.createdAt)}',
                      style: context.text.bodySmall,
                    ),
                  ],
                ),
              ),
              StatusPill(a.status),
            ],
          ),
          const SizedBox(height: 12),
          WorkflowSteps(application: a),
          if (a.rejectionReason != null && a.rejectionReason!.isNotEmpty) ...[
            const SizedBox(height: 10),
            Text('Reason: ${a.rejectionReason}', style: TextStyle(color: context.c.danger, fontSize: 13.5)),
          ],
          if (a.status == 'changes_requested') ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: context.c.warningSoft, borderRadius: BorderRadius.circular(12)),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      'Changes requested: ${a.changesRequested ?? ''}',
                      style: TextStyle(color: context.c.warning, fontSize: 13.5),
                    ),
                  ),
                  const SizedBox(width: 8),
                  FilledButton(
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => NewApplicationScreen(type: a.type, resubmit: a),
                      ),
                    ),
                    child: const Text('Edit and resubmit'),
                  ),
                ],
              ),
            ),
          ],
          if (a.attachments.isNotEmpty) ...[const SizedBox(height: 10), AttachmentChips(files: a.attachments)],
          if (a.status == 'approved' && a.type == 'company') ...[
            const SizedBox(height: 10),
            TextButton.icon(
              onPressed: () => context.go('/companies'),
              icon: const Icon(LucideIcons.building2, size: 16),
              label: const Text('Open company'),
            ),
          ],
          if (a.status == 'pending' || a.status == 'changes_requested') ...[
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                onPressed: () async {
                  final ok = await showDialog<bool>(
                    context: context,
                    builder: (d) => AlertDialog(
                      title: const Text('Withdraw application?'),
                      content: const Text('Reviewers will stop working on it.'),
                      actions: [
                        TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Keep')),
                        FilledButton(onPressed: () => Navigator.pop(d, true), child: const Text('Withdraw')),
                      ],
                    ),
                  );
                  if (ok != true) return;
                  await session.api.withdraw(a.id);
                  session.queries.invalidate('applications');
                },
                child: const Text('Withdraw'),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Documents attached to an application; they open in the browser.
class AttachmentChips extends StatelessWidget {
  const AttachmentChips({super.key, required this.files});

  final List<FileInfo> files;

  @override
  Widget build(BuildContext context) {
    final session = context.read<Session>();
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final f in files)
          ActionChip(
            avatar: Icon(f.isImage ? LucideIcons.image : LucideIcons.fileText, size: 16),
            label: Text(f.name, overflow: TextOverflow.ellipsis),
            onPressed: () => launchUrl(session.api.fileUrl(f.url), mode: LaunchMode.externalApplication),
          ),
      ],
    );
  }
}

class NewApplicationScreen extends StatefulWidget {
  const NewApplicationScreen({super.key, required this.type, this.resubmit});

  final String type;

  /// Edit this application and send it again (after a reviewer asked for changes).
  final Application? resubmit;

  @override
  State<NewApplicationScreen> createState() => _NewApplicationScreenState();
}

class _NewApplicationScreenState extends State<NewApplicationScreen> {
  final _f = <String, TextEditingController>{};
  TextEditingController f(String key) => _f[key] ??= TextEditingController();
  bool _list = false;
  String _currency = 'USD';
  String _licenseType = 'project';
  String? _orgId;
  bool _busy = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    final p = widget.resubmit?.payload;
    if (p == null) return;
    for (final e in p.entries) {
      if (e.value is String || e.value is num) f(e.key).text = '${e.value}';
    }
    final listing = p['listing'];
    if (listing is Map) {
      for (final e in listing.entries) {
        f('${e.key}').text = '${e.value}';
      }
    }
    _list = p['listOnExchange'] == true;
    _currency = p['baseCurrency'] as String? ?? _currency;
    _licenseType = p['licenseType'] as String? ?? _licenseType;
    _orgId = p['organizationId'] as String?;
  }

  Json _payload() {
    String v(String k) => f(k).text.trim();
    return switch (widget.type) {
      'company' => {
        'name': v('name'),
        'description': v('description'),
        'website': v('website'),
        'country': v('country'),
        'baseCurrency': _currency,
        'businessPlan': v('businessPlan'),
        'listOnExchange': _list,
        if (_list)
          'listing': {
            'ticker': v('ticker').toUpperCase(),
            'sharePrice': v('sharePrice'),
            'totalShares': int.tryParse(v('totalShares')) ?? 0,
          },
      },
      'license' => {
        'licenseType': _licenseType,
        'title': v('title'),
        'description': v('description'),
        'website': v('website'),
        'organizationId': ?_orgId,
        if (v('details').isNotEmpty) 'details': v('details'),
      },
      'news_channel' => {'title': v('title'), 'handle': v('handle').toLowerCase(), 'description': v('description')},
      _ => {'motivation': v('motivation'), if (v('experience').isNotEmpty) 'experience': v('experience')},
    };
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final session = context.read<Session>();
    try {
      final again = widget.resubmit;
      if (again != null) {
        await session.api.resubmitApplication(again.id, _payload());
      } else {
        await session.api.submitApplication(widget.type, _payload());
      }
      session.queries.invalidate('applications');
      if (mounted) {
        toast(
          context,
          again != null
              ? 'Changes sent — the reviewers look at it again.'
              : 'Application submitted — you will see every approval step here.',
        );
        if (again != null) {
          Navigator.of(context).pop();
        } else {
          context.go('/applications');
        }
      }
    } catch (e) {
      setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _gap() => const SizedBox(height: 14);

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final wf = workflows[widget.type];
    if (wf == null) {
      return const Scaffold(
        body: EmptyState(icon: LucideIcons.fileX, title: 'Unknown application type'),
      );
    }
    final fields = <Widget>[
      if (widget.type == 'company') ...[
        LabeledField(label: 'Company name', controller: f('name')),
        _gap(),
        LabeledField(label: 'Description', controller: f('description'), maxLines: 3),
        _gap(),
        Row(
          children: [
            Expanded(
              child: LabeledField(label: 'Website (optional)', controller: f('website'), keyboard: TextInputType.url),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: LabeledField(label: 'Country (optional)', controller: f('country')),
            ),
          ],
        ),
        _gap(),
        Text('Base currency', style: context.text.labelLarge?.copyWith(fontSize: 13.5)),
        const SizedBox(height: 7),
        DropdownButtonFormField<String>(
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
        _gap(),
        LabeledField(label: 'Business plan', controller: f('businessPlan'), maxLines: 4),
        _gap(),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          value: _list,
          onChanged: (v) => setState(() => _list = v),
          title: const Text('List the company on the stock exchange'),
          subtitle: const Text('Investors buy shares; 30% of each investment is frozen for 90 days.'),
        ),
        AnimatedSize(
          duration: const Duration(milliseconds: 250),
          child: _list
              ? Row(
                  children: [
                    Expanded(
                      child: LabeledField(label: 'Ticker', controller: f('ticker'), hint: 'NWS'),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: LabeledField(
                        label: 'Share price ($_currency)',
                        controller: f('sharePrice'),
                        keyboard: const TextInputType.numberWithOptions(decimal: true),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: LabeledField(
                        label: 'Total shares',
                        controller: f('totalShares'),
                        keyboard: TextInputType.number,
                      ),
                    ),
                  ],
                )
              : const SizedBox(width: double.infinity),
        ),
      ],
      if (widget.type == 'license') ...[
        Text('License type', style: context.text.labelLarge?.copyWith(fontSize: 13.5)),
        const SizedBox(height: 7),
        DropdownButtonFormField<String>(
          initialValue: _licenseType,
          items: [
            for (final e in licenseTypeLabels.entries.where((e) => e.key != 'business'))
              DropdownMenuItem(value: e.key, child: Text(e.value)),
          ],
          onChanged: (v) => setState(() => _licenseType = v ?? _licenseType),
        ),
        _gap(),
        LabeledField(label: 'Title', controller: f('title')),
        _gap(),
        LabeledField(label: 'Description', controller: f('description'), maxLines: 3),
        _gap(),
        LabeledField(label: 'Website (optional)', controller: f('website'), keyboard: TextInputType.url),
        _gap(),
        Text('Holder', style: context.text.labelLarge?.copyWith(fontSize: 13.5)),
        const SizedBox(height: 7),
        Query<List<Organization>>(
          client: session.queries,
          queryKey: 'orgs:mine',
          fetch: session.api.myOrganizations,
          builder: (context, s) => DropdownButtonFormField<String?>(
            initialValue: _orgId,
            items: [
              const DropdownMenuItem(value: null, child: Text('Me personally')),
              for (final o in s.data ?? const <Organization>[]) DropdownMenuItem(value: o.id, child: Text(o.name)),
            ],
            onChanged: (v) => setState(() => _orgId = v),
          ),
        ),
        _gap(),
        LabeledField(label: 'Details (optional)', controller: f('details'), maxLines: 3),
      ],
      if (widget.type == 'news_channel') ...[
        LabeledField(label: 'Channel title', controller: f('title')),
        _gap(),
        LabeledField(
          label: 'Handle',
          controller: f('handle'),
          hint: 'my_channel',
          helper: '4-32 letters, digits and underscores.',
        ),
        _gap(),
        LabeledField(label: 'Description', controller: f('description'), maxLines: 3),
      ],
      if (widget.type == 'moderator' || widget.type == 'council') ...[
        LabeledField(label: 'Motivation', controller: f('motivation'), maxLines: 4, helper: 'At least 20 characters.'),
        _gap(),
        LabeledField(label: 'Experience (optional)', controller: f('experience'), maxLines: 3),
      ],
    ];
    return Scaffold(
      appBar: AppBar(
        leading: BackButton(onPressed: () => context.go('/applications')),
        title: Text(wf.label),
      ),
      body: PageBody(
        maxWidth: 760,
        children: [
          FadeSlideIn(
            child: Text(wf.description, style: context.text.bodyLarge?.copyWith(color: context.c.text2)),
          ),
          const SizedBox(height: 14),
          OvlCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Caption('Approval steps'),
                const SizedBox(height: 10),
                for (final (i, s) in wf.stages.indexed)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          width: 24,
                          height: 24,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(gradient: context.ovl.gradient, shape: BoxShape.circle),
                          child: Text('${i + 1}', style: font(body, 12, FontWeight.w800, color: Colors.white)),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(s.label, style: context.text.titleSmall),
                              Text(s.description, style: context.text.bodySmall),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          if (_error != null) ...[ErrorBox(_error), const SizedBox(height: 14)],
          OvlCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: fields),
          ),
          const SizedBox(height: 18),
          GradientButton(label: 'Submit application', icon: LucideIcons.send, busy: _busy, onPressed: _submit),
        ],
      ),
    );
  }
}
