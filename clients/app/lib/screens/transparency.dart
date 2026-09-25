import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../state/query.dart';
import '../state/session.dart';
import '../theme/theme.dart';
import '../ui/format.dart';
import '../ui/widgets.dart';
import 'contacts.dart';

const _sections = <String, String>{
  'applications': 'Applications',
  'council': 'Council',
  'moderation': 'Moderation',
  'support': 'Support',
  'registry': 'Registry',
  'economy': 'Economy',
};

const _labels = <String, String>{
  'received': 'Received',
  'approved': 'Approved',
  'rejected': 'Not approved',
  'changesRequested': 'Sent back for changes',
  'medianDecisionHours': 'Median hours to decide',
  'members': 'Members',
  'votes': 'Votes cast',
  'approvals': 'For',
  'rejections': 'Against',
  'accountsSuspended': 'Accounts suspended',
  'identityApproved': 'Identities verified',
  'identityRejected': 'Identity checks declined',
  'registryRevoked': 'Licences revoked or suspended',
  'ticketsOpened': 'Tickets opened',
  'ticketsOpenNow': 'Tickets open now',
  'added': 'Entries added',
  'expired': 'Expired',
  'active': 'Active',
  'newAccounts': 'New accounts',
  'companiesListed': 'Companies listed',
  'investments': 'Investments',
  'trades': 'Trades',
};

/// How the platform is governed: council rules and members, and published transparency reports.
class TransparencyScreen extends StatelessWidget {
  const TransparencyScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: PageBody(
          onRefresh: () async => session.queries.invalidate('transparency'),
          children: [
            const PageTitle(
              icon: LucideIcons.award,
              title: 'Transparency',
              subtitle: 'Council rules, members, and regular reports on how decisions were made.',
            ),
            const SizedBox(height: 16),
            Query<GovernanceInfo>(
              client: session.queries,
              queryKey: 'transparency:governance',
              fetch: session.api.governance,
              builder: (context, s) {
                final g = s.data;
                if (g == null) return s.error != null ? ErrorBox(s.error) : const SkeletonList(rows: 2);
                return OvlCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('How decisions are made', style: context.text.titleMedium),
                      const SizedBox(height: 6),
                      Text(
                        'A council vote needs ${plural(g.votesNeeded, 'vote')} of '
                        '${plural(g.activeCouncilMembers, 'member')} (${g.votingLabel}). Council seats '
                        '${g.councilTermMonths > 0 ? 'last ${plural(g.councilTermMonths, 'month')}' : 'have no fixed term'}.',
                      ),
                      const SizedBox(height: 10),
                      Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        children: [
                          for (final c in g.council)
                            Chip(
                              label: Text(
                                c.termEndsAt == null
                                    ? c.user.displayName
                                    : '${c.user.displayName} · until ${dayLabel(c.termEndsAt!)}',
                              ),
                            ),
                        ],
                      ),
                    ],
                  ),
                );
              },
            ),
            const SizedBox(height: 16),
            Query<List<TransparencyReport>>(
              client: session.queries,
              queryKey: 'transparency:reports',
              fetch: session.api.transparencyReports,
              builder: (context, s) {
                final reports = s.data;
                if (reports == null) return s.error != null ? ErrorBox(s.error) : const SkeletonList(rows: 3);
                if (reports.isEmpty) {
                  return const EmptyState(
                    icon: LucideIcons.fileText,
                    title: 'No reports yet',
                    text: 'Reports on how the platform was governed appear here.',
                  );
                }
                return Column(children: [for (final r in reports) _ReportCard(r)]);
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _ReportCard extends StatelessWidget {
  const _ReportCard(this.report);

  final TransparencyReport report;

  @override
  Widget build(BuildContext context) {
    final r = report;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: OvlCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(r.title, style: context.text.titleLarge),
            Text('${dayLabel(r.periodStart)} – ${dayLabel(r.periodEnd)}', style: context.text.bodySmall),
            if (r.notes.isNotEmpty) ...[const SizedBox(height: 8), Text(r.notes)],
            const SizedBox(height: 10),
            Wrap(
              spacing: 24,
              runSpacing: 12,
              children: [
                for (final section in _sections.entries)
                  if (r.stats[section.key] is Map)
                    SizedBox(
                      width: 240,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(section.value, style: context.text.titleSmall),
                          for (final e in (r.stats[section.key] as Map).entries)
                            if (e.value is num || e.value == null)
                              Row(
                                children: [
                                  Expanded(child: Text(_labels[e.key] ?? e.key, style: context.text.bodySmall)),
                                  Text('${e.value ?? '—'}', style: TextStyle(color: context.c.text)),
                                ],
                              ),
                        ],
                      ),
                    ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
