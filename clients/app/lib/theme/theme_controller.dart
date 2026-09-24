import 'dart:math';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'theme.dart';

/// The theme preference of this device ("system" or a theme id), with an animated
/// circular reveal when it changes — same as the web client.
class ThemeController extends ChangeNotifier with WidgetsBindingObserver {
  ThemeController(this._prefs) : preference = _prefs.getString(_key) ?? 'system' {
    WidgetsBinding.instance.addObserver(this);
  }

  static const _key = 'ovl.theme';
  final SharedPreferences _prefs;
  final GlobalKey<ThemeRevealState> revealKey = GlobalKey();
  String preference;

  Brightness get _platform => WidgetsBinding.instance.platformDispatcher.platformBrightness;
  OvlPalette get palette => resolvePalette(preference, _platform);
  ThemeData get theme => buildTheme(palette);

  /// Switch theme; with [origin] the new theme grows as a circle from that point.
  void set(String next, {Offset? origin, bool persist = true}) {
    if (persist) _prefs.setString(_key, next);
    if (next == preference) return;
    final before = palette.id;
    preference = next;
    if (palette.id == before) return;
    final reveal = revealKey.currentState;
    if (origin != null && reveal != null && !reveal.reduceMotion) {
      reveal.capture();
      notifyListeners();
      reveal.play(origin);
    } else {
      notifyListeners();
    }
  }

  @override
  void didChangePlatformBrightness() {
    if (preference == 'system') notifyListeners();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }
}

/// Wraps the app: snapshots the old frame, then uncovers the new theme through a growing circle.
class ThemeReveal extends StatefulWidget {
  const ThemeReveal({super.key, required this.child});

  final Widget child;

  @override
  State<ThemeReveal> createState() => ThemeRevealState();
}

class ThemeRevealState extends State<ThemeReveal> with SingleTickerProviderStateMixin {
  final _boundary = GlobalKey();
  late final AnimationController _anim = AnimationController(vsync: this, duration: const Duration(milliseconds: 650))
    ..addStatusListener((s) {
      if (s == AnimationStatus.completed) setState(() => _image = null);
    });
  ui.Image? _image;
  Offset _origin = Offset.zero;

  bool get reduceMotion => MediaQuery.maybeDisableAnimationsOf(context) ?? false;

  void capture() {
    final boundary = _boundary.currentContext?.findRenderObject() as RenderRepaintBoundary?;
    if (boundary == null || !boundary.hasSize) return;
    _image?.dispose();
    _image = boundary.toImageSync(pixelRatio: MediaQuery.devicePixelRatioOf(context));
  }

  void play(Offset origin) {
    if (_image == null) return;
    setState(() => _origin = origin);
    _anim.forward(from: 0);
  }

  @override
  void dispose() {
    _anim.dispose();
    _image?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      textDirection: TextDirection.ltr,
      children: [
        RepaintBoundary(key: _boundary, child: widget.child),
        if (_image != null)
          Positioned.fill(
            child: IgnorePointer(
              child: AnimatedBuilder(
                animation: _anim,
                builder: (context, _) =>
                    CustomPaint(painter: _RevealPainter(_image!, _origin, Curves.easeOutQuart.transform(_anim.value))),
              ),
            ),
          ),
      ],
    );
  }
}

class _RevealPainter extends CustomPainter {
  _RevealPainter(this.image, this.origin, this.t);

  final ui.Image image;
  final Offset origin;
  final double t;

  @override
  void paint(Canvas canvas, Size size) {
    final corners = [Offset.zero, Offset(size.width, 0), Offset(0, size.height), Offset(size.width, size.height)];
    final radius = corners.map((c) => (c - origin).distance).reduce(max) * t;
    final hole = Path()
      ..fillType = PathFillType.evenOdd
      ..addRect(Offset.zero & size)
      ..addOval(Rect.fromCircle(center: origin, radius: radius));
    canvas.clipPath(hole);
    canvas.drawImageRect(
      image,
      Offset.zero & Size(image.width.toDouble(), image.height.toDouble()),
      Offset.zero & size,
      Paint()..filterQuality = FilterQuality.medium,
    );
  }

  @override
  bool shouldRepaint(_RevealPainter old) => old.t != t || old.image != image;
}
