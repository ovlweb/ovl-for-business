import 'dart:math';

import 'package:flutter/material.dart';

import '../theme/theme.dart';
import '../i18n/i18n.dart';

/// Monotone cubic (Fritsch–Carlson) path through [pts]: smooth, and never overshoots.
Path monotonePath(List<Offset> pts) {
  final n = pts.length;
  final path = Path()..moveTo(pts[0].dx, pts[0].dy);
  if (n < 2) return path;
  final dx = <double>[];
  final slope = <double>[];
  for (var i = 0; i < n - 1; i++) {
    final d = pts[i + 1].dx - pts[i].dx;
    dx.add(d);
    slope.add(d == 0 ? 0 : (pts[i + 1].dy - pts[i].dy) / d);
  }
  final tangent = <double>[slope[0]];
  for (var i = 1; i < n - 1; i++) {
    final a = slope[i - 1], b = slope[i];
    tangent.add(a * b <= 0 ? 0 : 3 * (dx[i - 1] + dx[i]) / ((2 * dx[i] + dx[i - 1]) / a + (dx[i] + 2 * dx[i - 1]) / b));
  }
  tangent.add(slope[n - 2]);
  for (var i = 0; i < n - 1; i++) {
    final h = dx[i] / 3;
    path.cubicTo(
      pts[i].dx + h,
      pts[i].dy + tangent[i] * h,
      pts[i + 1].dx - h,
      pts[i + 1].dy - tangent[i + 1] * h,
      pts[i + 1].dx,
      pts[i + 1].dy,
    );
  }
  return path;
}

/// Area chart that draws itself in. With [format] it shows grid lines and a touch / hover
/// crosshair with a tooltip (using [labels] for the second line).
class AreaChart extends StatefulWidget {
  const AreaChart({super.key, required this.values, this.labels, this.format, this.height = 180, this.color});

  final List<double> values;
  final List<String>? labels;
  final String Function(double)? format;
  final double height;
  final Color? color;

  @override
  State<AreaChart> createState() => _AreaChartState();
}

class _AreaChartState extends State<AreaChart> with SingleTickerProviderStateMixin {
  late final AnimationController _draw = AnimationController(vsync: this, duration: const Duration(milliseconds: 1200))
    ..forward();
  int? _hover;

  @override
  void didUpdateWidget(AreaChart old) {
    super.didUpdateWidget(old);
    if (old.values.length != widget.values.length) _draw.forward(from: 0);
  }

  @override
  void dispose() {
    _draw.dispose();
    super.dispose();
  }

