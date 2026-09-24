import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/models.dart';
import '../state/query.dart';
import '../state/session.dart';
import '../theme/theme.dart';
import '../ui/format.dart';
import '../ui/theme_gallery.dart';
import '../ui/widgets.dart';

const _sections = <(String, IconData, String, String)>[
  ('profile', LucideIcons.user, 'Profile', 'Name, bio and avatar'),
  ('appearance', LucideIcons.palette, 'Appearance', 'Themes'),
  ('accounts', LucideIcons.users, 'Accounts', 'Signed in on this device'),
  ('security', LucideIcons.lock, 'Security', 'Password'),
  ('server', LucideIcons.server, 'Server', 'Self-hosted deployments'),
  ('about', LucideIcons.info, 'About', 'Version and licenses'),
];

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key, this.section});

  final String? section;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late String? _section = widget.section;

  @override
  void didUpdateWidget(SettingsScreen old) {
    super.didUpdateWidget(old);
    if (old.section != widget.section) _section = widget.section;
  }

  Widget _content(String id) => switch (id) {
    'appearance' => const _Appearance(),
    'accounts' => const _Accounts(),
    'security' => const _Security(),
    'server' => const _Server(),
    'about' => const _About(),
    _ => const _Profile(),
  };

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width >= 900;
    final c = context.c;
    final current = _section ?? (wide ? 'profile' : null);
    final nav = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final s in _sections)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Material(
              color: current == s.$1 && wide ? c.accentSoft : Colors.transparent,
              borderRadius: BorderRadius.circular(14),
              child: ListTile(
                leading: IconTile(s.$2, size: 36),
                title: Text(s.$3, style: context.text.titleSmall),
                subtitle: Text(s.$4, style: context.text.bodySmall),
                trailing: wide ? null : const Icon(LucideIcons.chevronRight, size: 18),
                onTap: () => setState(() => _section = s.$1),
              ),
            ),
          ),
      ],
    );
    if (!wide && current != null) {
      final s = _sections.firstWhere((x) => x.$1 == current, orElse: () => _sections.first);
      return Scaffold(
        appBar: AppBar(
          leading: BackButton(onPressed: () => setState(() => _section = null)),
          title: Text(s.$3),
        ),
        body: PageBody(
          maxWidth: 820,
          children: [FadeSlideIn(key: ValueKey(current), child: _content(current))],
        ),
      );
    }
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: PageBody(
          children: [
            const _Title(),
            const SizedBox(height: 18),
            if (wide)
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(width: 280, child: nav),
                  const SizedBox(width: 24),
                  Expanded(
                    child: AnimatedSwitcher(
                      duration: const Duration(milliseconds: 250),
                      child: KeyedSubtree(key: ValueKey(current), child: _content(current!)),
                    ),
                  ),
                ],
              )
            else
              nav,
          ],
        ),
      ),
    );
  }
}

class _Title extends StatelessWidget {
  const _Title();

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 46,
          height: 46,
          decoration: BoxDecoration(gradient: context.ovl.gradient, borderRadius: BorderRadius.circular(14)),
          child: const Icon(LucideIcons.settings, color: Colors.white, size: 22),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Settings', style: context.text.headlineMedium),
              Text('Your profile, appearance, accounts and security.', style: context.text.bodyMedium),
            ],
          ),
        ),
      ],
    );
  }
}

class _Profile extends StatefulWidget {
  const _Profile();

  @override
  State<_Profile> createState() => _ProfileState();
}

class _ProfileState extends State<_Profile> {
  late final Me _me = context.read<Session>().me!;
  late final _name = TextEditingController(text: _me.displayName);
  late final _bio = TextEditingController(text: _me.bio);
  late final _avatar = TextEditingController(text: _me.avatarUrl ?? '');
  bool _busy = false;
  Object? _error;

