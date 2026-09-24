import 'dart:math';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';

import '../state/session.dart';
import '../theme/theme.dart';
import '../ui/theme_gallery.dart';
import '../ui/widgets.dart';

class _Goal {
  const _Goal(this.icon, this.title, this.text, this.to, this.cta);
  final IconData icon;
  final String title;
  final String text;
  final String to;
  final String cta;
}

const _goals = <String, _Goal>{
  'company': _Goal(
    LucideIcons.building2,
    'Register a company',
    'Business account, license and an optional stock listing.',
    '/applications/new/company',
    'Start a company application',
  ),
  'invest': _Goal(
    LucideIcons.chartLine,
    'Invest in companies',
    'Buy shares on the exchange and follow your portfolio.',
    '/exchange',
    'Open the exchange',
  ),
  'license': _Goal(
    LucideIcons.award,
    'Get a license',
    'Projects, channels, websites, virtual countries…',
    '/applications/new/license',
    'Request a license',
  ),
  'chat': _Goal(
    LucideIcons.messageCircle,
    'Talk to partners',
    'Direct chats and groups with your contacts.',
    '/contacts',
    'Find people',
  ),
  'channel': _Goal(
    LucideIcons.radio,
    'Run a news channel',
    'Publish updates to your subscribers.',
    '/applications/new/news_channel',
    'Apply for a channel',
  ),
  'staff': _Goal(
    LucideIcons.shield,
    'Join the staff',
    'Moderation team or the council.',
    '/applications',
    'See staff applications',
  ),
};

enum _Step { welcome, theme, profile, goals, done }

