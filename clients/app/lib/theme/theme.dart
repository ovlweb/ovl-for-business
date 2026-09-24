import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'palettes.g.dart';

export 'palettes.g.dart';

const defaultLightTheme = 'daylight';
const defaultDarkTheme = 'midnight';

OvlPalette paletteById(String id) => ovlPalettes.firstWhere((p) => p.id == id, orElse: () => ovlPalettes.first);

/// "system" (or an unknown id) follows the OS light / dark setting.
OvlPalette resolvePalette(String preference, Brightness platform) {
  if (preference == 'system' || !ovlPalettes.any((p) => p.id == preference)) {
    return paletteById(platform == Brightness.dark ? defaultDarkTheme : defaultLightTheme);
  }
  return paletteById(preference);
}

/// The active palette, reachable from any widget as `context.c`.
class OvlColors extends ThemeExtension<OvlColors> {
  const OvlColors(this.p);

  final OvlPalette p;

  LinearGradient get gradient =>
      LinearGradient(colors: [p.gradFrom, p.gradTo], begin: Alignment.topLeft, end: Alignment.bottomRight);

  Color role(String role) => switch (role) {
    'owner' => p.owner,
    'admin' => p.admin,
    'council' => p.council,
    'moderator' => p.moderator,
    'manager' => p.manager,
    'support' => p.support,
    _ => p.text3,
  };

  Color roleSoft(String role) => switch (role) {
    'owner' => p.ownerSoft,
    'admin' => p.adminSoft,
    'council' => p.councilSoft,
    'moderator' => p.moderatorSoft,
    'manager' => p.managerSoft,
    'support' => p.supportSoft,
    _ => p.surface3,
  };

  @override
  OvlColors copyWith({OvlPalette? p}) => OvlColors(p ?? this.p);

  @override
  OvlColors lerp(OvlColors? other, double t) => t < 0.5 ? this : (other ?? this);
}

extension OvlThemeContext on BuildContext {
  OvlPalette get c => Theme.of(this).extension<OvlColors>()!.p;
  OvlColors get ovl => Theme.of(this).extension<OvlColors>()!;
  TextTheme get text => Theme.of(this).textTheme;
}

/// Text style with the variable-font weight axis set explicitly.
TextStyle font(String family, double size, FontWeight weight, {double? height, double? letterSpacing, Color? color}) =>
    TextStyle(
      fontFamily: family,
      fontSize: size,
      fontWeight: weight,
      fontVariations: [FontVariation('wght', weight.value.toDouble())],
      height: height,
      letterSpacing: letterSpacing,
      color: color,
    );

const display = 'Manrope';
const body = 'Inter';

