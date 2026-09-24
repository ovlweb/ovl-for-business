import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';

import '../api/client.dart';
import '../state/accounts.dart';
import '../state/session.dart';
import '../theme/theme.dart';
import '../ui/chart.dart';
import '../ui/format.dart';
import '../ui/widgets.dart';

enum _Mode { signIn, register }

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  _Mode _mode = _Mode.signIn;
  late bool _choosing;

  @override
  void initState() {
    super.initState();
    final s = context.read<Session>();
    _choosing = !s.addingAccount && s.accounts.accounts.isNotEmpty;
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final wide = MediaQuery.sizeOf(context).width >= 980;
    final title = _choosing
        ? 'Choose an account'
        : session.addingAccount
        ? 'Add another account'
        : _mode == _Mode.signIn
        ? 'Welcome back'
        : 'Create your account';
    final subtitle = _choosing
        ? 'Accounts signed in on this device.'
        : _mode == _Mode.signIn
        ? 'Sign in to continue to your workspace.'
        : 'Start with a personal account — it takes a minute.';

    final form = Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(24, 28, 24, 28),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: FadeSlideIn(
            offset: 24,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (!wide) ...[
                  const Align(alignment: Alignment.centerLeft, child: Logo(size: 52, animated: true)),
                  const SizedBox(height: 22),
                ],
                if (session.addingAccount) ...[
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      onPressed: session.cancelAddAccount,
                      icon: const Icon(LucideIcons.arrowLeft, size: 16),
                      label: Text('Back to ${session.me?.firstName ?? 'the app'}'),
                    ),
                  ),
                  const SizedBox(height: 8),
                ],
                AnimatedSwitcher(
                  duration: const Duration(milliseconds: 260),
                  transitionBuilder: (child, a) => FadeTransition(
                    opacity: a,
                    child: SlideTransition(
                      position: Tween(begin: const Offset(0, 0.15), end: Offset.zero).animate(a),
                      child: child,
                    ),
                  ),
                  child: SizedBox(
                    key: ValueKey(title),
                    width: double.infinity,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(title, style: context.text.displaySmall),
                        const SizedBox(height: 6),
                        Text(subtitle, style: context.text.bodyMedium),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 26),
                AnimatedSwitcher(
                  duration: const Duration(milliseconds: 300),
                  child: _choosing
                      ? _SavedAccounts(
                          key: const ValueKey('choose'),
                          accounts: session.accounts.accounts,
                          onPick: (a) => session.switchAccount(a.id),
                          onOther: () => setState(() => _choosing = false),
                        )
                      : Column(
                          key: const ValueKey('forms'),
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Segmented<_Mode>(
                              value: _mode,
                              options: const [(_Mode.signIn, 'Sign in'), (_Mode.register, 'Create account')],
                              onChanged: (m) => setState(() => _mode = m),
                            ),
                            const SizedBox(height: 22),
                            AnimatedSwitcher(
                              duration: const Duration(milliseconds: 280),
                              transitionBuilder: (child, a) => FadeTransition(
                                opacity: a,
                                child: SlideTransition(
                                  position: Tween(
                                    begin: Offset(_mode == _Mode.signIn ? -0.06 : 0.06, 0),
                                    end: Offset.zero,
                                  ).animate(a),
                                  child: child,
                                ),
                              ),
                              child: _mode == _Mode.signIn
                                  ? const _SignInForm(key: ValueKey('in'))
                                  : const _RegisterForm(key: ValueKey('up')),
                            ),
                            if (session.accounts.accounts.isNotEmpty && !session.addingAccount) ...[
                              const SizedBox(height: 12),
                              TextButton.icon(
                                onPressed: () => setState(() => _choosing = true),
                                icon: const Icon(LucideIcons.users, size: 16),
                                label: Text('Saved accounts (${session.accounts.accounts.length})'),
                              ),
                            ],
                          ],
                        ),
                ),
                const SizedBox(height: 18),
                const _ServerSettings(),
              ],
            ),
          ),
        ),
      ),
    );

    return Scaffold(
      body: wide
          ? Row(
              children: [
                const Expanded(flex: 11, child: _BrandPanel()),
                Expanded(flex: 9, child: SafeArea(child: form)),
              ],
            )
          : Stack(
              children: [
                const Positioned.fill(child: _Mesh(soft: true)),
                SafeArea(child: form),
              ],
            ),
    );
  }
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

