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
import 'applications.dart';
import 'contacts.dart';
import '../i18n/i18n.dart';

/// Staff review queue: applications waiting for a decision at a stage the reviewer's role acts on.
class ReviewScreen extends StatelessWidget {
  const ReviewScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Query<List<Application>>(
          client: session.queries,
          queryKey: 'applications:queue',
          fetch: session.api.reviewQueue,
          builder: (context, s) => PageBody(
            onRefresh: () => s.fetch(),
            children: [
              PageTitle(
                icon: LucideIcons.clipboardCheck,
                title: tr('Review queue'),
                subtitle: tr(
                  'Applications waiting for a decision from your role. Moderators confirm every checklist item.',
                ),
              ),
              const SizedBox(height: 18),
              if (!s.hasData)
                const SkeletonList()
              else if (s.data!.isEmpty)
                EmptyState(
                  icon: LucideIcons.partyPopper,
                  title: tr('All caught up'),
                  text: tr('Nothing is waiting for you.'),
                )
              else
                for (final (i, a) in s.data!.indexed)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: FadeSlideIn(
                      delay: stagger(i),
                      child: OvlCard(
                        onTap: () => context.go('/review/${a.id}'),
                        child: Row(
                          children: [
                            Avatar(name: a.applicant.displayName, url: a.applicant.avatarUrl, size: 44),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(a.title, style: context.text.titleMedium),
                                  Text(
                                    '${workflows[a.type]?.label} · @${a.applicant.username} · ${timeAgo(a.createdAt)}',
                                    style: context.text.bodySmall,
                                  ),
                                  const SizedBox(height: 8),
                                  WorkflowSteps(application: a),
                                ],
                              ),
                            ),
                            const Icon(LucideIcons.chevronRight, size: 18),
                          ],
                        ),
                      ),
                    ),
                  ),
            ],
          ),
        ),
      ),
    );
  }
}

class ReviewDetailScreen extends StatefulWidget {
  const ReviewDetailScreen({super.key, required this.id});

  final String id;

  @override
  State<ReviewDetailScreen> createState() => _ReviewDetailScreenState();
}

class _ReviewDetailScreenState extends State<ReviewDetailScreen> {
  final Set<String> _checked = {};
  final _comment = TextEditingController();
  String? _busy;
  Object? _error;