ThemeData buildTheme(OvlPalette p) {
  final brightness = p.dark ? Brightness.dark : Brightness.light;
  final scheme = ColorScheme(
    brightness: brightness,
    primary: p.accent,
    onPrimary: p.accentText,
    primaryContainer: p.accentSoft,
    onPrimaryContainer: p.accent2,
    secondary: p.gradTo,
    onSecondary: Colors.white,
    tertiary: p.council,
    onTertiary: Colors.white,
    error: p.danger,
    onError: Colors.white,
    errorContainer: p.dangerSoft,
    onErrorContainer: p.danger,
    surface: p.surface,
    onSurface: p.text,
    onSurfaceVariant: p.text2,
    surfaceContainerLowest: p.bg,
    surfaceContainerLow: p.surface,
    surfaceContainer: p.surface2,
    surfaceContainerHigh: p.surface2,
    surfaceContainerHighest: p.surface3,
    outline: p.borderStrong,
    outlineVariant: p.border,
    shadow: Colors.black,
    inverseSurface: p.text,
    onInverseSurface: p.surface,
    inversePrimary: p.accentSoft,
  );
  final text = TextTheme(
    displayLarge: font(display, 44, FontWeight.w800, height: 1.08, letterSpacing: -1.2, color: p.text),
    displayMedium: font(display, 34, FontWeight.w800, height: 1.1, letterSpacing: -0.8, color: p.text),
    displaySmall: font(display, 28, FontWeight.w800, height: 1.15, letterSpacing: -0.6, color: p.text),
    headlineLarge: font(display, 26, FontWeight.w800, height: 1.2, letterSpacing: -0.5, color: p.text),
    headlineMedium: font(display, 22, FontWeight.w800, height: 1.2, letterSpacing: -0.4, color: p.text),
    headlineSmall: font(display, 19, FontWeight.w700, height: 1.25, letterSpacing: -0.2, color: p.text),
    titleLarge: font(display, 17, FontWeight.w700, height: 1.3, color: p.text),
    titleMedium: font(body, 15, FontWeight.w600, height: 1.35, color: p.text),
    titleSmall: font(body, 13.5, FontWeight.w600, height: 1.35, color: p.text),
    bodyLarge: font(body, 15.5, FontWeight.w400, height: 1.5, color: p.text),
    bodyMedium: font(body, 14, FontWeight.w400, height: 1.45, color: p.text2),
    bodySmall: font(body, 12.5, FontWeight.w400, height: 1.4, color: p.text3),
    labelLarge: font(body, 14.5, FontWeight.w600, color: p.text),
    labelMedium: font(body, 12, FontWeight.w600, letterSpacing: 0.2, color: p.text2),
    labelSmall: font(body, 11, FontWeight.w700, letterSpacing: 0.7, color: p.text3),
  );
  final radius = BorderRadius.circular(14);
  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    scaffoldBackgroundColor: p.bg,
    canvasColor: p.bg,
    fontFamily: body,
    textTheme: text,
    extensions: [OvlColors(p)],
    splashFactory: InkSparkle.splashFactory,
    dividerTheme: DividerThemeData(color: p.border, thickness: 1, space: 1),
    appBarTheme: AppBarTheme(
      backgroundColor: p.bg,
      surfaceTintColor: Colors.transparent,
      foregroundColor: p.text,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: text.titleLarge,
      systemOverlayStyle: p.dark ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark,
    ),
    cardTheme: CardThemeData(
      color: p.surface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: BorderSide(color: p.border),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: p.surface,
      isDense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      hintStyle: TextStyle(color: p.text3),
      labelStyle: TextStyle(color: p.text2),
      floatingLabelStyle: TextStyle(color: p.accent),
      prefixIconColor: p.text3,
      suffixIconColor: p.text3,
      border: OutlineInputBorder(
        borderRadius: radius,
        borderSide: BorderSide(color: p.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: radius,
        borderSide: BorderSide(color: p.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: radius,
        borderSide: BorderSide(color: p.accent, width: 1.6),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: radius,
        borderSide: BorderSide(color: p.danger),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: p.accent,
        foregroundColor: p.accentText,
        minimumSize: const Size(64, 48),
        textStyle: text.labelLarge,
        shape: RoundedRectangleBorder(borderRadius: radius),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: p.text,
        minimumSize: const Size(64, 46),
        side: BorderSide(color: p.border),
        textStyle: text.labelLarge,
        shape: RoundedRectangleBorder(borderRadius: radius),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(foregroundColor: p.accent, textStyle: text.labelLarge),
    ),
    iconButtonTheme: IconButtonThemeData(style: IconButton.styleFrom(foregroundColor: p.text2)),
    listTileTheme: ListTileThemeData(
      iconColor: p.text2,
      textColor: p.text,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16),
      shape: RoundedRectangleBorder(borderRadius: radius),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: p.surface,
      selectedColor: p.accentSoft,
      side: BorderSide(color: p.border),
      labelStyle: text.labelMedium,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: p.surface,
      surfaceTintColor: Colors.transparent,
      showDragHandle: true,
      dragHandleColor: p.borderStrong,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(26))),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: p.surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: p.text,
      contentTextStyle: TextStyle(color: p.surface, fontFamily: body, fontSize: 14),
      shape: RoundedRectangleBorder(borderRadius: radius),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: p.surface,
      surfaceTintColor: Colors.transparent,
      indicatorColor: p.accentSoft,
      height: 68,
      labelTextStyle: WidgetStateProperty.resolveWith(
        (s) => font(
          body,
          11.5,
          s.contains(WidgetState.selected) ? FontWeight.w700 : FontWeight.w500,
          color: s.contains(WidgetState.selected) ? p.accent : p.text3,
        ),
      ),
      iconTheme: WidgetStateProperty.resolveWith(
        (s) => IconThemeData(size: 22, color: s.contains(WidgetState.selected) ? p.accent : p.text3),
      ),
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? Colors.white : p.borderStrong,
      ),
      trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? p.accent : p.surface3),
      trackOutlineColor: WidgetStateProperty.all(Colors.transparent),
    ),
    checkboxTheme: CheckboxThemeData(
      fillColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? p.accent : Colors.transparent,
      ),
      side: BorderSide(color: p.borderStrong, width: 1.6),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(5)),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: p.accent, linearTrackColor: p.surface3),
    tooltipTheme: TooltipThemeData(
      decoration: BoxDecoration(color: p.text, borderRadius: BorderRadius.circular(8)),
      textStyle: TextStyle(color: p.surface, fontSize: 12.5),
    ),
    pageTransitionsTheme: const PageTransitionsTheme(
      builders: {
        TargetPlatform.android: FadeForwardsPageTransitionsBuilder(),
        TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
        TargetPlatform.macOS: CupertinoPageTransitionsBuilder(),
        TargetPlatform.linux: FadeForwardsPageTransitionsBuilder(),
        TargetPlatform.windows: FadeForwardsPageTransitionsBuilder(),
      },
    ),
  );
}
