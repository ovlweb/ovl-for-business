import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../api/realtime.dart';
import '../app.dart';
import '../state/query.dart';
import '../state/session.dart';
import '../theme/theme.dart';
import '../ui/format.dart';
import '../ui/widgets.dart';
import '../i18n/i18n.dart';

const navIcons = <String, IconData>{
  'home': LucideIcons.house,
  'chats': LucideIcons.messageCircle,
  'contacts': LucideIcons.users,
  'notifications': LucideIcons.bell,
  'wallet': LucideIcons.wallet,
  'invoices': LucideIcons.receipt,
  'companies': LucideIcons.building2,
  'exchange': LucideIcons.chartLine,
  'registry': LucideIcons.bookOpen,
  'applications': LucideIcons.fileText,
  'transparency': LucideIcons.award,
  'support': LucideIcons.lifeBuoy,
  'review': LucideIcons.clipboardCheck,
  'settings': LucideIcons.settings,
};

class AppShell extends StatefulWidget {
  const AppShell({super.key, required this.shell, required this.location});

  final StatefulNavigationShell shell;
  final String location;

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  bool _collapsed = false;

  List<Section> _visible(Session s) => sections
      .where((x) => (!x.staffOnly || (s.me?.isStaff ?? false)) && (x.permission == null || s.can(x.permission!)))
      .toList();

  void _go(Section section) {
    final index = sections.indexOf(section);
    widget.shell.goBranch(index, initialLocation: index == widget.shell.currentIndex);
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final visible = _visible(session);
    final current = sections[widget.shell.currentIndex];
    final width = MediaQuery.sizeOf(context).width;

    return Query<List<Chat>>(
      client: session.queries,
      queryKey: 'chats',
      fetch: session.api.chats,
      builder: (context, chats) => Query<List<Invoice>>(
        client: session.queries,
        queryKey: 'invoices:incoming:true',
        fetch: () => session.api.invoices(direction: 'incoming', status: 'open'),
        builder: (context, toPay) => Query<NotificationPage>(
          client: session.queries,
          queryKey: 'notifications:count',
          fetch: () => session.api.notifications(unreadOnly: true, limit: 1),
          builder: (context, inbox) => _layout(context, visible, current, width, {
            '/chats': chats.data?.fold<int>(0, (s, c) => s + c.unreadCount) ?? 0,
            '/invoices': toPay.data?.length ?? 0,
            '/notifications': inbox.data?.unreadCount ?? 0,
          }),
        ),
      ),
    );
  }

  Widget _layout(BuildContext context, List<Section> visible, Section current, double width, Map<String, int> counts) {
    final shortcuts = <ShortcutActivator, VoidCallback>{
      const SingleActivator(LogicalKeyboardKey.keyK, control: true): () => openPalette(context, visible, _go),
      const SingleActivator(LogicalKeyboardKey.keyK, meta: true): () => openPalette(context, visible, _go),
    };
    if (width < 700) {
      return CallbackShortcuts(
        bindings: shortcuts,
        child: Scaffold(
          body: widget.shell,
          // A conversation gets the whole screen, like in any messenger.
          bottomNavigationBar: RegExp(r'^/(chats|support)/[^/]+$').hasMatch(widget.location)
              ? null
              : _BottomBar(visible: visible, current: current, counts: counts, onSelect: _go),
        ),
      );
    }
    final collapsed = _collapsed || width < 1100;
    return CallbackShortcuts(
      bindings: shortcuts,
      child: Focus(
        autofocus: true,
        child: Scaffold(
          body: Row(
            children: [
              _Sidebar(
                visible: visible,
                current: current,
                counts: counts,
                collapsed: collapsed,
                onSelect: _go,
                onToggle: width < 1100 ? null : () => setState(() => _collapsed = !_collapsed),
                onSearch: () => openPalette(context, visible, _go),
              ),
              Expanded(child: widget.shell),
            ],
          ),
        ),
      ),
    );
  }
}