class _SignInForm extends StatefulWidget {
  const _SignInForm({super.key});

  @override
  State<_SignInForm> createState() => _SignInFormState();
}

class _SignInFormState extends State<_SignInForm> {
  final _login = TextEditingController();
  final _password = TextEditingController();
  final _code = TextEditingController();
  bool _show = false;
  bool _busy = false;
  bool _needCode = false;
  bool _recovery = false;
  Object? _error;

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await context.read<Session>().login(
        _login.text.trim(),
        _password.text,
        code: _needCode ? _code.text.trim() : null,
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        if (e.code == 'two_factor_required') {
          _needCode = true;
        } else {
          _error = e;
        }
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _codeStep() {
    final c = context.c;
    return Column(
      key: const ValueKey('code'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            IconTile(LucideIcons.shieldCheck, size: 42),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Two-step verification', style: context.text.titleMedium),
                  const SizedBox(height: 2),
                  Text(
                    _recovery
                        ? 'Enter one of the recovery codes you saved. Each code works once.'
                        : 'Open your authenticator app and enter the 6-digit code for OVL For Business.',
                    style: context.text.bodyMedium,
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        if (_error != null) ...[ErrorBox(_error), const SizedBox(height: 14)],
        TextField(
          key: ValueKey(_recovery),
          controller: _code,
          autofocus: true,
          textAlign: TextAlign.center,
          keyboardType: _recovery ? TextInputType.text : TextInputType.number,
          autofillHints: const [AutofillHints.oneTimeCode],
          maxLength: _recovery ? 20 : 6,
          onChanged: (_) => setState(() {}),
          onSubmitted: (_) => _submit(),
          style: font(display, 24, FontWeight.w800, letterSpacing: _recovery ? 2 : 8, color: c.text),
          decoration: InputDecoration(
            counterText: '',
            hintText: _recovery ? 'xxxxx-xxxxx' : '123456',
            labelText: _recovery ? 'Recovery code' : 'Authentication code',
          ),
        ),
        const SizedBox(height: 18),
        GradientButton(
          label: 'Verify',
          icon: LucideIcons.check,
          busy: _busy,
          onPressed: _recovery || _code.text.trim().length == 6 ? _submit : null,
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            TextButton.icon(
              onPressed: () => setState(() {
                _needCode = false;
                _error = null;
                _code.clear();
              }),
              icon: const Icon(LucideIcons.arrowLeft, size: 16),
              label: const Text('Back'),
            ),
            const Spacer(),
            TextButton(
              onPressed: () => setState(() {
                _recovery = !_recovery;
                _code.clear();
              }),
              child: Text(_recovery ? 'Use the authenticator app' : 'Use a recovery code'),
            ),
          ],
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 280),
      transitionBuilder: (child, a) => FadeTransition(
        opacity: a,
        child: SlideTransition(
          position: Tween(begin: const Offset(0.06, 0), end: Offset.zero).animate(a),
          child: child,
        ),
      ),
      child: _needCode
          ? _codeStep()
          : AutofillGroup(
              key: const ValueKey('password'),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (_error != null) ...[ErrorBox(_error), const SizedBox(height: 14)],
                  LabeledField(
                    label: 'Username or email',
                    controller: _login,
                    icon: LucideIcons.user,
                    autofill: const [AutofillHints.username],
                  ),
                  const SizedBox(height: 16),
                  LabeledField(
                    label: 'Password',
                    controller: _password,
                    icon: LucideIcons.keyRound,
                    obscure: !_show,
                    autofill: const [AutofillHints.password],
                    onSubmitted: (_) => _submit(),
                    suffix: IconButton(
                      tooltip: _show ? 'Hide characters' : 'Show characters',
                      onPressed: () => setState(() => _show = !_show),
                      icon: Icon(_show ? LucideIcons.eyeOff : LucideIcons.eye, size: 18),
                    ),
                  ),
                  const SizedBox(height: 22),
                  GradientButton(label: 'Sign in', icon: LucideIcons.arrowRight, busy: _busy, onPressed: _submit),
                ],
              ),
            ),
    );
  }
}

class _RegisterForm extends StatefulWidget {
  const _RegisterForm({super.key});

  @override
  State<_RegisterForm> createState() => _RegisterFormState();
}

