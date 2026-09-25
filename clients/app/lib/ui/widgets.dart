import 'dart:math';
import 'dart:ui' show PathMetric;

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../theme/theme.dart';
import 'format.dart';
import '../i18n/i18n.dart';

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

/// The OVL mark: an orbit around a core, in the theme gradient. Draws itself in when [animated].
class Logo extends StatefulWidget {
  const Logo({super.key, this.size = 36, this.animated = false});

  final double size;
  final bool animated;

  @override
  State<Logo> createState() => _LogoState();
}

class _LogoState extends State<Logo> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1400));

  @override
  void initState() {
    super.initState();
    if (widget.animated) {
      _c.forward();
    } else {
      _c.value = 1;
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Semantics(
      label: tr('OVL For Business'),
      image: true,
      child: AnimatedBuilder(
        animation: _c,
        builder: (context, _) =>
            CustomPaint(size: Size.square(widget.size), painter: _LogoPainter(c.gradFrom, c.gradTo, _c.value)),
      ),
    );
  }
}

class _LogoPainter extends CustomPainter {
  _LogoPainter(this.from, this.to, this.t);

  final Color from;
  final Color to;
  final double t;

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 64;
    canvas.scale(s);
    final rect = const Rect.fromLTWH(0, 0, 64, 64);
    canvas.drawRRect(
      RRect.fromRectAndRadius(rect, const Radius.circular(18)),
      Paint()
        ..shader = LinearGradient(
          colors: [from, to],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ).createShader(rect),
    );
    final orbit = Curves.easeOutQuart.transform((t / 0.8).clamp(0, 1));
    canvas.save();
    canvas.translate(32, 32);
    canvas.rotate((1 - orbit) * -0.52);
    final path = Path()..addOval(Rect.fromCenter(center: Offset.zero, width: 38, height: 26));
    final PathMetric metric = path.computeMetrics().first;
    canvas.drawPath(
      metric.extractPath(0, metric.length * orbit),
      Paint()
        ..color = Colors.white
        ..style = PaintingStyle.stroke
        ..strokeWidth = 5
        ..strokeCap = StrokeCap.round,
    );
    canvas.restore();
    final core = Curves.elasticOut.transform(((t - 0.45) / 0.55).clamp(0, 1));
    canvas.drawCircle(const Offset(32, 32), 5 * core, Paint()..color = Colors.white);
  }

  @override
  bool shouldRepaint(_LogoPainter old) => old.t != t || old.from != from || old.to != to;
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

const _avatarGradients = [
  [Color(0xFFF97316), Color(0xFFE11D48)],
  [Color(0xFF6366F1), Color(0xFF8B5CF6)],
  [Color(0xFF0EA5E9), Color(0xFF2563EB)],
  [Color(0xFF10B981), Color(0xFF0D9488)],
  [Color(0xFFF59E0B), Color(0xFFEA580C)],
  [Color(0xFFEC4899), Color(0xFF9333EA)],
  [Color(0xFF334155), Color(0xFF0F172A)],
  [Color(0xFF14B8A6), Color(0xFF0891B2)],
];

class Avatar extends StatelessWidget {
  const Avatar({super.key, required this.name, this.url, this.size = 40, this.online});

  final String name;
  final String? url;
  final double size;
  final bool? online;

  @override
  Widget build(BuildContext context) {
    final g =
        _avatarGradients[name.codeUnits.fold<int>(0, (a, b) => (a * 31 + b) & 0x7fffffff) % _avatarGradients.length];
    final fallback = Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: LinearGradient(colors: g, begin: Alignment.topLeft, end: Alignment.bottomRight),
      ),
      child: Text(
        initials(name),
        style: font(display, size * 0.36, FontWeight.w800, color: Colors.white, letterSpacing: 0.2),
      ),
    );
    final image = url == null || url!.isEmpty
        ? fallback
        : ClipOval(
            child: Image.network(
              url!,
              width: size,
              height: size,
              fit: BoxFit.cover,
              errorBuilder: (_, _, _) => fallback,
            ),
          );
    if (online == null) return image;
    return Stack(
      clipBehavior: Clip.none,
      children: [
        image,
        Positioned(
          right: -1,
          bottom: -1,
          child: Container(
            width: size * 0.3,
            height: size * 0.3,
            decoration: BoxDecoration(
              color: online! ? context.c.success : context.c.text3,
              shape: BoxShape.circle,
              border: Border.all(color: context.c.surface, width: 2),
            ),
          ),
        ),
      ],
    );
  }
}

