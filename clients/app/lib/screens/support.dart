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
import 'chats.dart';
import '../i18n/i18n.dart';

/// Tech support: people open tickets; moderators, admins and the owner answer them from the desk.
class SupportScreen extends StatefulWidget {
  const SupportScreen({super.key, this.selectedId});

  final String? selectedId;

  @override
  State<SupportScreen> createState() => _SupportScreenState();
}

class _SupportScreenState extends State<SupportScreen> {
  String _view = 'open';

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final staff = session.can('support.answer');
    final wide = MediaQuery.sizeOf(context).width >= 900;
    final list = _TicketList(
      staff: staff,
      view: staff ? _view : 'mine',
      onView: (v) => setState(() => _view = v),
      selectedId: widget.selectedId,
    );
    final conversation = widget.selectedId == null
        ? null
        : ConversationView(
            key: ValueKey(widget.selectedId),
            chatId: widget.selectedId!,
            embedded: wide,
            backTo: '/support',
            composerHint: staff ? tr('Answer as support…') : tr('Write to support…'),
            headerActions: staff
                ? (chat, refresh) => [
                    if (chat.support != null)
                      TextButton.icon(
                        onPressed: () async {
                          await session.api.setTicketStatus(
                            chat.id,
                            chat.support!.status == 'open' ? 'closed' : 'open',
                          );
                          session.queries.invalidate('support');
                          refresh();
                        },
                        icon: Icon(
                          chat.support!.status == 'open' ? LucideIcons.circleCheck : LucideIcons.rotateCcw,
                          size: 16,
                        ),
                        label: Text(chat.support!.status == 'open' ? tr('Close ticket') : tr('Reopen')),
                      ),
                  ]
                : null,
          );
    if (!wide) {
      return conversation ?? Scaffold(body: SafeArea(bottom: false, child: list));
    }
    return Scaffold(
      body: SafeArea(
        child: Row(
          children: [
            SizedBox(width: 360, child: list),
            VerticalDivider(width: 1, color: context.c.border),
            Expanded(
              child:
                  conversation ??
                  EmptyState(
                    icon: LucideIcons.lifeBuoy,
                    title: tr('We are here to help'),
                    text: staff
                        ? tr('Pick a ticket to answer it.')
                        : tr('Moderators and administrators answer tickets here.'),
                  ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TicketList extends StatelessWidget {
  const _TicketList({required this.staff, required this.view, required this.onView, required this.selectedId});

  final bool staff;
  final String view;
  final ValueChanged<String> onView;
  final String? selectedId;

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(18, 16, 12, 8),
          child: Row(
            children: [
              Expanded(
                child: Text(staff ? tr('Support desk') : tr('Tech support'), style: context.text.headlineMedium),
              ),
              FilledButton.icon(
                onPressed: () => showNewTicket(context),
                icon: const Icon(LucideIcons.plus, size: 17),
                label: Text(tr('Ticket')),
                style: FilledButton.styleFrom(minimumSize: const Size(0, 40)),
              ),
            ],
          ),
        ),
        if (staff)
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 4, 14, 8),
            child: Segmented<String>(
              value: view,
              options: const [('open', 'Open'), ('closed', 'Closed'), ('mine', 'My tickets')],
              onChanged: onView,
            ),
          ),
        Expanded(
          child: Query<List<Chat>>(
            client: session.queries,
            queryKey: 'support:$view',
            fetch: () => view == 'mine' ? session.api.myTickets() : session.api.supportDesk(view),
            builder: (context, s) {
              if (!s.hasData) return const SkeletonList();
              if (s.data!.isEmpty) {
                return EmptyState(
                  icon: LucideIcons.lifeBuoy,
                  title: view == 'mine' ? tr('No tickets yet') : tr('Nothing here'),
                  text: view == 'mine'
                      ? tr('Questions about deposits, applications or your account? Open a ticket.')
                      : null,
                );
              }
              return ListView(
                children: [
                  for (final (i, t) in s.data!.indexed)
                    FadeSlideIn(
                      delay: stagger(i, 25),
                      child: _TicketTile(ticket: t, staff: staff, selected: t.id == selectedId),
                    ),
                ],
              );
            },
          ),
        ),
      ],
    );
  }
}

class _TicketTile extends StatelessWidget {
  const _TicketTile({required this.ticket, required this.staff, required this.selected});

  final Chat ticket;
  final bool staff;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final requester = ticket.support?.requester;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      child: Material(
        color: selected ? c.accentSoft : Colors.transparent,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () => context.go('/support/${ticket.id}'),
          child: Padding(
            padding: const EdgeInsets.all(10),
            child: Row(
              children: [
                staff && requester != null
                    ? Avatar(name: requester.displayName, url: requester.avatarUrl, size: 44)
                    : IconTile(LucideIcons.lifeBuoy, size: 44, color: c.support),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              ticket.title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: context.text.titleMedium,
                            ),
                          ),
                          Text(listTime(ticket.activityAt), style: context.text.bodySmall),
                        ],
                      ),
                      const SizedBox(height: 3),
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              ticket.lastMessage?.body ?? '',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: context.text.bodyMedium?.copyWith(fontSize: 13),
                            ),
                          ),
                          if (ticket.support != null) ...[const SizedBox(width: 6), StatusPill(ticket.support!.status)],
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

void showNewTicket(BuildContext context) {
  final session = context.read<Session>();
  final subject = TextEditingController();
  final body = TextEditingController();
  var busy = false;
  Object? error;
  showModalBottomSheet<void>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    builder: (sheet) => StatefulBuilder(
      builder: (sheet, set) => Padding(
        padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.viewInsetsOf(sheet).bottom),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(tr('New support ticket'), style: sheet.text.headlineSmall),
            const SizedBox(height: 4),
            Text(tr('Moderators usually answer within a few hours.'), style: sheet.text.bodyMedium),
            const SizedBox(height: 16),
            if (error != null) ...[ErrorBox(error), const SizedBox(height: 12)],
            LabeledField(label: tr('Subject'), controller: subject, icon: LucideIcons.tag),
            const SizedBox(height: 12),
            LabeledField(label: tr('How can we help?'), controller: body, maxLines: 4),
            const SizedBox(height: 18),
            GradientButton(
              label: tr('Open ticket'),
              busy: busy,
              onPressed: () async {
                set(() => busy = true);
                try {
                  final t = await session.api.openTicket(subject.text.trim(), body.text.trim());
                  session.queries.invalidate('support');
                  if (sheet.mounted) Navigator.pop(sheet);
                  if (context.mounted) context.go('/support/${t.id}');
                } catch (e) {
                  set(() {
                    busy = false;
                    error = e;
                  });
                }
              },
            ),
          ],
        ),
      ),
    ),
  );
}