class _RegisterFormState extends State<_RegisterForm> {
  final _name = TextEditingController();
  final _username = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  Object? _error;

  int get _strength => [
    RegExp(r'.{8,}'),
    RegExp(r'[A-Z]'),
    RegExp(r'\d'),
    RegExp(r'[^A-Za-z0-9]'),
  ].where((r) => r.hasMatch(_password.text)).length;

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await context.read<Session>().register(
        username: _username.text.trim().toLowerCase(),
        email: _email.text.trim(),
        password: _password.text,
        displayName: _name.text.trim(),
      );
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final colors = [c.danger, c.danger, c.warning, c.success, c.success];
    final labels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_error != null) ...[ErrorBox(_error), const SizedBox(height: 14)],
        LabeledField(
          label: 'Display name',
          controller: _name,
          icon: LucideIcons.user,
          autofill: const [AutofillHints.name],
        ),
        const SizedBox(height: 14),
        Row(
          children: [
            Expanded(
              child: LabeledField(label: 'Username', controller: _username, icon: LucideIcons.atSign),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: LabeledField(
                label: 'Email',
                controller: _email,
                icon: LucideIcons.mail,
                keyboard: TextInputType.emailAddress,
                autofill: const [AutofillHints.email],
              ),
            ),
          ],
        ),
        const SizedBox(height: 14),
        LabeledField(
          label: 'Password',
          controller: _password,
          icon: LucideIcons.keyRound,
          obscure: true,
          onChanged: (_) => setState(() {}),
          onSubmitted: (_) => _submit(),
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            for (var i = 0; i < 4; i++)
              Expanded(
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 300),
                  height: 4,
                  margin: EdgeInsets.only(right: i < 3 ? 5 : 0),
                  decoration: BoxDecoration(
                    color: i < _strength ? colors[_strength] : c.surface3,
                    borderRadius: BorderRadius.circular(9),
                  ),
                ),
              ),
            const SizedBox(width: 10),
            SizedBox(width: 64, child: Text(labels[_strength], style: context.text.bodySmall)),
          ],
        ),
        const SizedBox(height: 22),
        GradientButton(label: 'Create account', icon: LucideIcons.arrowRight, busy: _busy, onPressed: _submit),
      ],
    );
  }
}

class _SavedAccounts extends StatelessWidget {
  const _SavedAccounts({super.key, required this.accounts, required this.onPick, required this.onOther});

  final List<StoredAccount> accounts;
  final ValueChanged<StoredAccount> onPick;
  final VoidCallback onOther;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        OvlCard(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Column(
            children: [
              for (final (i, a) in accounts.indexed)
                FadeSlideIn(
                  delay: stagger(i),
                  child: ListTile(
                    onTap: () => onPick(a),
                    leading: Avatar(name: a.displayName, url: a.avatarUrl, size: 42),
                    title: Row(
                      children: [
                        Flexible(child: Text(a.displayName, overflow: TextOverflow.ellipsis)),
                        const SizedBox(width: 6),
                        Badges(a.badges),
                      ],
                    ),
                    subtitle: Text('@${a.username}'),
                    trailing: const Icon(LucideIcons.chevronRight, size: 18),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: onOther,
          icon: const Icon(LucideIcons.userPlus, size: 17),
          label: const Text('Use another account'),
        ),
      ],
    );
  }
}

class _ServerSettings extends StatefulWidget {
  const _ServerSettings();

  @override
  State<_ServerSettings> createState() => _ServerSettingsState();
}

class _ServerSettingsState extends State<_ServerSettings> {
  bool _open = false;
  late final _url = TextEditingController(text: context.read<Session>().server);

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    return AnimatedSize(
      duration: const Duration(milliseconds: 250),
      curve: Curves.easeOutCubic,
      child: _open
          ? Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                LabeledField(
                  label: 'Server address',
                  controller: _url,
                  icon: LucideIcons.globe,
                  keyboard: TextInputType.url,
                  helper: 'For self-hosted deployments, e.g. https://ovl.example.com',
                ),
                const SizedBox(height: 10),
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    TextButton(onPressed: () => setState(() => _open = false), child: const Text('Cancel')),
                    const SizedBox(width: 8),
                    FilledButton(
                      onPressed: () async {
                        await session.setServer(_url.text);
                        if (mounted) setState(() => _open = false);
                      },
                      child: const Text('Save'),
                    ),
                  ],
                ),
              ],
            )
          : Center(
              child: TextButton.icon(
                onPressed: () => setState(() => _open = true),
                icon: const Icon(LucideIcons.globe, size: 15),
                label: Text(Uri.tryParse(session.server)?.authority ?? session.server),
                style: TextButton.styleFrom(foregroundColor: context.c.text3),
              ),
            ),
    );
  }
}

