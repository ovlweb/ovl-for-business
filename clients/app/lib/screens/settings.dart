import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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
import '../i18n/i18n.dart';

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
    _ => const Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [_Profile(), SizedBox(height: 16), _Email(), SizedBox(height: 16), _Identity()],
    ),
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
                title: Text(tr(s.$3), style: context.text.titleSmall),
                subtitle: Text(tr(s.$4), style: context.text.bodySmall),
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
          title: Text(tr(s.$3)),
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
              Text(tr('Settings'), style: context.text.headlineMedium),
              Text(tr('Your profile, appearance, accounts and security.'), style: context.text.bodyMedium),
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
                    Text(tr(roleLabels[me.role] ?? me.role), style: context.text.bodySmall),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          if (_error != null) ...[ErrorBox(_error), const SizedBox(height: 12)],
          LabeledField(label: tr('Display name'), controller: _name),
          const SizedBox(height: 14),
          LabeledField(label: tr('About you'), controller: _bio, maxLines: 3),
          const SizedBox(height: 14),
          LabeledField(
            label: tr('Avatar image URL'),
            controller: _avatar,
            keyboard: TextInputType.url,
            hint: 'https://…',
          ),
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
                        if (context.mounted) toast(context, tr('Profile saved'));
                      } catch (e) {
                        setState(() => _error = e);
                      } finally {
                        if (mounted) setState(() => _busy = false);
                      }
                    },
              child: Text(tr('Save profile')),
            ),
          ),
        ],
      ),
    );
  }
}

/// Identity verification status; documents are sent from the web app, which can upload photos.
class _Identity extends StatelessWidget {
  const _Identity();

  @override
  Widget build(BuildContext context) {
    final me = context.watch<Session>().me!;
    return OvlCard(
      child: Row(
        children: [
          IconTile(LucideIcons.shieldCheck, size: 42, color: me.identityVerified ? context.c.success : null),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(tr('Identity'), style: context.text.titleMedium),
                const SizedBox(height: 2),
                Text(
                  me.identityVerified
                      ? tr('Verified. Companies you own show the verified business badge.')
                      : tr(
                          'Company owners pass a one-time identity check. Send your document from the web app: Settings → Identity.',
                        ),
                  style: context.text.bodySmall,
                ),
              ],
            ),
          ),
          StatusPill(me.identityVerified ? 'verified' : 'not verified'),
        ],
      ),
    );
  }
}

/// The account's email: confirmed or not, send the link again, change the address.
class _Email extends StatefulWidget {
  const _Email();

  @override
  State<_Email> createState() => _EmailState();
}

class _EmailState extends State<_Email> {
  bool _changing = false;
  bool _busy = false;
  Object? _error;
  final _email = TextEditingController();
  final _password = TextEditingController();