/// First-run tour: look, profile, goals — then shortcuts into the app.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  _Step _step = _Step.welcome;
  bool _forward = true;
  late String _theme = context.read<Session>().themes.preference;
  late final _name = TextEditingController(text: context.read<Session>().me!.displayName);
  late final _bio = TextEditingController(text: context.read<Session>().me!.bio);
  final Set<String> _selected = {};
  bool _saving = false;
  Object? _error;

  void _go(int delta) => setState(() {
    _forward = delta > 0;
    _step = _Step.values[(_step.index + delta).clamp(0, _Step.values.length - 1)];
  });

  Future<void> _saveProfile() async {
    setState(() => _error = null);
    try {
      await context.read<Session>().updateProfile(displayName: _name.text.trim(), bio: _bio.text.trim());
      _go(1);
    } catch (e) {
      setState(() => _error = e);
    }
  }

  Future<void> _finish([String? to]) async {
    setState(() => _saving = true);
    final session = context.read<Session>();
    final router = GoRouter.of(context);
    try {
      await session.updatePreferences({'onboardingCompleted': true, 'goals': _selected.toList(), 'theme': _theme});
      if (to != null) router.go(to);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final me = session.me!;
    final steps = _Step.values.length - 1;
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 12, 12, 0),
              child: Row(
                children: [
                  const Logo(size: 34),
                  const SizedBox(width: 14),
                  Expanded(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(99),
                      child: TweenAnimationBuilder<double>(
                        tween: Tween(end: _step.index / steps),
                        duration: const Duration(milliseconds: 450),
                        curve: Curves.easeOutCubic,
                        builder: (_, v, _) => LinearProgressIndicator(value: v, minHeight: 5),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  if (_step != _Step.done)
                    TextButton(onPressed: _saving ? null : () => _finish('/home'), child: const Text('Skip setup')),
                ],
              ),
            ),
            Expanded(
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 380),
                switchInCurve: Curves.easeOutCubic,
                transitionBuilder: (child, a) => FadeTransition(
                  opacity: a,
                  child: SlideTransition(
                    position: Tween(begin: Offset(_forward ? 0.08 : -0.08, 0), end: Offset.zero).animate(a),
                    child: child,
                  ),
                ),
                child: KeyedSubtree(
                  key: ValueKey(_step),
                  child: Center(
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.fromLTRB(22, 24, 22, 32),
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 760),
                        child: switch (_step) {
                          _Step.welcome => _welcome(me.firstName),
                          _Step.theme => _themeStep(session),
                          _Step.profile => _profileStep(me.displayName, me.avatarUrl),
                          _Step.goals => _goalsStep(),
                          _Step.done => _doneStep(),
                        },
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _welcome(String name) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      const Logo(size: 82, animated: true),
      const SizedBox(height: 28),
      Text('Welcome, $name', style: context.text.displayMedium),
      const SizedBox(height: 10),
      Text(
        'OVL For Business keeps your company, its money in any currency, its licenses and your partners in one place. '
        'Let us set things up — it takes under a minute.',
        style: context.text.bodyLarge?.copyWith(color: context.c.text2),
      ),
      const SizedBox(height: 26),
      for (final (i, f) in const [
        (LucideIcons.wallet, 'Balances in every world currency', 'Deposits through finance managers or the cash desk.'),
        (LucideIcons.clipboardCheck, 'Transparent approvals', 'Moderation, council and owner — every step visible.'),
        (LucideIcons.chartLine, 'A real stock exchange', 'List your company and raise money from investors.'),
      ].indexed)
        FadeSlideIn(
          delay: stagger(i + 2, 90),
          child: Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Row(
              children: [
                IconTile(f.$1, size: 44),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(f.$2, style: context.text.titleMedium),
                      Text(f.$3, style: context.text.bodyMedium),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      const SizedBox(height: 18),
      GradientButton(label: 'Get started', icon: LucideIcons.arrowRight, expand: false, onPressed: () => _go(1)),
    ],
  );

  Widget _heading(IconData icon, String kicker, String title, String text) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Row(
        children: [
          Icon(icon, size: 14, color: context.c.accent),
          const SizedBox(width: 6),
          Caption(kicker, color: context.c.accent),
        ],
      ),
      const SizedBox(height: 8),
      Text(title, style: context.text.headlineLarge),
      const SizedBox(height: 6),
      Text(text, style: context.text.bodyMedium),
      const SizedBox(height: 22),
    ],
  );

  Widget _buttons({required VoidCallback onNext, String label = 'Continue', bool enabled = true}) => Padding(
    padding: const EdgeInsets.only(top: 24),
    child: Row(
      children: [
        TextButton.icon(
          onPressed: () => _go(-1),
          icon: const Icon(LucideIcons.arrowLeft, size: 16),
          label: const Text('Back'),
        ),
        const Spacer(),
        FilledButton.icon(
          onPressed: enabled ? onNext : null,
          iconAlignment: IconAlignment.end,
          icon: const Icon(LucideIcons.arrowRight, size: 16),
          label: Text(label),
        ),
      ],
    ),
  );

  Widget _themeStep(Session session) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      _heading(
        LucideIcons.palette,
        'Appearance',
        'Pick your look',
        'Themes follow your account to every device. You can change it any time in Settings.',
      ),
      ThemeGallery(
        value: _theme,
        onChanged: (id, origin) {
          setState(() => _theme = id);
          session.themes.set(id, origin: origin);
        },
      ),
      _buttons(onNext: () => _go(1)),
    ],
  );

  Widget _profileStep(String current, String? avatar) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      _heading(
        LucideIcons.user,
        'Profile',
        'How others see you',
        'Your name and badges appear in chats, contacts and the registry.',
      ),
      if (_error != null) ...[ErrorBox(_error), const SizedBox(height: 12)],
      Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ValueListenableBuilder(
            valueListenable: _name,
            builder: (_, v, _) => Avatar(name: v.text.isEmpty ? current : v.text, url: avatar, size: 84),
          ),
          const SizedBox(width: 18),
          Expanded(
            child: Column(
              children: [
                LabeledField(label: 'Display name', controller: _name),
                const SizedBox(height: 14),
                LabeledField(
                  label: 'About you (optional)',
                  controller: _bio,
                  maxLines: 3,
                  hint: 'Founder of…, investor in…, moderator of…',
                ),
              ],
            ),
          ),
        ],
      ),
      _buttons(onNext: _saveProfile),
    ],
  );

  Widget _goalsStep() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      _heading(
        LucideIcons.sparkles,
        'Your goals',
        'What brings you here?',
        'Pick as many as you like — we will put the right shortcuts on your home screen.',
      ),
      LayoutBuilder(
        builder: (context, box) {
          final columns = box.maxWidth > 620 ? 3 : 2;
          final w = (box.maxWidth - 12 * (columns - 1)) / columns;
          return Wrap(
            spacing: 12,
            runSpacing: 12,
            children: [
              for (final (i, e) in _goals.entries.indexed)
                SizedBox(
                  width: w,
                  child: FadeSlideIn(
                    delay: stagger(i),
                    child: _GoalCard(
                      goal: e.value,
                      selected: _selected.contains(e.key),
                      onTap: () =>
                          setState(() => _selected.contains(e.key) ? _selected.remove(e.key) : _selected.add(e.key)),
                    ),
                  ),
                ),
            ],
          );
        },
      ),
      _buttons(onNext: () => _go(1)),
    ],
  );

  Widget _doneStep() {
    final goals = (_selected.isEmpty ? {'invest', 'chat'} : _selected).map((g) => _goals[g]!).toList();
    return Column(
      children: [
        const SizedBox(height: 8),
        const _Burst(),
        const SizedBox(height: 22),
        Text('You’re all set', style: context.text.displaySmall, textAlign: TextAlign.center),
        const SizedBox(height: 6),
        Text(
          'Your workspace is ready. Here is where you might start:',
          style: context.text.bodyMedium,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 20),
        if (_error != null) ...[ErrorBox(_error), const SizedBox(height: 12)],
        for (final (i, g) in goals.indexed)
          FadeSlideIn(
            delay: stagger(i + 4, 80),
            child: Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: OvlCard(
                padding: const EdgeInsets.all(14),
                onTap: _saving ? null : () => _finish(g.to),
                child: Row(
                  children: [
                    IconTile(g.icon, size: 38),
                    const SizedBox(width: 12),
                    Expanded(child: Text(g.cta, style: context.text.titleMedium)),
                    const Icon(LucideIcons.chevronRight, size: 18),
                  ],
                ),
              ),
            ),
          ),
        const SizedBox(height: 14),
        GradientButton(
          label: 'Enter my workspace',
          icon: LucideIcons.arrowRight,
          expand: false,
          busy: _saving,
          onPressed: () => _finish('/home'),
        ),
      ],
    );
  }
}