class RoleBadge extends StatelessWidget {
  const RoleBadge(this.badge, {super.key});

  final String badge;

  @override
  Widget build(BuildContext context) {
    final o = context.ovl;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(color: o.roleSoft(badge), borderRadius: BorderRadius.circular(6)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (badge == 'owner') ...[Icon(LucideIcons.crown, size: 11, color: o.role(badge)), const SizedBox(width: 3)],
          Text(
            tr(badgeLabels[badge] ?? badge).toUpperCase(),
            style: font(body, 9.5, FontWeight.w800, letterSpacing: 0.6, color: o.role(badge)),
          ),
        ],
      ),
    );
  }
}

class Badges extends StatelessWidget {
  const Badges(this.badges, {super.key});

  final List<String> badges;

  @override
  Widget build(BuildContext context) {
    if (badges.isEmpty) return const SizedBox.shrink();
    return Wrap(spacing: 4, runSpacing: 4, children: [for (final b in badges) RoleBadge(b)]);
  }
}

class NameWithBadges extends StatelessWidget {
  const NameWithBadges(this.user, {super.key, this.style});

  final UserSummary user;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Flexible(
          child: Text(user.displayName, overflow: TextOverflow.ellipsis, style: style ?? context.text.titleMedium),
        ),
        if (user.badges.isNotEmpty) ...[const SizedBox(width: 6), Badges(user.badges)],
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

class OvlCard extends StatelessWidget {
  const OvlCard({super.key, required this.child, this.padding = const EdgeInsets.all(18), this.onTap, this.color});

  final Widget child;
  final EdgeInsets padding;
  final VoidCallback? onTap;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Material(
      color: color ?? c.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: BorderSide(color: c.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(padding: padding, child: child),
      ),
    );
  }
}

class SectionHeader extends StatelessWidget {
  const SectionHeader(this.title, {super.key, this.action, this.onAction});

  final String title;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: [
          Expanded(child: Text(title, style: context.text.titleLarge)),
          if (action != null) TextButton(onPressed: onAction, child: Text(action!)),
        ],
      ),
    );
  }
}

/// Uppercase caption above a value, as on the web KPI cards.
class Caption extends StatelessWidget {
  const Caption(this.text, {super.key, this.color});

  final String text;
  final Color? color;

  @override
  Widget build(BuildContext context) =>
      Text(tr(text).toUpperCase(), style: context.text.labelSmall?.copyWith(color: color));
}