  Future<void> _run(Future<void> Function() action, String done) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
      if (mounted) toast(context, done);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final me = session.me!;
    final c = context.c;
    return OvlCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(tr('Email'), style: context.text.titleMedium),
                    const SizedBox(height: 4),
                    Text(me.email, style: context.text.bodyMedium),
                  ],
                ),
              ),
              StatusPill(me.emailVerified ? 'confirmed' : 'not confirmed'),
            ],
          ),
          if (_error != null) ...[const SizedBox(height: 12), ErrorBox(_error)],
          if (!me.emailVerified && !_changing) ...[
            const SizedBox(height: 12),
            Text(
              tr(
                'Confirm your address with the link we emailed you. Applications for companies and licenses need a confirmed email.',
              ),
              style: context.text.bodySmall?.copyWith(color: c.warning),
            ),
          ],
          const SizedBox(height: 12),
          if (_changing) ...[
            LabeledField(
              label: tr('New email'),
              controller: _email,
              icon: LucideIcons.mail,
              keyboard: TextInputType.emailAddress,
            ),
            const SizedBox(height: 12),
            LabeledField(label: tr('Your password'), controller: _password, icon: LucideIcons.keyRound, obscure: true),
            const SizedBox(height: 14),
          ],
          Wrap(
            spacing: 8,
            runSpacing: 8,
            alignment: WrapAlignment.end,
            children: [
              if (!me.emailVerified && !_changing)
                OutlinedButton(
                  onPressed: _busy
                      ? null
                      : () => _run(session.api.resendVerification, tr('Link sent to {0}', [me.email])),
                  child: Text(tr('Send the link again')),
                ),
              if (_changing) TextButton(onPressed: () => setState(() => _changing = false), child: Text(tr('Cancel'))),
              FilledButton(
                onPressed: _busy
                    ? null
                    : _changing
                    ? () => _run(() async {
                        await session.api.changeEmail(_email.text.trim(), _password.text);
                        await session.reload();
                        if (mounted) setState(() => _changing = false);
                      }, tr('Check {0} for a confirmation link', [_email.text.trim()]))
                    : () => setState(() => _changing = true),
                child: Text(_changing ? tr('Change email') : tr('Change email…')),
              ),
            ],
          ),
          const Divider(height: 28),
          SwitchListTile.adaptive(
            contentPadding: EdgeInsets.zero,
            value: me.preferences.statementEmails,
            title: Text(tr('Monthly statements by email')),
            subtitle: Text(
              tr('A PDF statement of every balance that moved, at the start of each month.{0}', [
                me.emailVerified ? '' : ' ${tr('Confirm your email first.')}',
              ]),
            ),
            onChanged: (on) => session
                .updatePreferences({'statementEmails': on})
                .then((_) {
                  if (context.mounted) toast(context, on ? tr('Monthly statements on') : tr('Monthly statements off'));
                })
                .catchError((Object e) {
                  if (context.mounted) toast(context, errorText(e), error: true);
                }),
          ),
          SwitchListTile.adaptive(
            contentPadding: EdgeInsets.zero,
            value: me.preferences.pushChats,
            title: Text(tr('Push new messages')),
            subtitle: Text(tr('Also push direct and group messages to your devices while you are away.')),
            onChanged: (on) => session
                .updatePreferences({'pushChats': on})
                .then((_) {
                  if (context.mounted) toast(context, on ? tr('Message pushes on') : tr('Message pushes off'));
                })
                .catchError((Object e) {
                  if (context.mounted) toast(context, errorText(e), error: true);
                }),
          ),
          SwitchListTile.adaptive(
            contentPadding: EdgeInsets.zero,
            value: me.preferences.readReceipts,
            title: Text(tr('Read receipts')),
            subtitle: Text(
              tr('Show others when you have read their messages. When off, you do not see theirs either.'),
            ),
            onChanged: (on) => session
                .updatePreferences({'readReceipts': on})
                .then((_) {
                  if (context.mounted) toast(context, on ? tr('Read receipts on') : tr('Read receipts off'));
                })
                .catchError((Object e) {
                  if (context.mounted) toast(context, errorText(e), error: true);
                }),
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
        Text(tr('Language'), style: context.text.titleLarge),
        const SizedBox(height: 4),
        Text(tr('For the web app, the admin panel and the apps on every device.'), style: context.text.bodyMedium),
        const SizedBox(height: 14),
        Segmented<String>(
          value: session.locales.code,
          options: [for (final code in appLocales) (code, localeNames[code]!)],
          onChanged: (code) async {
            try {
              await session.setLocale(code);
            } catch (e) {
              if (context.mounted) toast(context, errorText(e), error: true);
            }
          },
        ),
        const SizedBox(height: 28),
        Text(tr('Theme'), style: context.text.titleLarge),
        const SizedBox(height: 4),
        Text(
          tr('Your choice follows your account to the web client and every device.'),
          style: context.text.bodyMedium,
        ),
        const SizedBox(height: 14),
        ThemeGallery(
          value: session.themes.preference,
          onChanged: (id, origin) async {
            try {
              await session.setTheme(id, origin: origin);
              if (context.mounted) {
                toast(
                  context,
                  id == 'system' ? tr('Following your system theme') : tr('{0} theme applied', [paletteById(id).name]),
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
                      : TextButton(onPressed: () => session.switchAccount(a.id), child: Text(tr('Switch'))),
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
              label: Text(tr('Add another account')),
            ),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(foregroundColor: context.c.danger),
              onPressed: session.logout,
              icon: const Icon(LucideIcons.logOut, size: 17),
              label: Text(tr('Sign out of @{0}', [me.username])),
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
              Text(tr('Change password'), style: context.text.titleLarge),
              const SizedBox(height: 4),
              Text(tr('Every other device is signed out; this one stays signed in.'), style: context.text.bodyMedium),
              const SizedBox(height: 16),
              if (_error != null) ...[ErrorBox(_error), const SizedBox(height: 12)],
              LabeledField(label: tr('Current password'), controller: _current, obscure: true),
              const SizedBox(height: 14),
              LabeledField(
                label: tr('New password'),
                controller: _next,
                obscure: true,
                helper: tr('At least 8 characters.'),
              ),
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
                              toast(context, tr('Password changed — your other devices were signed out'));
                            }
                          } catch (e) {
                            if (mounted) setState(() => _error = e);
                          } finally {
                            if (mounted) setState(() => _busy = false);
                          }
                        },
                  child: Text(tr('Change password')),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        const _TwoFactor(),
        const SizedBox(height: 16),
        const _Devices(),
      ],
    );
  }
}

