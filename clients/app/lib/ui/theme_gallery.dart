import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../theme/theme.dart';
import 'widgets.dart';
import '../i18n/i18n.dart';

/// Grid of theme previews (a miniature of the app in each palette). "system" follows the OS.
class ThemeGallery extends StatelessWidget {
  const ThemeGallery({super.key, required this.value, required this.onChanged});

  final String value;
  final void Function(String id, Offset origin) onChanged;

  @override
  Widget build(BuildContext context) {
    final options = <(String, String, String)>[
      ('system', 'Match system', 'Daylight by day, Midnight at night.'),
      for (final p in ovlPalettes) (p.id, p.name, p.description),
    ];
    return LayoutBuilder(
      builder: (context, box) {
        final columns = box.maxWidth > 760 ? 3 : 2;
        final gap = 12.0;
        final w = (box.maxWidth - gap * (columns - 1)) / columns;
        return Wrap(
          spacing: gap,
          runSpacing: gap,
          children: [
            for (final (i, o) in options.indexed)
              SizedBox(
                width: w,
                child: FadeSlideIn(
                  delay: stagger(i, 35),
                  child: _ThemeCard(
                    id: o.$1,
                    name: tr(o.$2),
                    description: tr(o.$3),
                    selected: value == o.$1,
                    onTap: (origin) => onChanged(o.$1, origin),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

class _ThemeCard extends StatelessWidget {
  const _ThemeCard({
    required this.id,
    required this.name,
    required this.description,
    required this.selected,
    required this.onTap,
  });

  final String id;
  final String name;
  final String description;
  final bool selected;
  final ValueChanged<Offset> onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Semantics(
      label: name,
      selected: selected,
      inMutuallyExclusiveGroup: true,
      button: true,
      child: GestureDetector(
        onTapUp: (d) => onTap(d.globalPosition),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 220),
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: c.surface,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: selected ? c.accent : c.border, width: selected ? 2 : 1),
            boxShadow: selected ? [BoxShadow(color: c.accent.withValues(alpha: 0.18), blurRadius: 18)] : null,
          ),
          child: Stack(
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  AspectRatio(
                    aspectRatio: 16 / 10,
                    child: id == 'system'
                        ? ClipRRect(
                            borderRadius: BorderRadius.circular(12),
                            child: Stack(
                              children: [
                                Positioned.fill(child: _Preview(paletteById(defaultLightTheme))),
                                Positioned.fill(
                                  child: ClipPath(clipper: _Diagonal(), child: _Preview(paletteById(defaultDarkTheme))),
                                ),
                              ],
                            ),
                          )
                        : _Preview(paletteById(id)),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(4, 10, 4, 4),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(name, style: context.text.titleSmall),
                        const SizedBox(height: 2),
                        Text(description, maxLines: 2, overflow: TextOverflow.ellipsis, style: context.text.bodySmall),
                      ],
                    ),
                  ),
                ],
              ),
              Positioned(
                right: 6,
                top: 6,
                child: AnimatedScale(
                  scale: selected ? 1 : 0,
                  duration: const Duration(milliseconds: 280),
                  curve: Curves.easeOutBack,
                  child: Container(
                    padding: const EdgeInsets.all(4),
                    decoration: BoxDecoration(color: c.accent, shape: BoxShape.circle),
                    child: Icon(LucideIcons.check, size: 14, color: c.accentText),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Diagonal extends CustomClipper<Path> {
  @override
  Path getClip(Size size) => Path()
    ..moveTo(size.width, 0)
    ..lineTo(size.width, size.height)
    ..lineTo(0, size.height)
    ..close();

  @override
  bool shouldReclip(covariant CustomClipper<Path> oldClipper) => false;
}

/// A miniature app window drawn in [p]'s colours.
class _Preview extends StatelessWidget {
  const _Preview(this.p);

  final OvlPalette p;

  @override
  Widget build(BuildContext context) {
    Widget line(double w, Color color, [double h = 5]) => FractionallySizedBox(
      widthFactor: w,
      alignment: Alignment.centerLeft,
      child: Container(
        height: h,
        decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(3)),
      ),
    );
    return Container(
      decoration: BoxDecoration(
        color: p.bg,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: p.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: Row(
        children: [
          Container(
            width: 44,
            padding: const EdgeInsets.all(7),
            decoration: BoxDecoration(
              color: p.sidebarBg,
              border: Border(right: BorderSide(color: p.sidebarBorder)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  height: 5,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(colors: [p.gradFrom, p.gradTo]),
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
                const SizedBox(height: 7),
                line(1, p.sidebarActiveBg),
                const SizedBox(height: 5),
                line(0.7, p.sidebarMuted.withValues(alpha: 0.5)),
                const SizedBox(height: 5),
                line(0.85, p.sidebarMuted.withValues(alpha: 0.5)),
              ],
            ),
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  line(0.5, p.text.withValues(alpha: 0.85), 6),
                  const SizedBox(height: 7),
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.all(6),
                      decoration: BoxDecoration(
                        color: p.surface,
                        borderRadius: BorderRadius.circular(7),
                        border: Border.all(color: p.border),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          line(0.6, p.text2.withValues(alpha: 0.6)),
                          const SizedBox(height: 5),
                          line(0.35, p.accent),
                          const Spacer(),
                          Row(
                            children: [
                              for (final col in [p.success, p.warning, p.council])
                                Container(
                                  width: 14,
                                  height: 5,
                                  margin: const EdgeInsets.only(right: 4),
                                  decoration: BoxDecoration(color: col, borderRadius: BorderRadius.circular(3)),
                                ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