class _Sidebar extends StatelessWidget {
  const _Sidebar({
    required this.visible,
    required this.current,
    required this.counts,
    required this.collapsed,
    required this.onSelect,
    required this.onToggle,
    required this.onSearch,
  });

  final List<Section> visible;
  final Section current;
  final Map<String, int> counts;
  final bool collapsed;
  final ValueChanged<Section> onSelect;
  final VoidCallback? onToggle;
  final VoidCallback onSearch;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final groups = <String>[];
    for (final s in visible) {
      if (!groups.contains(s.group)) groups.add(s.group);
    }
    return AnimatedContainer(
      duration: const Duration(milliseconds: 280),
      curve: Curves.easeOutCubic,
      width: collapsed ? 80 : 264,
      decoration: BoxDecoration(
        color: c.sidebarBg,
        border: Border(right: BorderSide(color: c.sidebarBorder)),
      ),
      child: SafeArea(
        right: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: EdgeInsets.fromLTRB(collapsed ? 20 : 18, 18, 10, 14),
              child: Row(
                children: [
                  const Logo(size: 38),
                  if (!collapsed) ...[
                    const SizedBox(width: 11),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(tr('OVL For Business'), style: font(display, 15, FontWeight.w800, color: c.sidebarText)),
                          Text(tr('Corporate platform'), style: TextStyle(fontSize: 11.5, color: c.sidebarMuted)),
                        ],
                      ),
                    ),
                    if (onToggle != null)
                      IconButton(
                        tooltip: tr('Collapse sidebar'),
                        onPressed: onToggle,
                        icon: Icon(LucideIcons.panelLeft, size: 18, color: c.sidebarMuted),
                      ),
                  ],
                ],
              ),
            ),
            Padding(
              padding: EdgeInsets.symmetric(horizontal: collapsed ? 14 : 14),
              child: Material(
                color: c.sidebarText.withValues(alpha: 0.05),
                borderRadius: BorderRadius.circular(12),
                child: InkWell(
                  borderRadius: BorderRadius.circular(12),
                  onTap: onSearch,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    child: Row(
                      mainAxisAlignment: collapsed ? MainAxisAlignment.center : MainAxisAlignment.start,
                      children: [
                        Icon(LucideIcons.search, size: 17, color: c.sidebarMuted),
                        if (!collapsed) ...[
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(tr('Search…'), style: TextStyle(color: c.sidebarMuted, fontSize: 13.5)),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              border: Border.all(color: c.sidebarBorder),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Text(tr('Ctrl K'), style: TextStyle(color: c.sidebarMuted, fontSize: 10.5)),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 10),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                children: [
                  for (final g in groups) ...[
                    if (!collapsed)
                      Padding(
                        padding: const EdgeInsets.fromLTRB(12, 14, 12, 6),
                        child: Text(
                          g.toUpperCase(),
                          style: font(body, 11, FontWeight.w700, letterSpacing: 0.8, color: c.sidebarMuted),
                        ),
                      )
                    else
                      const SizedBox(height: 10),
                    for (final s in visible.where((s) => s.group == g))
                      _NavItem(
                        section: s,
                        active: s == current,
                        count: counts[s.path] ?? 0,
                        collapsed: collapsed,
                        onTap: () => onSelect(s),
                      ),
                  ],
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(12),
              child: AccountButton(collapsed: collapsed),
            ),
          ],
        ),
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.section,
    required this.active,
    required this.count,
    required this.collapsed,
    required this.onTap,
  });

  final Section section;
  final bool active;
  final int count;
  final bool collapsed;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final fg = active ? c.sidebarActiveText : c.sidebarText;
    final item = AnimatedContainer(
      duration: const Duration(milliseconds: 220),
      margin: const EdgeInsets.symmetric(vertical: 2),
      decoration: BoxDecoration(
        color: active ? c.sidebarActiveBg : Colors.transparent,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          child: Padding(
            padding: EdgeInsets.symmetric(horizontal: collapsed ? 0 : 12, vertical: 10),
            child: Row(
              mainAxisAlignment: collapsed ? MainAxisAlignment.center : MainAxisAlignment.start,
              children: [
                Badge(
                  isLabelVisible: collapsed && count > 0,
                  label: Text('$count'),
                  backgroundColor: c.accent,
                  child: Icon(section.icon, size: 19, color: active ? c.sidebarActiveText : c.sidebarMuted),
                ),
                if (!collapsed) ...[
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      section.label,
                      style: font(body, 14, active ? FontWeight.w700 : FontWeight.w600, color: fg),
                    ),
                  ),
                  if (count > 0) _CountPill(count),
                ],
              ],
            ),
          ),
        ),
      ),
    );
    return collapsed ? Tooltip(message: section.label, child: item) : item;
  }
}