/// Two-step verification: authenticator app codes plus one-time recovery codes.
class _TwoFactor extends StatelessWidget {
  const _TwoFactor();

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    return Query<TwoFactorStatus>(
      client: session.queries,
      queryKey: '2fa',
      fetch: session.api.twoFactorStatus,
      builder: (context, q) {
        final s = q.data;
        return OvlCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(child: Text(tr('Two-step verification'), style: context.text.titleLarge)),
                  if (s != null) StatusPill(s.enabled ? 'active' : 'off'),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                s?.enabled ?? false
                    ? tr('Signing in asks for a code from your authenticator app. {0} left.', [
                        plural(s!.recoveryCodesLeft, 'recovery code'),
                      ])
                    : tr(
                        'Protect the account with a code from an authenticator app, so a stolen password is not enough.',
                      ),
                style: context.text.bodyMedium,
              ),
              const SizedBox(height: 14),
              if (s != null)
                Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  children: s.enabled
                      ? [
                          OutlinedButton(
                            onPressed: () => _confirm(context, newCodes: true),
                            child: Text(tr('New recovery codes')),
                          ),
                          OutlinedButton(
                            style: OutlinedButton.styleFrom(foregroundColor: context.c.danger),
                            onPressed: () => _confirm(context, newCodes: false),
                            child: Text(tr('Turn off')),
                          ),
                        ]
                      : [
                          FilledButton.icon(
                            onPressed: () => _enable(context),
                            icon: const Icon(LucideIcons.shieldCheck, size: 17),
                            label: Text(tr('Turn on')),
                          ),
                        ],
                ),
            ],
          ),
        );
      },
    );
  }

  Future<void> _enable(BuildContext context) async {
    final session = context.read<Session>();
    final code = TextEditingController();
    final setupFuture = session.api.twoFactorSetup();
    List<String>? recovery;
    Object? error;
    var busy = false;
    await showModalBottomSheet<void>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      builder: (sheet) => StatefulBuilder(
        builder: (sheet, set) => Padding(
          padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.viewInsetsOf(sheet).bottom),
          child: SingleChildScrollView(
            child: recovery != null
                ? _RecoveryCodes(codes: recovery!, onDone: () => Navigator.pop(sheet))
                : FutureBuilder<Json>(
                    future: setupFuture,
                    builder: (sheet, snap) {
                      final data = snap.data;
                      return Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(tr('Turn on two-step verification'), style: sheet.text.headlineSmall),
                          const SizedBox(height: 6),
                          Text(
                            tr(
                              'Scan the QR code with an authenticator app (Google Authenticator, 1Password, Authy…), then enter the 6-digit code it shows.',
                            ),
                            style: sheet.text.bodyMedium,
                          ),
                          const SizedBox(height: 16),
                          if (snap.hasError) ErrorBox(snap.error),
                          if (data != null) ...[
                            Center(
                              child: Container(
                                padding: const EdgeInsets.all(8),
                                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14)),
                                child: Image.memory(
                                  base64Decode((data['qr'] as String).split(',').last),
                                  width: 180,
                                  height: 180,
                                ),
                              ),
                            ),
                            const SizedBox(height: 12),
                            SelectableText(
                              RegExp('.{1,4}').allMatches(data['secret'] as String).map((m) => m[0]).join(' '),
                              textAlign: TextAlign.center,
                              style: const TextStyle(fontFamily: 'monospace', fontSize: 15, letterSpacing: 1),
                            ),
                          ] else if (!snap.hasError)
                            const Center(
                              child: Padding(padding: EdgeInsets.all(40), child: CircularProgressIndicator()),
                            ),
                          const SizedBox(height: 16),
                          if (error != null) ...[ErrorBox(error), const SizedBox(height: 12)],
                          TextField(
                            controller: code,
                            keyboardType: TextInputType.number,
                            textAlign: TextAlign.center,
                            maxLength: 6,
                            onChanged: (_) => set(() {}),
                            style: font(display, 22, FontWeight.w800, letterSpacing: 8, color: sheet.c.text),
                            decoration: InputDecoration(
                              counterText: '',
                              labelText: tr('Code from the app'),
                              hintText: '123456',
                            ),
                          ),
                          const SizedBox(height: 16),
                          GradientButton(
                            label: tr('Turn on'),
                            busy: busy,
                            onPressed: data == null || code.text.trim().length != 6
                                ? null
                                : () async {
                                    set(() {
                                      busy = true;
                                      error = null;
                                    });
                                    try {
                                      final codes = await session.api.enableTwoFactor(code.text.trim());
                                      session.queries.invalidate('2fa');
                                      set(() => recovery = codes);
                                    } catch (e) {
                                      set(() => error = e);
                                    } finally {
                                      set(() => busy = false);
                                    }
                                  },
                          ),
                        ],
                      );
                    },
                  ),
          ),
        ),
      ),
    );
  }

  /// New recovery codes or turning it off: both confirm with a code (and the password to turn off).
  Future<void> _confirm(BuildContext context, {required bool newCodes}) async {
    final session = context.read<Session>();
    final password = TextEditingController();
    final code = TextEditingController();
    List<String>? recovery;
    Object? error;
    var busy = false;
    await showModalBottomSheet<void>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      builder: (sheet) => StatefulBuilder(
        builder: (sheet, set) => Padding(
          padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.viewInsetsOf(sheet).bottom),
          child: recovery != null
              ? _RecoveryCodes(codes: recovery!, onDone: () => Navigator.pop(sheet))
              : Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      newCodes ? tr('New recovery codes') : tr('Turn off two-step verification'),
                      style: sheet.text.headlineSmall,
                    ),
                    const SizedBox(height: 6),
                    Text(
                      newCodes
                          ? tr('Your old recovery codes stop working. Confirm with a code from the app.')
                          : tr('Your account will be protected by the password only.'),
                      style: sheet.text.bodyMedium,
                    ),
                    const SizedBox(height: 16),
                    if (error != null) ...[ErrorBox(error), const SizedBox(height: 12)],
                    if (!newCodes) ...[
                      LabeledField(label: tr('Password'), controller: password, obscure: true),
                      const SizedBox(height: 12),
                    ],
                    LabeledField(label: tr('Authentication or recovery code'), controller: code),
                    const SizedBox(height: 18),
                    GradientButton(
                      label: newCodes ? tr('Create new codes') : tr('Turn off'),
                      busy: busy,
                      onPressed: () async {
                        set(() {
                          busy = true;
                          error = null;
                        });
                        try {
                          if (newCodes) {
                            final codes = await session.api.newRecoveryCodes(code.text.trim());
                            set(() => recovery = codes);
                          } else {
                            await session.api.disableTwoFactor(password.text, code.text.trim());
                            if (sheet.mounted) Navigator.pop(sheet);
                            if (context.mounted) toast(context, tr('Two-step verification is off'));
                          }
                          session.queries.invalidate('2fa');
                        } catch (e) {
                          set(() => error = e);
                        } finally {
                          if (sheet.mounted) set(() => busy = false);
                        }
                      },
                    ),
                  ],
                ),
        ),
      ),
    );
  }
}