class GradientButton extends StatelessWidget {
  const GradientButton({
    super.key,
    required this.label,
    this.onPressed,
    this.icon,
    this.busy = false,
    this.expand = true,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool busy;
  final bool expand;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null && !busy;
    return AnimatedOpacity(
      duration: const Duration(milliseconds: 200),
      opacity: enabled ? 1 : 0.6,
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: context.ovl.gradient,
          borderRadius: BorderRadius.circular(14),
          boxShadow: [
            BoxShadow(color: context.c.gradFrom.withValues(alpha: 0.35), blurRadius: 18, offset: const Offset(0, 8)),
          ],
        ),
        child: Material(
          type: MaterialType.transparency,
          child: InkWell(
            borderRadius: BorderRadius.circular(14),
            onTap: enabled ? onPressed : null,
            child: SizedBox(
              height: 52,
              width: expand ? double.infinity : null,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 22),
                child: Row(
                  mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    if (busy)
                      const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white),
                      )
                    else ...[
                      Text(label, style: font(body, 15, FontWeight.w700, color: Colors.white)),
                      if (icon != null) ...[const SizedBox(width: 8), Icon(icon, size: 18, color: Colors.white)],
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class StatusPill extends StatelessWidget {
  const StatusPill(this.status, {super.key});

  final String status;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final (fg, bg) = switch (status) {
      'active' || 'approved' || 'completed' || 'paid' || 'confirmed' || 'verified' => (c.success, c.successSoft),
      'open' || 'partly_paid' || 'renewal_pending' => (c.accent, c.accentSoft),
      'pending' ||
      'halted' ||
      'not confirmed' ||
      'changes_requested' ||
      'waiting_for_approval' ||
      'paused' => (c.warning, c.warningSoft),
      'rejected' ||
      'revoked' ||
      'suspended' ||
      'delisted' ||
      'declined' ||
      'overdue' ||
      'expired' => (c.danger, c.dangerSoft),
      _ => (c.text3, c.surface3),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(color: fg, shape: BoxShape.circle),
          ),
          const SizedBox(width: 5),
          Text(
            status.replaceAll('_', ' ').toUpperCase(),
            style: font(body, 10, FontWeight.w800, letterSpacing: 0.6, color: fg),
          ),
        ],
      ),
    );
  }
}

/// "Verified business": the company's owner passed an identity check.
class VerifiedBadge extends StatelessWidget {
  const VerifiedBadge({super.key, this.compact = false});

  final bool compact;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Tooltip(
      message: tr('Verified business: the owner passed an identity check'),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(color: c.successSoft, borderRadius: BorderRadius.circular(999)),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(LucideIcons.shieldCheck, size: 12, color: c.success),
            const SizedBox(width: 4),
            Text(
              compact ? tr('VERIFIED') : tr('VERIFIED BUSINESS'),
              style: font(body, 10, FontWeight.w800, letterSpacing: 0.6, color: c.success),
            ),
          ],
        ),
      ),
    );
  }
}

class IconTile extends StatelessWidget {
  const IconTile(this.icon, {super.key, this.color, this.size = 40, this.gradient});

  final IconData icon;
  final Color? color;
  final double size;
  final Gradient? gradient;

  @override
  Widget build(BuildContext context) {
    final tone = color ?? context.c.accent;
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: gradient == null ? tone.withValues(alpha: 0.13) : null,
        gradient: gradient,
        borderRadius: BorderRadius.circular(size * 0.3),
      ),
      child: Icon(icon, size: size * 0.48, color: gradient == null ? tone : Colors.white),
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, this.text, this.action});

  final IconData icon;
  final String title;
  final String? text;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: FadeSlideIn(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              IconTile(icon, size: 56, color: context.c.text3),
              const SizedBox(height: 14),
              Text(title, style: context.text.titleLarge, textAlign: TextAlign.center),
              if (text != null) ...[
                const SizedBox(height: 6),
                Text(text!, style: context.text.bodyMedium, textAlign: TextAlign.center),
              ],
              if (action != null) ...[const SizedBox(height: 16), action!],
            ],
          ),
        ),
      ),
    );
  }
}

class ErrorBox extends StatelessWidget {
  const ErrorBox(this.error, {super.key, this.onRetry});

  final Object? error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    if (error == null) return const SizedBox.shrink();
    final c = context.c;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: c.dangerSoft, borderRadius: BorderRadius.circular(14)),
      child: Row(
        children: [
          Icon(LucideIcons.circleAlert, size: 18, color: c.danger),
          const SizedBox(width: 10),
          Expanded(
            child: Text(errorText(error), style: TextStyle(color: c.danger, fontSize: 13.5)),
          ),
          if (onRetry != null) TextButton(onPressed: onRetry, child: Text(tr('Retry'))),
        ],
      ),
    );
  }
}

String errorText(Object? error) =>
    error is ApiException ? error.message : tr('Something went wrong. Please try again.');

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