class _CountPill extends StatelessWidget {
  const _CountPill(this.count);

  final int count;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1.5),
      decoration: BoxDecoration(color: context.c.accent, borderRadius: BorderRadius.circular(999)),
      child: Text(count > 99 ? '99+' : '$count', style: font(body, 11, FontWeight.w800, color: context.c.accentText)),
    );
  }
}

class _BottomBar extends StatelessWidget {
  const _BottomBar({required this.visible, required this.current, required this.counts, required this.onSelect});

  final List<Section> visible;
  final Section current;
  final Map<String, int> counts;
  final ValueChanged<Section> onSelect;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final primary = visible.where((s) => s.primary).toList();
    final more = visible.where((s) => !s.primary).toList();
    final index = primary.contains(current) ? primary.indexOf(current) : primary.length;
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: c.border)),
      ),
      child: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (i) {
          if (i < primary.length) {
            onSelect(primary[i]);
          } else {
            showMoreSheet(context, more, onSelect);
          }
        },
        destinations: [
          for (final s in primary)
            NavigationDestination(
              icon: Badge(
                isLabelVisible: (counts[s.path] ?? 0) > 0,
                label: Text('${counts[s.path]}'),
                backgroundColor: c.accent,
                child: Icon(s.icon),
              ),
              label: s.label,
            ),
          NavigationDestination(icon: Icon(LucideIcons.ellipsis), label: tr('More')),
        ],
      ),
    );
  }
}

void showMoreSheet(BuildContext context, List<Section> more, ValueChanged<Section> onSelect) {
  showModalBottomSheet<void>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    builder: (sheet) {
      final session = sheet.read<Session>();
      final me = session.me!;
      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ListTile(
                leading: Avatar(name: me.displayName, url: me.avatarUrl, size: 44),
                title: NameWithBadges(me),
                subtitle: Text('@${me.username}'),
                trailing: TextButton(
                  onPressed: () {
                    Navigator.pop(sheet);
                    showAccountSheet(context);
                  },
                  child: Text(tr('Switch')),
                ),
              ),
              const Divider(height: 18),
              GridView.count(
                shrinkWrap: true,
                crossAxisCount: 3,
                childAspectRatio: 1.25,
                mainAxisSpacing: 8,
                crossAxisSpacing: 8,
                physics: const NeverScrollableScrollPhysics(),
                children: [
                  for (final s in more)
                    OvlCard(
                      padding: const EdgeInsets.all(10),
                      onTap: () {
                        Navigator.pop(sheet);
                        onSelect(s);
                      },
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          IconTile(s.icon, size: 38),
                          const SizedBox(height: 8),
                          Text(s.label, textAlign: TextAlign.center, maxLines: 2, style: sheet.text.labelMedium),
                        ],
                      ),
                    ),
                ],
              ),
            ],
          ),
        ),
      );
    },
  );
}

/// Sidebar footer: the active account, realtime status and the account menu.
class AccountButton extends StatelessWidget {
  const AccountButton({super.key, this.collapsed = false});