class _RecoveryCodes extends StatelessWidget {
  const _RecoveryCodes({required this.codes, required this.onDone});

  final List<String> codes;
  final VoidCallback onDone;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(tr('Save your recovery codes'), style: context.text.headlineSmall),
        const SizedBox(height: 6),
        Text(
          tr('Each code signs you in once if you lose your phone. They are shown only now.'),
          style: context.text.bodyMedium,
        ),
        const SizedBox(height: 14),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final code in codes)
              Container(
                width: 150,
                padding: const EdgeInsets.symmetric(vertical: 9),
                decoration: BoxDecoration(
                  color: c.surface2,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: c.borderStrong),
                ),
                child: Text(
                  code,
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontFamily: 'monospace', fontSize: 15, letterSpacing: 1),
                ),
              ),
          ],
        ),
        const SizedBox(height: 16),
        Row(
          children: [
            OutlinedButton.icon(
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: codes.join('\n')));
                if (context.mounted) toast(context, tr('Recovery codes copied'));
              },
              icon: const Icon(LucideIcons.copy, size: 16),
              label: Text(tr('Copy')),
            ),
            const Spacer(),
            FilledButton(onPressed: onDone, child: Text(tr('I saved them'))),
          ],
        ),
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
              Text(tr('Signed-in devices'), style: context.text.titleLarge),
              const SizedBox(height: 4),
              Text(
                tr(
                  'Every browser and app where this account is signed in. Sign out anything you do not recognise — it stops working immediately.',
                ),
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
                      tr('{0}{1} · signed in {2}', [
                        d.ip == null ? '' : '${d.ip} · ',
                        d.current ? tr('Active now') : tr('Last active {0}', [timeAgo(d.lastUsedAt)]),
                        date(d.createdAt),
                      ]),
                    ),
                    trailing: d.current
                        ? null
                        : TextButton(
                            onPressed: () => run(() async {
                              await session.api.signOutSession(d.id);
                              return tr('{0} signed out', [d.device]);
                            }),
                            child: Text(tr('Sign out')),
                          ),
                  ),
              if (others > 0) ...[
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerLeft,
                  child: OutlinedButton.icon(
                    onPressed: () => run(() async {
                      final n = await session.api.signOutOtherSessions();
                      return tr('Signed out {0}', [plural(n, 'other device')]);
                    }),
                    icon: const Icon(LucideIcons.logOut, size: 17),
                    label: Text(tr('Sign out all other devices')),
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
          Text(tr('Server address'), style: context.text.titleLarge),
          const SizedBox(height: 4),
          Text(tr('All accounts on this device use this server.'), style: context.text.bodyMedium),
          const SizedBox(height: 14),
          LabeledField(label: 'URL', controller: _url, icon: LucideIcons.globe, keyboard: TextInputType.url),
          const SizedBox(height: 14),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              TextButton.icon(
                onPressed: () => launchUrl(Uri.parse('${session.server}/api/docs')),
                icon: const Icon(LucideIcons.bookOpen, size: 16),
                label: Text(tr('API documentation')),
              ),
              const SizedBox(width: 8),
              FilledButton(
                onPressed: () async {
                  await session.setServer(_url.text);
                  if (context.mounted) toast(context, tr('Server saved'));
                },
                child: Text(tr('Save')),
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
                  Text(tr('OVL For Business'), style: context.text.titleLarge),
                  Text(tr('Native app · version 0.1.0'), style: context.text.bodySmall),
                ],
              ),
            ],
          ),
          const SizedBox(height: 16),
          Text(
            tr(
              'Corporate accounts, balances in every world currency, licenses, a public registry, a stock exchange and messaging — one platform for web, Android, iOS, macOS, Windows and Linux.',
            ),
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
                child: Text(tr('Open-source licenses')),
              ),
              OutlinedButton(onPressed: () => context.go('/support'), child: Text(tr('Contact support'))),
            ],
          ),
        ],
      ),
    );
  }
}