  @override
  Widget build(BuildContext context) {
    final me = context.watch<Session>().me!;
    return OvlCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Avatar(name: me.displayName, url: me.avatarUrl, size: 64),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    NameWithBadges(me, style: context.text.titleLarge),
                    Text('@${me.username} · ${me.email}', style: context.text.bodySmall),
                    Text(roleLabels[me.role] ?? me.role, style: context.text.bodySmall),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          if (_error != null) ...[ErrorBox(_error), const SizedBox(height: 12)],
          LabeledField(label: 'Display name', controller: _name),
          const SizedBox(height: 14),
          LabeledField(label: 'About you', controller: _bio, maxLines: 3),
          const SizedBox(height: 14),
          LabeledField(label: 'Avatar image URL', controller: _avatar, keyboard: TextInputType.url, hint: 'https://…'),
          const SizedBox(height: 18),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton(
              onPressed: _busy
                  ? null
                  : () async {
                      setState(() {
                        _busy = true;
                        _error = null;
                      });
                      try {
                        await context.read<Session>().updateProfile(
                          displayName: _name.text.trim(),
                          bio: _bio.text.trim(),
                          avatarUrl: _avatar.text.trim(),
                        );
                        if (context.mounted) toast(context, 'Profile saved');
                      } catch (e) {
                        setState(() => _error = e);
                      } finally {
                        if (mounted) setState(() => _busy = false);
                      }
                    },
              child: const Text('Save profile'),
            ),
          ),
        ],
      ),
    );
  }
}

class _Appearance extends StatelessWidget {
  const _Appearance();

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Theme', style: context.text.titleLarge),
        const SizedBox(height: 4),
        Text('Your choice follows your account to the web client and every device.', style: context.text.bodyMedium),
        const SizedBox(height: 14),
        ThemeGallery(
          value: session.themes.preference,
          onChanged: (id, origin) async {
            try {
              await session.setTheme(id, origin: origin);
              if (context.mounted) {
                toast(
                  context,
                  id == 'system' ? 'Following your system theme' : '${paletteById(id).name} theme applied',
                );
              }
            } catch (e) {
              if (context.mounted) toast(context, errorText(e), error: true);
            }
          },
        ),
      ],
    );
  }
}

class _Accounts extends StatelessWidget {
  const _Accounts();

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final me = session.me!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        OvlCard(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Column(
            children: [
              for (final a in session.accounts.accounts)
                ListTile(
                  leading: Avatar(name: a.displayName, url: a.avatarUrl, size: 40),
                  title: Row(
                    children: [
                      Flexible(child: Text(a.displayName, overflow: TextOverflow.ellipsis)),
                      const SizedBox(width: 6),
                      Badges(a.badges),
                    ],
                  ),
                  subtitle: Text('@${a.username}${a.id == me.id ? ' · active' : ''}'),
                  trailing: a.id == me.id
                      ? Icon(LucideIcons.circleCheck, color: context.c.success, size: 20)
                      : TextButton(onPressed: () => session.switchAccount(a.id), child: const Text('Switch')),
                ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 10,
          runSpacing: 10,
          children: [
            FilledButton.icon(
              onPressed: session.startAddAccount,
              icon: const Icon(LucideIcons.userPlus, size: 17),
              label: const Text('Add another account'),
            ),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(foregroundColor: context.c.danger),
              onPressed: session.logout,
              icon: const Icon(LucideIcons.logOut, size: 17),
              label: Text('Sign out of @${me.username}'),
            ),
          ],
        ),
      ],
    );
  }
}

class _Security extends StatefulWidget {
  const _Security();

  @override
  State<_Security> createState() => _SecurityState();
}

class _SecurityState extends State<_Security> {
  final _current = TextEditingController();
  final _next = TextEditingController();
  bool _busy = false;
  Object? _error;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        OvlCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Change password', style: context.text.titleLarge),
              const SizedBox(height: 4),
              Text('Every other device is signed out; this one stays signed in.', style: context.text.bodyMedium),
              const SizedBox(height: 16),
              if (_error != null) ...[ErrorBox(_error), const SizedBox(height: 12)],
              LabeledField(label: 'Current password', controller: _current, obscure: true),
              const SizedBox(height: 14),
              LabeledField(label: 'New password', controller: _next, obscure: true, helper: 'At least 8 characters.'),
              const SizedBox(height: 18),
              Align(
                alignment: Alignment.centerRight,
                child: FilledButton(
                  onPressed: _busy
                      ? null
                      : () async {
                          final session = context.read<Session>();
                          setState(() {
                            _busy = true;
                            _error = null;
                          });
                          try {
                            await session.api.changePassword(_current.text, _next.text);
                            _current.clear();
                            _next.clear();
                            session.queries.invalidate('sessions');
                            if (context.mounted) {
                              toast(context, 'Password changed — your other devices were signed out');
                            }
                          } catch (e) {
                            if (mounted) setState(() => _error = e);
                          } finally {
                            if (mounted) setState(() => _busy = false);
                          }
                        },
                  child: const Text('Change password'),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        const _Devices(),
      ],
    );
  }
}