// ---------------------------------------------------------------------------
// Animated brand panel
// ---------------------------------------------------------------------------

/// Slowly drifting gradient blobs behind the sign-in screen.
class _Mesh extends StatefulWidget {
  const _Mesh({this.soft = false});

  final bool soft;

  @override
  State<_Mesh> createState() => _MeshState();
}

class _MeshState extends State<_Mesh> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(seconds: 18))..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final alpha = widget.soft ? 0.16 : 0.75;
    return AnimatedBuilder(
      animation: _c,
      builder: (context, _) {
        final t = _c.value * 2 * pi;
        Widget blob(Color color, double size, double x, double y) => Align(
          alignment: Alignment(x, y),
          child: Container(
            width: size,
            height: size,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: RadialGradient(
                colors: [
                  color.withValues(alpha: alpha),
                  color.withValues(alpha: 0),
                ],
              ),
            ),
          ),
        );
        return Stack(
          children: [
            blob(c.gradFrom, 620, -0.9 + 0.25 * sin(t), -0.9 + 0.2 * cos(t)),
            blob(c.gradTo, 560, 0.9 + 0.2 * cos(t * 0.8), 0.6 + 0.25 * sin(t * 0.8)),
            blob(c.council, 420, 0.2 * sin(t * 1.3), 1.1 + 0.15 * cos(t)),
          ],
        );
      },
    );
  }
}

class _BrandPanel extends StatelessWidget {
  const _BrandPanel();

  @override
  Widget build(BuildContext context) {
    return Container(
      color: const Color(0xFF0B1024),
      child: Stack(
        children: [
          const Positioned.fill(child: _Mesh()),
          Positioned.fill(child: CustomPaint(painter: _GridPainter())),
          Padding(
            padding: const EdgeInsets.fromLTRB(56, 48, 56, 48),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Logo(size: 44, animated: true),
                    const SizedBox(width: 12),
                    Text('OVL For Business', style: font(display, 19, FontWeight.w800, color: Colors.white)),
                  ],
                ),
                const Spacer(),
                FadeSlideIn(
                  delay: const Duration(milliseconds: 150),
                  child: Text(
                    'Your company, its money\nand its licenses — in one place.',
                    style: font(display, 38, FontWeight.w800, height: 1.12, letterSpacing: -1, color: Colors.white),
                  ),
                ),
                const SizedBox(height: 16),
                const FadeSlideIn(delay: Duration(milliseconds: 300), child: _RotatingFeature()),
                const SizedBox(height: 36),
                const SizedBox(height: 250, child: _FloatingCards()),
                const Spacer(),
                Text(
                  'Balances in every world currency · public registry · stock exchange',
                  style: TextStyle(color: Colors.white.withValues(alpha: 0.55), fontSize: 13),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _GridPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = Colors.white.withValues(alpha: 0.04);
    for (double x = 0; x < size.width; x += 44) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), paint);
    }
    for (double y = 0; y < size.height; y += 44) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _RotatingFeature extends StatefulWidget {
  const _RotatingFeature();

  @override
  State<_RotatingFeature> createState() => _RotatingFeatureState();
}

class _RotatingFeatureState extends State<_RotatingFeature> {
  static const _features = [
    'Approvals by moderation, the council and the owner.',
    'Invest in listed companies — funds unlock in 3–6 months.',
    'Tech support that answers inside your chats.',
    'Licenses for channels, websites and virtual countries.',
  ];
  int _i = 0;
  late final Timer _timer = Timer.periodic(
    const Duration(seconds: 3),
    (_) => setState(() => _i = (_i + 1) % _features.length),
  );

  @override
  void initState() {
    super.initState();
    _timer;
  }

  @override
  void dispose() {
    _timer.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 26,
      child: AnimatedSwitcher(
        duration: const Duration(milliseconds: 450),
        transitionBuilder: (child, a) => FadeTransition(
          opacity: a,
          child: SlideTransition(
            position: Tween(begin: const Offset(0, 0.5), end: Offset.zero).animate(a),
            child: child,
          ),
        ),
        child: Row(
          key: ValueKey(_i),
          children: [
            const Icon(LucideIcons.sparkles, size: 16, color: Color(0xFF93C5FD)),
            const SizedBox(width: 8),
            Text(_features[_i], style: TextStyle(color: Colors.white.withValues(alpha: 0.8), fontSize: 16)),
          ],
        ),
      ),
    );
  }
}

/// Glass cards that bob gently: balance, a stock chart, live chat and a registry stamp.
class _FloatingCards extends StatefulWidget {
  const _FloatingCards();