  final bool collapsed;

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final me = session.me!;
    final c = context.c;
    final status = session.realtimeStatus;
    final avatar = status == null
        ? Avatar(name: me.displayName, url: me.avatarUrl, size: 38)
        : ValueListenableBuilder<RealtimeStatus>(
            valueListenable: status,
            builder: (_, s, _) =>
                Avatar(name: me.displayName, url: me.avatarUrl, size: 38, online: s == RealtimeStatus.open),
          );
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => showAccountSheet(context),
        child: Padding(
          padding: const EdgeInsets.all(8),
          child: Row(
            mainAxisAlignment: collapsed ? MainAxisAlignment.center : MainAxisAlignment.start,
            children: [
              avatar,
              if (!collapsed) ...[
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        me.displayName,
                        overflow: TextOverflow.ellipsis,
                        style: font(body, 14, FontWeight.w700, color: c.sidebarText),
                      ),
                      Text(tr(roleLabels[me.role] ?? me.role), style: TextStyle(fontSize: 12, color: c.sidebarMuted)),
                    ],
                  ),
                ),
                Icon(LucideIcons.chevronsUpDown, size: 16, color: c.sidebarMuted),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Accounts on this device: switch, add another, themes, settings, sign out.
void showAccountSheet(BuildContext context) {
  showModalBottomSheet<void>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    constraints: const BoxConstraints(maxWidth: 480),
    builder: (sheet) {
      final session = sheet.watch<Session>();
      final me = session.me;
      if (me == null) return const SizedBox(height: 120);
      final others = session.accounts.accounts.where((a) => a.id != me.id).toList();
      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ListTile(
                leading: Avatar(name: me.displayName, url: me.avatarUrl, size: 46),
                title: NameWithBadges(me),
                subtitle: Text('@${me.username} · ${tr(roleLabels[me.role] ?? me.role)}'),
              ),
              if (others.isNotEmpty) ...[
                const Divider(height: 16),
                Padding(padding: const EdgeInsets.fromLTRB(16, 4, 16, 4), child: Caption(tr('Switch account'))),
                for (final a in others)
                  ListTile(
                    leading: Avatar(name: a.displayName, url: a.avatarUrl, size: 34),
                    title: Text(a.displayName),
                    subtitle: Text('@${a.username}'),
                    trailing: const Icon(LucideIcons.arrowRightLeft, size: 17),
                    onTap: () {
                      Navigator.pop(sheet);
                      session.switchAccount(a.id);
                    },
                  ),
              ],
              const Divider(height: 16),
              ListTile(
                leading: const Icon(LucideIcons.userPlus, size: 20),
                title: Text(tr('Add another account')),
                onTap: () {
                  Navigator.pop(sheet);
                  session.startAddAccount();
                },
              ),
              ListTile(
                leading: const Icon(LucideIcons.palette, size: 20),
                title: Text(tr('Themes')),
                onTap: () {
                  Navigator.pop(sheet);
                  GoRouter.of(context).go('/settings?section=appearance');
                },
              ),
              ListTile(
                leading: const Icon(LucideIcons.settings, size: 20),
                title: Text(tr('Settings')),
                onTap: () {
                  Navigator.pop(sheet);
                  GoRouter.of(context).go('/settings');
                },
              ),
              ListTile(
                leading: Icon(LucideIcons.logOut, size: 20, color: sheet.c.danger),
                title: Text(tr('Sign out'), style: TextStyle(color: sheet.c.danger)),
                onTap: () {
                  Navigator.pop(sheet);
                  session.logout();
                },
              ),
            ],
          ),
        ),
      );
    },
  );
}

/// The in-app banner for a message that arrived in another chat.
class MessageBanner extends StatelessWidget {
  const MessageBanner({super.key, required this.incoming, required this.onTap});

  final IncomingMessage incoming;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final sender = incoming.message.sender;
    final chat = incoming.chat;
    final title = sender == null
        ? (chat?.title ?? tr('New message'))
        : (chat != null && chat.type != 'direct' ? '${sender.displayName} · ${chat.title}' : sender.displayName);
    return Material(
      color: c.surface,
      elevation: 12,
      shadowColor: Colors.black38,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: BorderSide(color: c.border),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Avatar(name: sender?.displayName ?? chat?.title ?? '?', url: sender?.avatarUrl, size: 40),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.text.titleSmall),
                    Text(
                      incoming.message.body,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: context.text.bodyMedium,
                    ),
                  ],
                ),
              ),
              Text(shortTime(incoming.message.createdAt), style: context.text.bodySmall),
            ],
          ),
        ),
      ),
    );
  }
}