  Future<void> _decide(Application a, String decision) async {
    final session = context.read<Session>();
    setState(() {
      _busy = decision;
      _error = null;
    });
    try {
      final updated = await session.api.review(
        a.id,
        decision: decision,
        comment: _comment.text.trim(),
        checklist: decision == 'approve' ? _checked.toList() : null,
      );
      session.queries.setData<Application>('applications:${a.id}', (_) => updated);
      session.queries.invalidate('applications');
      _checked.clear();
      _comment.clear();
      if (mounted) {
        toast(context, switch (decision) {
          'approve' => tr('Approved — {0}', [
            updated.currentStage == null ? tr('the application is complete') : tr('moved to the next stage'),
          ]),
          'request_changes' => tr('Sent back to the applicant for changes'),
          _ => tr('Rejected'),
        });
      }
    } catch (e) {
      setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final c = context.c;
    return Scaffold(
      appBar: AppBar(
        leading: BackButton(onPressed: () => context.go('/review')),
        title: Text(tr('Review')),
      ),
      body: Query<Application>(
        client: session.queries,
        queryKey: 'applications:${widget.id}',
        fetch: () => session.api.application(widget.id),
        builder: (context, s) {
          if (!s.hasData) {
            return s.error != null
                ? Padding(padding: const EdgeInsets.all(16), child: ErrorBox(s.error))
                : const Center(child: CircularProgressIndicator());
          }
          final a = s.data!;
          final wf = workflows[a.type];
          final stage = a.status == 'pending' && wf != null && a.stageIndex < wf.stages.length
              ? wf.stages[a.stageIndex]
              : null;
          final checklist = stage?.checklist ?? const <ChecklistItem>[];
          final allChecked = checklist.every((i) => _checked.contains(i.key));
          return PageBody(
            maxWidth: 860,
            children: [
              FadeSlideIn(
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(a.title, style: context.text.headlineLarge),
                          Text(wf?.label ?? a.type, style: context.text.bodyMedium),
                        ],
                      ),
                    ),
                    StatusPill(a.status),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              WorkflowSteps(application: a),
              const SizedBox(height: 16),
              OvlCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Avatar(name: a.applicant.displayName, url: a.applicant.avatarUrl, size: 40),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              NameWithBadges(a.applicant),
                              Text(
                                '@${a.applicant.username} · submitted ${dateTime(a.createdAt)}',
                                style: context.text.bodySmall,
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const Divider(height: 28),
                    for (final e in a.payload.entries)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Caption(
                              humanize(
                                e.key.replaceAllMapped(
                                  RegExp(r'([a-z])([A-Z])'),
                                  (m) => '${m[1]} ${m[2]!.toLowerCase()}',
                                ),
                              ),
                            ),
                            const SizedBox(height: 3),
                            Text(
                              e.value is Map
                                  ? (e.value as Map).entries
                                        .map((x) => '${humanize(x.key as String)}: ${x.value}')
                                        .join(' · ')
                                  : e.key == 'licenseType'
                                  ? tr(licenseTypeLabels[e.value] ?? '${e.value}')
                                  : e.value is bool
                                  ? (e.value as bool ? tr('Yes') : tr('No'))
                                  : '${e.value}'.isEmpty
                                  ? '—'
                                  : '${e.value}',
                              style: context.text.bodyLarge?.copyWith(fontSize: 14.5),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
              if (a.reviews.isNotEmpty) ...[
                const SizedBox(height: 16),
                Text(tr('Decisions so far'), style: context.text.titleLarge),
                const SizedBox(height: 8),
                for (final r in a.reviews)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: IconTile(
                      switch (r.decision) {
                        'approve' => LucideIcons.check,
                        'request_changes' => LucideIcons.pencil,
                        _ => LucideIcons.x,
                      },
                      size: 34,
                      color: switch (r.decision) {
                        'approve' => c.success,
                        'request_changes' => c.warning,
                        _ => c.danger,
                      },
                    ),
                    title: Row(
                      children: [
                        Flexible(child: NameWithBadges(r.reviewer)),
                        const SizedBox(width: 6),
                        Text(
                          '· ${wf?.stages.where((s) => s.key == r.stageKey).firstOrNull?.label ?? r.stageKey}',
                          style: context.text.bodySmall,
                        ),
                      ],
                    ),
                    subtitle: Text(
                      r.comment.isEmpty ? timeAgo(r.createdAt) : '“${r.comment}” · ${timeAgo(r.createdAt)}',
                    ),
                  ),
              ],
              if (stage != null) ...[
                const SizedBox(height: 16),
                OvlCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(tr('Current stage: {0}', [stage.label]), style: context.text.titleLarge),
                      const SizedBox(height: 4),
                      Text(stage.description, style: context.text.bodyMedium),
                      if (checklist.isNotEmpty) ...[
                        const SizedBox(height: 12),
                        Caption(tr('Confirm you reviewed')),
                        for (final item in checklist)
                          CheckboxListTile(
                            contentPadding: EdgeInsets.zero,
                            controlAffinity: ListTileControlAffinity.leading,
                            value: _checked.contains(item.key),
                            title: Text(item.label),
                            onChanged: (_) => setState(
                              () => _checked.contains(item.key) ? _checked.remove(item.key) : _checked.add(item.key),
                            ),
                          ),
                      ],
                      const SizedBox(height: 12),
                      LabeledField(
                        label: tr('Comment'),
                        controller: _comment,
                        maxLines: 2,
                        helper: tr('Required when rejecting or asking for changes.'),
                      ),
                      if (a.attachments.isNotEmpty) ...[
                        const SizedBox(height: 12),
                        Caption(tr('Documents')),
                        const SizedBox(height: 6),
                        AttachmentChips(files: a.attachments),
                      ],
                      if (_error != null) ...[const SizedBox(height: 12), ErrorBox(_error)],
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          Expanded(
                            child: OutlinedButton.icon(
                              style: OutlinedButton.styleFrom(
                                foregroundColor: c.danger,
                                side: BorderSide(color: c.danger.withValues(alpha: 0.4)),
                              ),
                              onPressed: _busy != null ? null : () => _decide(a, 'reject'),
                              icon: const Icon(LucideIcons.x, size: 17),
                              label: Text(tr('Reject')),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: _busy != null ? null : () => _decide(a, 'request_changes'),
                              icon: const Icon(LucideIcons.pencil, size: 17),
                              label: Text(tr('Ask for changes')),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: FilledButton.icon(
                              style: FilledButton.styleFrom(backgroundColor: c.success),
                              onPressed: _busy != null || !allChecked ? null : () => _decide(a, 'approve'),
                              icon: _busy == 'approve'
                                  ? const SizedBox.square(
                                      dimension: 16,
                                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                                    )
                                  : const Icon(LucideIcons.check, size: 17),
                              label: Text(tr('Approve')),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ],
          );
        },
      ),
    );
  }
}