  @override
  State<_FloatingCards> createState() => _FloatingCardsState();
}

class _FloatingCardsState extends State<_FloatingCards> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(seconds: 6))..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  Widget _glass({required Widget child, double width = 230}) => Container(
    width: width,
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: Colors.white.withValues(alpha: 0.08),
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: Colors.white.withValues(alpha: 0.14)),
      boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.25), blurRadius: 30, offset: const Offset(0, 16))],
    ),
    child: DefaultTextStyle(
      style: const TextStyle(color: Colors.white, fontFamily: body),
      child: child,
    ),
  );

  @override
  Widget build(BuildContext context) {
    final muted = TextStyle(color: Colors.white.withValues(alpha: 0.6), fontSize: 12);
    return AnimatedBuilder(
      animation: _c,
      builder: (context, _) {
        final t = _c.value * 2 * pi;
        Offset bob(double phase, [double amp = 7]) => Offset(0, sin(t + phase) * amp);
        return Stack(
          clipBehavior: Clip.none,
          children: [
            Positioned(
              left: 0,
              top: 10,
              child: Transform.translate(
                offset: bob(0),
                child: FadeSlideIn(
                  delay: const Duration(milliseconds: 400),
                  child: _glass(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            const Icon(LucideIcons.wallet, size: 14, color: Colors.white70),
                            const SizedBox(width: 6),
                            Text('EUR BALANCE', style: muted.copyWith(letterSpacing: 0.8, fontWeight: FontWeight.w700)),
                          ],
                        ),
                        const SizedBox(height: 8),
                        AnimatedAmount(
                          value: '128420.50',
                          format: (v) => money(v, 'EUR'),
                          style: font(display, 24, FontWeight.w800, color: Colors.white),
                        ),
                        const SizedBox(height: 4),
                        Text('+2,400.00 today', style: muted.copyWith(color: const Color(0xFF6EE7B7))),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            Positioned(
              left: 250,
              top: 0,
              child: Transform.translate(
                offset: bob(1.6, 9),
                child: FadeSlideIn(
                  delay: const Duration(milliseconds: 550),
                  child: _glass(
                    width: 250,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Text('AURA', style: font(display, 15, FontWeight.w800, color: Colors.white)),
                            const Spacer(),
                            Text(
                              '+12.4%',
                              style: muted.copyWith(color: const Color(0xFF6EE7B7), fontWeight: FontWeight.w700),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        const AreaChart(
                          values: [8, 9.1, 8.7, 9.8, 10.4, 10.1, 11.2, 11.8, 12.5],
                          height: 70,
                          color: Color(0xFF34D399),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            Positioned(
              left: 40,
              top: 142,
              child: Transform.translate(
                offset: bob(3.1, 6),
                child: FadeSlideIn(
                  delay: const Duration(milliseconds: 700),
                  child: _glass(
                    width: 280,
                    child: Row(
                      children: [
                        const Avatar(name: 'Elena Markovic', size: 34),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('Council · Elena', style: muted),
                              const Text('Company approved — welcome aboard!', style: TextStyle(fontSize: 13)),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            Positioned(
              left: 350,
              top: 150,
              child: Transform.translate(
                offset: bob(4.4, 5),
                child: Transform.rotate(
                  angle: -0.14,
                  child: FadeSlideIn(
                    delay: const Duration(milliseconds: 900),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                      decoration: BoxDecoration(
                        border: Border.all(color: const Color(0xFF6EE7B7), width: 2),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Column(
                        children: [
                          Text(
                            'APPROVED',
                            style: font(display, 16, FontWeight.w800, letterSpacing: 2, color: const Color(0xFF6EE7B7)),
                          ),
                          Text('OVL-LIC-000042', style: muted.copyWith(fontSize: 10.5)),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}
