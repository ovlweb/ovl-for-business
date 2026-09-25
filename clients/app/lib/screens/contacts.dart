import 'dart:async';

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
import '../i18n/i18n.dart';

Future<void> openDirectChat(BuildContext context, String userId) async {
  final session = context.read<Session>();
  try {
    final chat = await session.api.directChat(userId);
    session.queries.invalidate('chats');
    if (context.mounted) context.go('/chats/${chat.id}');
  } catch (e) {
    if (context.mounted) toast(context, errorText(e), error: true);
  }
}

class ContactsScreen extends StatefulWidget {
  const ContactsScreen({super.key});

  @override
  State<ContactsScreen> createState() => _ContactsScreenState();
}

class _ContactsScreenState extends State<ContactsScreen> {
  final _search = TextEditingController();
  Timer? _debounce;
  List<UserSummary>? _results;
  bool _searching = false;

  void _onSearch(String q) {
    _debounce?.cancel();
    if (q.trim().length < 2) {
      setState(() => _results = null);
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 300), () async {
      setState(() => _searching = true);
      try {
        final r = await context.read<Session>().api.searchUsers(q.trim());
        if (mounted) setState(() => _results = r);
      } finally {
        if (mounted) setState(() => _searching = false);
      }
    });
  }

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: PageBody(
          maxWidth: 820,
          children: [
            _Header(
              icon: LucideIcons.users,
              title: tr('Contacts'),
              subtitle: tr('Your partners. Groups can only include people from here.'),
            ),
            const SizedBox(height: 18),
            TextField(
              controller: _search,
              onChanged: _onSearch,
              decoration: InputDecoration(
                hintText: tr('Search by name or username'),
                prefixIcon: const Icon(LucideIcons.search, size: 18),
                suffixIcon: _searching
                    ? const Padding(
                        padding: EdgeInsets.all(14),
                        child: SizedBox.square(dimension: 16, child: CircularProgressIndicator(strokeWidth: 2)),
                      )
                    : null,
              ),
            ),
            const SizedBox(height: 16),
            Query<List<Contact>>(
              client: session.queries,
              queryKey: 'contacts',
              fetch: session.api.contacts,
              builder: (context, s) {
                final contacts = s.data ?? const <Contact>[];
                final ids = contacts.map((c) => c.id).toSet();
                if (_results != null) {
                  return OvlCard(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: _results!.isEmpty
                        ? EmptyState(icon: LucideIcons.search, title: tr('Nobody found'))
                        : Column(
                            children: [
                              for (final (i, u) in _results!.indexed)
                                FadeSlideIn(
                                  delay: stagger(i),
                                  child: _PersonTile(
                                    user: u,
                                    isContact: ids.contains(u.id),
                                    isMe: u.id == session.me?.id,
                                  ),
                                ),
                            ],
                          ),
                  );
                }
                if (!s.hasData) return const SkeletonList();
                if (contacts.isEmpty) {
                  return EmptyState(
                    icon: LucideIcons.userPlus,
                    title: tr('No contacts yet'),
                    text: tr('Search for people above and add them.'),
                  );
                }
                return OvlCard(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Column(
                    children: [
                      for (final (i, u) in contacts.indexed)
                        FadeSlideIn(
                          delay: stagger(i),
                          child: _PersonTile(user: u, isContact: true, isMe: false),
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

class _PersonTile extends StatelessWidget {
  const _PersonTile({required this.user, required this.isContact, required this.isMe});

  final UserSummary user;
  final bool isContact;
  final bool isMe;

  @override
  Widget build(BuildContext context) {
    final session = context.read<Session>();
    return ListTile(
      onTap: () => context.push('/u/${user.username}'),
      leading: Avatar(name: user.displayName, url: user.avatarUrl, size: 42),
      title: NameWithBadges(user),
      subtitle: Text('@${user.username} · ${tr(roleLabels[user.role] ?? user.role)}'),
      trailing: isMe
          ? Text(tr('You'))
          : Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (!isContact)
                  TextButton.icon(
                    onPressed: () async {
                      try {
                        await session.api.addContact(user.username);
                        session.queries.invalidate('contacts');
                        if (context.mounted) toast(context, tr('{0} added to contacts', [user.displayName]));
                      } catch (e) {
                        if (context.mounted) toast(context, errorText(e), error: true);
                      }
                    },
                    icon: const Icon(LucideIcons.userPlus, size: 16),
                    label: Text(tr('Add')),
                  )
                else
                  Padding(
                    padding: const EdgeInsets.only(right: 4),
                    child: Text(tr('In contacts'), style: context.text.bodySmall),
                  ),
                IconButton(
                  tooltip: tr('Message'),
                  onPressed: () => openDirectChat(context, user.id),
                  icon: const Icon(LucideIcons.messageCircle, size: 19),
                ),
              ],
            ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.icon, required this.title, required this.subtitle});

  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) => PageTitle(icon: icon, title: title, subtitle: subtitle);
}

/// Page heading with a gradient icon, as on the web.
class PageTitle extends StatelessWidget {
  const PageTitle({super.key, required this.icon, required this.title, this.subtitle, this.actions = const []});

  final IconData icon;
  final String title;
  final String? subtitle;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final narrow = MediaQuery.sizeOf(context).width < 600;
    final heading = Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 46,
          height: 46,
          decoration: BoxDecoration(
            gradient: context.ovl.gradient,
            borderRadius: BorderRadius.circular(14),
            boxShadow: [
              BoxShadow(color: context.c.gradFrom.withValues(alpha: 0.3), blurRadius: 14, offset: const Offset(0, 6)),
            ],
          ),
          child: Icon(icon, color: Colors.white, size: 22),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: context.text.headlineMedium),
              if (subtitle != null) ...[const SizedBox(height: 3), Text(subtitle!, style: context.text.bodyMedium)],
            ],
          ),
        ),
        if (!narrow) ...actions.map((a) => Padding(padding: const EdgeInsets.only(left: 8), child: a)),
      ],
    );
    return FadeSlideIn(
      child: narrow && actions.isNotEmpty
          ? Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                heading,
                const SizedBox(height: 12),
                Wrap(spacing: 8, runSpacing: 8, children: actions),
              ],
            )
          : heading,
    );
  }
}

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key, required this.username});

  final String username;

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    return Scaffold(
      appBar: AppBar(title: Text('@$username')),
      body: Query<UserProfile>(
        client: session.queries,
        queryKey: 'user:$username',
        fetch: () => session.api.user(username),
        builder: (context, s) {
          if (s.error != null && !s.hasData) {
            return Padding(padding: const EdgeInsets.all(16), child: ErrorBox(s.error));
          }
          if (!s.hasData) return const Center(child: CircularProgressIndicator());
          final u = s.data!;
          final isMe = u.id == session.me?.id;
          return PageBody(
            maxWidth: 640,
            children: [
              FadeSlideIn(
                child: OvlCard(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    children: [
                      Hero(
                        tag: 'avatar-${u.id}',
                        child: Avatar(name: u.displayName, url: u.avatarUrl, size: 96),
                      ),
                      const SizedBox(height: 14),
                      Text(u.displayName, style: context.text.headlineMedium, textAlign: TextAlign.center),
                      const SizedBox(height: 4),
                      Text('@${u.username} · ${tr(roleLabels[u.role] ?? u.role)}', style: context.text.bodyMedium),
                      if (u.badges.isNotEmpty) ...[const SizedBox(height: 10), Badges(u.badges)],
                      if (u.bio.isNotEmpty) ...[
                        const SizedBox(height: 14),
                        Text(u.bio, textAlign: TextAlign.center, style: context.text.bodyLarge),
                      ],
                      const SizedBox(height: 8),
                      Text(tr('Member since {0}', [date(u.createdAt)]), style: context.text.bodySmall),
                      if (!isMe) ...[
                        const SizedBox(height: 20),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            FilledButton.icon(
                              onPressed: () => openDirectChat(context, u.id),
                              icon: const Icon(LucideIcons.messageCircle, size: 17),
                              label: Text(tr('Message')),
                            ),
                            const SizedBox(width: 10),
                            if (!u.isContact)
                              OutlinedButton.icon(
                                onPressed: () async {
                                  try {
                                    await session.api.addContact(u.username);
                                    session.queries.invalidate('contacts');
                                    session.queries.invalidate('user:$username');
                                  } catch (e) {
                                    if (context.mounted) toast(context, errorText(e), error: true);
                                  }
                                },
                                icon: const Icon(LucideIcons.userPlus, size: 17),
                                label: Text(tr('Add contact')),
                              )
                            else
                              OutlinedButton.icon(
                                onPressed: null,
                                icon: const Icon(LucideIcons.userCheck, size: 17),
                                label: Text(tr('In contacts')),
                              ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