/// Fades and slides a widget in, optionally after [delay] — used for staggered lists.
class FadeSlideIn extends StatefulWidget {
  const FadeSlideIn({super.key, required this.child, this.delay = Duration.zero, this.offset = 14});

  final Widget child;
  final Duration delay;
  final double offset;

  @override
  State<FadeSlideIn> createState() => _FadeSlideInState();
}

class _FadeSlideInState extends State<FadeSlideIn> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 480));

  @override
  void initState() {
    super.initState();
    Future.delayed(widget.delay, () {
      if (mounted) _c.forward();
    });
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final curve = CurvedAnimation(parent: _c, curve: Curves.easeOutCubic);
    return AnimatedBuilder(
      animation: curve,
      child: widget.child,
      builder: (context, child) => Opacity(
        opacity: curve.value,
        child: Transform.translate(offset: Offset(0, (1 - curve.value) * widget.offset), child: child),
      ),
    );
  }
}

Duration stagger(int index, [int stepMs = 45]) => Duration(milliseconds: min(index, 12) * stepMs);

/// Counts up to [value] (a decimal string) whenever it changes.
class AnimatedAmount extends StatelessWidget {
  const AnimatedAmount({super.key, required this.value, required this.format, this.style});

  final String value;
  final String Function(String) format;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    final target = double.tryParse(value) ?? 0;
    final decimals = value.contains('.') ? value.split('.')[1].length : 0;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: target),
      duration: const Duration(milliseconds: 1100),
      curve: Curves.easeOutQuart,
      builder: (context, v, _) => Text(
        format(v == target ? value : v.toStringAsFixed(decimals)),
        style: (style ?? const TextStyle()).copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
      ),
    );
  }
}

/// Shimmering placeholder while data loads.
class Skeleton extends StatefulWidget {
  const Skeleton({super.key, this.height = 16, this.width, this.radius = 10});

  final double height;
  final double? width;
  final double radius;

  @override
  State<Skeleton> createState() => _SkeletonState();
}

class _SkeletonState extends State<Skeleton> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1300))
    ..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return AnimatedBuilder(
      animation: _c,
      builder: (context, _) => Container(
        height: widget.height,
        width: widget.width,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(widget.radius),
          gradient: LinearGradient(
            begin: Alignment(-1 + _c.value * 3, 0),
            end: Alignment(_c.value * 3, 0),
            colors: [c.surface2, c.surface3, c.surface2],
          ),
        ),
      ),
    );
  }
}

class SkeletonList extends StatelessWidget {
  const SkeletonList({super.key, this.rows = 5});