/// Ctrl/⌘ + K: jump to a page, a chat or a person.
void openPalette(BuildContext context, List<Section> visible, ValueChanged<Section> onSection) {
  showDialog<void>(
    context: context,
    barrierColor: Colors.black.withValues(alpha: 0.35),
    builder: (dialog) => _Palette(visible: visible, onSection: onSection),
  );
}

class _Palette extends StatefulWidget {
  const _Palette({required this.visible, required this.onSection});

  final List<Section> visible;
  final ValueChanged<Section> onSection;

  @override
  State<_Palette> createState() => _PaletteState();
}

class _PaletteState extends State<_Palette> {
  final _q = TextEditingController();
  List<UserSummary> _people = [];
  String _searched = '';

  Future<void> _search(String q) async {
    _searched = q;
    if (q.trim().length < 2) {
      setState(() => _people = []);
      return;
    }
    try {
      final result = await context.read<Session>().api.searchUsers(q.trim());
      if (mounted && _searched == q) setState(() => _people = result.take(5).toList());
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final session = context.read<Session>();
    final needle = _q.text.trim().toLowerCase();
    final pages = widget.visible.where((s) => needle.isEmpty || s.label.toLowerCase().contains(needle)).toList();
    final chats = needle.isEmpty
        ? <Chat>[]
        : (session.queries.peek<List<Chat>>('chats') ?? [])
              .where((c) => c.title.toLowerCase().contains(needle))
              .take(5)
              .toList();
    final router = GoRouter.of(context);
    return Dialog(
      alignment: const Alignment(0, -0.6),
      insetPadding: const EdgeInsets.all(16),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560, maxHeight: 480),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.all(12),
              child: TextField(
                controller: _q,
                autofocus: true,
                onChanged: (v) {
                  setState(() {});
                  _search(v);
                },
                decoration: InputDecoration(
                  hintText: tr('Search pages, chats and people…'),
                  prefixIcon: Icon(LucideIcons.search, size: 18),
                ),
              ),
            ),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                padding: const EdgeInsets.fromLTRB(8, 0, 8, 12),
                children: [
                  if (pages.isNotEmpty) _PaletteGroup(tr('Pages')),
                  for (final s in pages)
                    ListTile(
                      dense: true,
                      leading: Icon(s.icon, size: 18),
                      title: Text(s.label),
                      onTap: () {
                        Navigator.pop(context);
                        widget.onSection(s);
                      },
                    ),
                  if (chats.isNotEmpty) _PaletteGroup(tr('Chats')),
                  for (final c in chats)
                    ListTile(
                      dense: true,
                      leading: Avatar(name: c.title, url: c.peer?.avatarUrl, size: 28),
                      title: Text(c.title),
                      onTap: () {
                        Navigator.pop(context);
                        router.go('/chats/${c.id}');
                      },
                    ),
                  if (_people.isNotEmpty) _PaletteGroup(tr('People')),
                  for (final u in _people)
                    ListTile(
                      dense: true,
                      leading: Avatar(name: u.displayName, url: u.avatarUrl, size: 28),
                      title: NameWithBadges(u),
                      subtitle: Text('@${u.username}'),
                      onTap: () {
                        Navigator.pop(context);
                        router.push('/u/${u.username}');
                      },
                    ),
                  if (pages.isEmpty && chats.isEmpty && _people.isEmpty)
                    Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text(
                        tr('No results for “{0}”', [_q.text]),
                        textAlign: TextAlign.center,
                        style: context.text.bodyMedium,
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PaletteGroup extends StatelessWidget {
  const _PaletteGroup(this.title);

  final String title;

  @override
  Widget build(BuildContext context) =>
      Padding(padding: const EdgeInsets.fromLTRB(16, 10, 16, 4), child: Caption(title));
}
