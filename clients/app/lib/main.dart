import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app.dart';
import 'state/session.dart';
import 'theme/theme_controller.dart';

/// Desktop builds accept `--route=/wallet` to open a screen directly (deep links).
String? _routeArg(List<String> args) {
  for (final a in args) {
    if (a.startsWith('--route=')) return a.substring('--route='.length);
  }
  return null;
}

Future<void> main(List<String> args) async {
  WidgetsFlutterBinding.ensureInitialized();
  LicenseRegistry.addLicense(() async* {
    for (final font in ['Inter', 'Manrope']) {
      yield LicenseEntryWithLineBreaks([font], await rootBundle.loadString('assets/fonts/OFL-$font.txt'));
    }
  });
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
  final prefs = await SharedPreferences.getInstance();
  final themes = ThemeController(prefs);
  final session = await Session.start(prefs, themes);
  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: themes),
        ChangeNotifierProvider.value(value: session),
      ],
      child: OvlApp(session: session, initialRoute: _routeArg(args)),
    ),
  );
}