IconData _deviceIcon(String kind) => switch (kind) {
  'desktop' => LucideIcons.monitor,
  'mobile' || 'app' => LucideIcons.smartphone,
  'tablet' => LucideIcons.tablet,
  'api' => LucideIcons.terminal,
  _ => LucideIcons.globe,
};

/// Devices signed in to the account, with remote sign-out.
class _Devices extends StatelessWidget {
  const _Devices();

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    Future<void> run(Future<String> Function() action) async {
      try {
        final message = await action();
        session.queries.invalidate('sessions');
        if (context.mounted) toast(context, message);
      } catch (e) {
        if (context.mounted) toast(context, errorText(e), error: true);
      }
    }

    return Query<List<SessionInfo>>(
      client: session.queries,
      queryKey: 'sessions',
      fetch: session.api.sessions,
      builder: (context, s) {
        final list = s.data ?? const <SessionInfo>[];
        final others = list.where((d) => !d.current).length;
        return OvlCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Signed-in devices', style: context.text.titleLarge),
              const SizedBox(height: 4),
              Text(
                'Every browser and app where this account is signed in. Sign out anything you do not recognise — it stops working immediately.',
                style: context.text.bodyMedium,
              ),
              const SizedBox(height: 10),
              if (!s.hasData)
                const SkeletonList(rows: 2)
              else
                for (final d in list)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: IconTile(_deviceIcon(d.kind), size: 40),
                    title: Row(
                      children: [
                        Flexible(child: Text(d.device, overflow: TextOverflow.ellipsis)),
                        if (d.current) ...[const SizedBox(width: 8), const StatusPill('this device')],
                      ],
                    ),
                    subtitle: Text(
                      '${d.ip == null ? '' : '${d.ip} · '}${d.current ? 'Active now' : 'Last active ${timeAgo(d.lastUsedAt)}'} · signed in ${date(d.createdAt)}',
                    ),
                    trailing: d.current
                        ? null
                        : TextButton(
                            onPressed: () => run(() async {
                              await session.api.signOutSession(d.id);
                              return '${d.device} signed out';
                            }),
                            child: const Text('Sign out'),
                          ),
                  ),
              if (others > 0) ...[
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerLeft,
                  child: OutlinedButton.icon(
                    onPressed: () => run(() async {
                      final n = await session.api.signOutOtherSessions();
                      return 'Signed out ${plural(n, 'other device')}';
                    }),
                    icon: const Icon(LucideIcons.logOut, size: 17),
                    label: const Text('Sign out all other devices'),
                  ),
                ),
              ],
            ],
          ),
        );
      },
    );
  }
}

class _Server extends StatefulWidget {
  const _Server();

  @override
  State<_Server> createState() => _ServerState();
}

class _ServerState extends State<_Server> {
  late final _url = TextEditingController(text: context.read<Session>().server);

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    return OvlCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Server address', style: context.text.titleLarge),
          const SizedBox(height: 4),
          Text('All accounts on this device use this server.', style: context.text.bodyMedium),
          const SizedBox(height: 14),
          LabeledField(label: 'URL', controller: _url, icon: LucideIcons.globe, keyboard: TextInputType.url),
          const SizedBox(height: 14),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              TextButton.icon(
                onPressed: () => launchUrl(Uri.parse('${session.server}/api/docs')),
                icon: const Icon(LucideIcons.bookOpen, size: 16),
                label: const Text('API documentation'),
              ),
              const SizedBox(width: 8),
              FilledButton(
                onPressed: () async {
                  await session.setServer(_url.text);
                  if (context.mounted) toast(context, 'Server saved');
                },
                child: const Text('Save'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _About extends StatelessWidget {
  const _About();

  @override
  Widget build(BuildContext context) {
    return OvlCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Logo(size: 52),
              const SizedBox(width: 14),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('OVL For Business', style: context.text.titleLarge),
                  Text('Native app · version 0.1.0', style: context.text.bodySmall),
                ],
              ),
            ],
          ),
          const SizedBox(height: 16),
          Text(
            'Corporate accounts, balances in every world currency, licenses, a public registry, a stock exchange and messaging — '
            'one platform for web, Android, iOS, macOS, Windows and Linux.',
            style: context.text.bodyMedium,
          ),
          const SizedBox(height: 14),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              OutlinedButton(
                onPressed: () =>
                    showLicensePage(context: context, applicationName: 'OVL For Business', applicationVersion: '0.1.0'),
                child: const Text('Open-source licenses'),
              ),
              OutlinedButton(onPressed: () => context.go('/support'), child: const Text('Contact support')),
            ],
          ),
        ],
      ),
    );
  }
}
