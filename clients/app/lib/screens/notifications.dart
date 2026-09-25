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

const _icons = <String, IconData>{
  'mention': LucideIcons.atSign,
  'reply': LucideIcons.reply,
  'comment': LucideIcons.messageSquareText,
  'money': LucideIcons.wallet,
  'invoice': LucideIcons.receipt,
  'payment_approval': LucideIcons.shieldCheck,
  'application': LucideIcons.fileText,
  'identity': LucideIcons.userCheck,
  'cash_request': LucideIcons.banknote,
  'licence': LucideIcons.award,
};

/// The notification center: mentions, replies, payments, invoices, approvals and application news.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  bool _unreadOnly = false;

  Future<void> _open(Session session, AppNotification n) async {
    if (!n.read) {
      await session.api.readNotifications([n.id]).catchError((_) => 0);
      session.queries.invalidate('notifications');
    }
    if (mounted && n.link != null) context.go(n.link!);
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final c = context.c;
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Query<NotificationPage>(
          client: session.queries,
          queryKey: 'notifications:${_unreadOnly ? 'unread' : 'all'}',
          fetch: () => session.api.notifications(unreadOnly: _unreadOnly, limit: 100),
          builder: (context, s) {
            final page = s.data;
            return PageBody(
              onRefresh: () async => session.queries.invalidate('notifications'),
              children: [
                PageTitle(
                  icon: LucideIcons.bell,
                  title: 'Notifications',
                  subtitle: 'Mentions, replies, payments, invoices, approvals and news about your applications.',
                  actions: [
                    OutlinedButton.icon(
                      onPressed: (page?.unreadCount ?? 0) == 0
                          ? null
                          : () async {
                              await session.api.readNotifications();
                              session.queries.invalidate('notifications');
                            },
                      icon: const Icon(LucideIcons.checkCheck, size: 17),
                      label: const Text('Mark all as read'),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                Align(
                  alignment: Alignment.centerLeft,
                  child: SegmentedButton<bool>(
                    segments: [
                      const ButtonSegment(value: false, label: Text('All')),
                      ButtonSegment(
                        value: true,
                        label: Text((page?.unreadCount ?? 0) > 0 ? 'Unread (${page!.unreadCount})' : 'Unread'),
                      ),
                    ],
                    selected: {_unreadOnly},
                    onSelectionChanged: (v) => setState(() => _unreadOnly = v.first),
                  ),
                ),
                const SizedBox(height: 14),
                if (s.error != null) ErrorBox(s.error, onRetry: () => s.fetch()),
                if (page == null && s.error == null) const SkeletonList(rows: 5),
                if (page != null && page.items.isEmpty)
                  EmptyState(
                    icon: LucideIcons.bellOff,
                    title: _unreadOnly ? 'All caught up' : 'Nothing yet',
                    text: 'Mentions, payments and approvals show up here.',
                  ),
                if (page != null && page.items.isNotEmpty)
                  OvlCard(
                    padding: EdgeInsets.zero,
                    child: Column(
                      children: [
                        for (final (i, n) in page.items.indexed) ...[
                          if (i > 0) Divider(height: 1, color: c.border),
                          Dismissible(
                            key: ValueKey(n.id),
                            direction: DismissDirection.endToStart,
                            background: Container(
                              color: c.danger,
                              alignment: Alignment.centerRight,
                              padding: const EdgeInsets.only(right: 20),
                              child: const Icon(LucideIcons.trash2, color: Colors.white),
                            ),
                            onDismissed: (_) async {
                              await session.api.deleteNotification(n.id).catchError((_) {});
                              session.queries.invalidate('notifications');
                            },
                            child: ListTile(
                              tileColor: n.read ? null : c.accentSoft.withValues(alpha: 0.5),
                              leading: CircleAvatar(
                                backgroundColor: c.surface2,
                                child: Icon(_icons[n.type] ?? LucideIcons.bell, size: 18, color: c.accent),
                              ),
                              title: Text(
                                n.title,
                                style: TextStyle(fontWeight: n.read ? FontWeight.w500 : FontWeight.w700),
                              ),
                              subtitle: n.body.isEmpty
                                  ? null
                                  : Text(n.body, maxLines: 2, overflow: TextOverflow.ellipsis),
                              trailing: Text(listTime(n.createdAt), style: context.text.bodySmall),
                              onTap: () => _open(session, n),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
              ],
            );
          },
        ),
      ),
    );
  }
}