  final int rows;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (var i = 0; i < rows; i++)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 10, horizontal: 16),
            child: Row(
              children: [
                Skeleton(width: 42, height: 42, radius: 21),
                SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [Skeleton(width: 140, height: 13), SizedBox(height: 8), Skeleton(height: 11)],
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

class Segmented<T> extends StatelessWidget {
  const Segmented({super.key, required this.value, required this.options, required this.onChanged});

  final T value;
  final List<(T, String)> options;
  final ValueChanged<T> onChanged;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final index = options.indexWhere((o) => o.$1 == value);
    return Container(
      height: 44,
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: c.surface2,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: c.border),
      ),
      child: LayoutBuilder(
        builder: (context, box) {
          final w = box.maxWidth / options.length;
          return Stack(
            children: [
              AnimatedPositioned(
                duration: const Duration(milliseconds: 320),
                curve: Curves.easeOutBack,
                left: w * max(index, 0),
                top: 0,
                bottom: 0,
                width: w,
                child: Container(
                  decoration: BoxDecoration(
                    color: c.surface,
                    borderRadius: BorderRadius.circular(10),
                    boxShadow: [
                      BoxShadow(color: Colors.black.withValues(alpha: 0.08), blurRadius: 8, offset: const Offset(0, 2)),
                    ],
                  ),
                ),
              ),
              Row(
                children: [
                  for (final o in options)
                    Expanded(
                      child: Semantics(
                        selected: o.$1 == value,
                        button: true,
                        child: InkWell(
                          borderRadius: BorderRadius.circular(10),
                          onTap: () => onChanged(o.$1),
                          child: Center(
                            child: AnimatedDefaultTextStyle(
                              duration: const Duration(milliseconds: 200),
                              style: font(
                                body,
                                13.5,
                                o.$1 == value ? FontWeight.w700 : FontWeight.w500,
                                color: o.$1 == value ? c.text : c.text3,
                              ),
                              child: Text(tr(o.$2)),
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ],
          );
        },
      ),
    );
  }
}

/// Labelled text field, like the web `Field` + input.
class LabeledField extends StatelessWidget {
  const LabeledField({
    super.key,
    required this.label,
    required this.controller,
    this.hint,
    this.icon,
    this.obscure = false,
    this.keyboard,
    this.maxLines = 1,
    this.suffix,
    this.onSubmitted,
    this.autofocus = false,
    this.helper,
    this.onChanged,
    this.autofill,
  });

  final String label;
  final TextEditingController controller;
  final String? hint;
  final IconData? icon;
  final bool obscure;
  final TextInputType? keyboard;
  final int maxLines;
  final Widget? suffix;
  final ValueChanged<String>? onSubmitted;
  final bool autofocus;
  final String? helper;
  final ValueChanged<String>? onChanged;
  final Iterable<String>? autofill;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: context.text.labelLarge?.copyWith(fontSize: 13.5)),
        const SizedBox(height: 7),
        TextField(
          controller: controller,
          obscureText: obscure,
          keyboardType: keyboard,
          maxLines: maxLines,
          autofocus: autofocus,
          onSubmitted: onSubmitted,
          onChanged: onChanged,
          autofillHints: autofill,
          decoration: InputDecoration(
            hintText: hint,
            prefixIcon: icon == null ? null : Icon(icon, size: 18),
            suffixIcon: suffix,
            helperText: helper,
            helperMaxLines: 2,
          ),
        ),
      ],
    );
  }
}

/// A globe button that switches the language (on the sign-in screen, before there is an account).
class LanguageMenu extends StatelessWidget {
  const LanguageMenu({super.key, required this.value, required this.onChanged});

  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) => PopupMenuButton<String>(
    tooltip: 'Language / Язык',
    initialValue: value,
    onSelected: onChanged,
    itemBuilder: (_) => [for (final code in appLocales) PopupMenuItem(value: code, child: Text(localeNames[code]!))],
    child: Padding(
      padding: const EdgeInsets.all(8),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(LucideIcons.globe, size: 18),
          const SizedBox(width: 6),
          Text(localeNames[value]!, style: context.text.bodyMedium),
        ],
      ),
    ),
  );
}

void toast(BuildContext context, String message, {bool error = false}) {
  final c = context.c;
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Row(
          children: [
            Icon(
              error ? LucideIcons.circleAlert : LucideIcons.circleCheck,
              size: 18,
              color: error ? c.danger : c.success,
            ),
            const SizedBox(width: 10),
            Expanded(child: Text(message)),
          ],
        ),
      ),
    );
}

/// Pads content on wide screens so pages read like the web client.
class PageBody extends StatelessWidget {
  const PageBody({super.key, required this.children, this.maxWidth = 1120, this.padding, this.onRefresh});

  final List<Widget> children;
  final double maxWidth;
  final EdgeInsets? padding;
  final Future<void> Function()? onRefresh;

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width > 700;
    final list = ListView(
      physics: const AlwaysScrollableScrollPhysics(parent: BouncingScrollPhysics()),
      padding: padding ?? EdgeInsets.fromLTRB(wide ? 28 : 16, wide ? 24 : 12, wide ? 28 : 16, 32),
      children: [
        Center(
          child: ConstrainedBox(
            constraints: BoxConstraints(maxWidth: maxWidth),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
          ),
        ),
      ],
    );
    return onRefresh == null ? list : RefreshIndicator(onRefresh: onRefresh!, child: list);
  }
}