  void _track(Offset local, double width) {
    if (widget.format == null) return;
    final n = widget.values.length;
    setState(() => _hover = ((local.dx / width) * (n - 1)).round().clamp(0, n - 1));
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    if (widget.values.length < 2) {
      return SizedBox(
        height: widget.height,
        child: Center(
          child: Text(
            tr('Not enough history yet — the chart appears after the next change.'),
            style: context.text.bodySmall,
            textAlign: TextAlign.center,
          ),
        ),
      );
    }
    return LayoutBuilder(
      builder: (context, box) {
        final width = box.maxWidth;
        return MouseRegion(
          onHover: (e) => _track(e.localPosition, width),
          onExit: (_) => setState(() => _hover = null),
          child: GestureDetector(
            onPanDown: (d) => _track(d.localPosition, width),
            onPanUpdate: (d) => _track(d.localPosition, width),
            onPanEnd: (_) => setState(() => _hover = null),
            onPanCancel: () => setState(() => _hover = null),
            child: AnimatedBuilder(
              animation: _draw,
              builder: (context, _) => CustomPaint(
                size: Size(width, widget.height),
                painter: _AreaPainter(
                  values: widget.values,
                  color: widget.color ?? c.accent,
                  grid: c.border,
                  axis: c.text3,
                  surface: c.surface,
                  progress: Curves.easeOutQuart.transform(_draw.value),
                  hover: _hover,
                  format: widget.format,
                  label: _hover == null ? null : widget.labels?[_hover!],
                  tipText: c.text,
                  tipMuted: c.text2,
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _AreaPainter extends CustomPainter {
  _AreaPainter({
    required this.values,
    required this.color,
    required this.grid,
    required this.axis,
    required this.surface,
    required this.progress,
    required this.hover,
    required this.format,
    required this.label,
    required this.tipText,
    required this.tipMuted,
  });

  final List<double> values;
  final Color color, grid, axis, surface, tipText, tipMuted;
  final double progress;
  final int? hover;
  final String Function(double)? format;
  final String? label;

  @override
  void paint(Canvas canvas, Size size) {
    final interactive = format != null;
    final top = interactive ? 16.0 : 8.0;
    final bottom = interactive ? 14.0 : 8.0;
    final lo = values.reduce(min), hi = values.reduce(max);
    final margin = (hi - lo == 0 ? (hi == 0 ? 1 : hi.abs()) : hi - lo) * 0.08;
    final mn = lo - margin, span = (hi + margin) - mn;
    double y(double v) => top + (1 - (v - mn) / span) * (size.height - top - bottom);
    final pts = [for (var i = 0; i < values.length; i++) Offset(i / (values.length - 1) * size.width, y(values[i]))];

    if (interactive) {
      final dash = Paint()
        ..color = grid
        ..strokeWidth = 1;
      for (final f in [0.25, 0.5, 0.75]) {
        final v = lo + (hi - lo) * f;
        final gy = y(v);
        for (double x = 0; x < size.width; x += 8) {
          canvas.drawLine(Offset(x, gy), Offset(min(x + 3, size.width), gy), dash);
        }
        _text(
          canvas,
          format!(v),
          Offset(2, gy - 16),
          TextStyle(
            color: axis,
            fontSize: 10.5,
            fontFamily: body,
            shadows: [
              Shadow(color: surface, blurRadius: 3),
              Shadow(color: surface, blurRadius: 3),
            ],
          ),
        );
      }
    }

    final line = monotonePath(pts);
    canvas.save();
    canvas.clipRect(Rect.fromLTWH(0, 0, size.width * progress, size.height));
    final area = Path.from(line)
      ..lineTo(size.width, size.height)
      ..lineTo(0, size.height)
      ..close();
    canvas.drawPath(
      area,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [color.withValues(alpha: 0.28), color.withValues(alpha: 0)],
        ).createShader(Offset.zero & size),
    );
    canvas.drawPath(
      line,
      Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.6
        ..strokeCap = StrokeCap.round,
    );
    canvas.restore();

    if (hover == null) {
      if (progress > 0.95) canvas.drawCircle(pts.last, 4.5, Paint()..color = color);
      return;
    }
    final p = pts[hover!];
    canvas.drawLine(Offset(p.dx, 0), Offset(p.dx, size.height), Paint()..color = axis.withValues(alpha: 0.5));
    canvas.drawCircle(p, 6, Paint()..color = surface);
    canvas.drawCircle(
      p,
      6,
      Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.6,
    );

    final title = TextPainter(
      text: TextSpan(
        text: format!(values[hover!]),
        style: TextStyle(color: tipText, fontSize: 13, fontWeight: FontWeight.w700, fontFamily: body),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    final sub = label == null
        ? null
        : (TextPainter(
            text: TextSpan(
              text: label,
              style: TextStyle(color: tipMuted, fontSize: 11.5, fontFamily: body),
            ),
            textDirection: TextDirection.ltr,
          )..layout());
    final w = max(title.width, sub?.width ?? 0) + 20;
    final h = title.height + (sub?.height ?? 0) + 14;
    final left = (p.dx - w / 2).clamp(0.0, size.width - w);
    final tipTop = max(0.0, p.dy - h - 12);
    final rect = RRect.fromRectAndRadius(Rect.fromLTWH(left, tipTop, w, h), const Radius.circular(10));
    canvas.drawRRect(
      rect.shift(const Offset(0, 3)),
      Paint()
        ..color = Colors.black.withValues(alpha: 0.12)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 6),
    );
    canvas.drawRRect(rect, Paint()..color = surface);
    canvas.drawRRect(
      rect,
      Paint()
        ..color = grid
        ..style = PaintingStyle.stroke,
    );
    title.paint(canvas, Offset(left + (w - title.width) / 2, tipTop + 7));
    sub?.paint(canvas, Offset(left + (w - sub.width) / 2, tipTop + 7 + title.height));
  }

  void _text(Canvas canvas, String text, Offset at, TextStyle style) {
    (TextPainter(
      text: TextSpan(text: text, style: style),
      textDirection: TextDirection.ltr,
    )..layout()).paint(canvas, at);
  }

  @override
  bool shouldRepaint(_AreaPainter old) =>
      old.progress != progress || old.hover != hover || old.values != values || old.color != color;
}

/// A small inline trend line (home screen, listing rows).
class Sparkline extends StatelessWidget {
  const Sparkline(this.values, {super.key, this.color, this.width = 80, this.height = 30});

  final List<double> values;
  final Color? color;
  final double width;
  final double height;

  @override
  Widget build(BuildContext context) {
    if (values.length < 2) return SizedBox(width: width, height: height);
    return SizedBox(
      width: width,
      height: height,
      child: AreaChart(values: values, height: height, color: color),
    );
  }
}