class _GoalCard extends StatelessWidget {
  const _GoalCard({required this.goal, required this.selected, required this.onTap});

  final _Goal goal;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Semantics(
      button: true,
      selected: selected,
      label: goal.title,
      child: AnimatedScale(
        scale: selected ? 1.0 : 0.985,
        duration: const Duration(milliseconds: 200),
        child: Material(
          color: selected ? c.accentSoft : c.surface,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
            side: BorderSide(color: selected ? c.accent : c.border, width: selected ? 1.6 : 1),
          ),
          child: InkWell(
            borderRadius: BorderRadius.circular(18),
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Stack(
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      IconTile(goal.icon, size: 40, gradient: selected ? context.ovl.gradient : null),
                      const SizedBox(height: 12),
                      Text(goal.title, style: context.text.titleMedium),
                      const SizedBox(height: 3),
                      Text(goal.text, style: context.text.bodySmall),
                    ],
                  ),
                  Positioned(
                    right: 0,
                    top: 0,
                    child: AnimatedScale(
                      scale: selected ? 1 : 0,
                      duration: const Duration(milliseconds: 250),
                      curve: Curves.easeOutBack,
                      child: Container(
                        padding: const EdgeInsets.all(3),
                        decoration: BoxDecoration(color: c.accent, shape: BoxShape.circle),
                        child: Icon(LucideIcons.check, size: 13, color: c.accentText),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Pulsing rings behind a check mark.
class _Burst extends StatefulWidget {
  const _Burst();

  @override
  State<_Burst> createState() => _BurstState();
}

class _BurstState extends State<_Burst> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 2200))
    ..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return SizedBox(
      width: 160,
      height: 160,
      child: AnimatedBuilder(
        animation: _c,
        builder: (context, _) => Stack(
          alignment: Alignment.center,
          children: [
            for (var i = 0; i < 3; i++)
              Builder(
                builder: (_) {
                  final t = (_c.value + i / 3) % 1;
                  return Container(
                    width: 80 + 80 * t,
                    height: 80 + 80 * t,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(color: c.accent.withValues(alpha: max(0, 0.5 - t * 0.5)), width: 2),
                    ),
                  );
                },
              ),
            TweenAnimationBuilder<double>(
              tween: Tween(begin: 0, end: 1),
              duration: const Duration(milliseconds: 900),
              curve: Curves.elasticOut,
              builder: (_, v, child) => Transform.scale(scale: v, child: child),
              child: Container(
                width: 84,
                height: 84,
                decoration: BoxDecoration(shape: BoxShape.circle, gradient: context.ovl.gradient),
                child: const Icon(LucideIcons.check, size: 40, color: Colors.white),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
