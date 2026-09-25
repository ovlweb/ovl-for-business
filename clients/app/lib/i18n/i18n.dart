import 'package:flutter/widgets.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'ru.g.dart';

/// Languages of the app. The English text is the key: `tr('Send money')`,
/// `tr('Bought {0} shares', [n])`. The Russian catalog is generated from the same translations as
/// the web client (scripts/i18n), and the account keeps the choice for every device.
const appLocales = ['en', 'ru'];
const localeNames = {'en': 'English', 'ru': 'Русский'};

String _current = 'en';

/// The language on screen now ('en' or 'ru').
String get currentLocale => _current;

/// Follows the language picked in Settings (saved on this device and in the account).
class LocaleController extends ChangeNotifier {
  LocaleController(this._prefs) : code = _initial(_prefs);

  static const _key = 'ovl.locale';
  final SharedPreferences _prefs;
  String code;

  static String _initial(SharedPreferences prefs) {
    final saved = prefs.getString(_key);
    if (saved != null && appLocales.contains(saved)) return saved;
    final device = WidgetsBinding.instance.platformDispatcher.locale.languageCode;
    return device == 'ru' ? 'ru' : 'en';
  }

  Locale get locale => Locale(code);

  /// Load date and number formats for the language; call once before the first frame.
  Future<void> init() => _apply();

  Future<void> set(String next) async {
    if (!appLocales.contains(next) || next == code) return;
    code = next;
    await _prefs.setString(_key, next);
    await _apply();
    notifyListeners();
  }

  Future<void> _apply() async {
    _current = code;
    Intl.defaultLocale = code == 'ru' ? 'ru' : 'en_US';
    await initializeDateFormatting(Intl.defaultLocale);
  }
}

/// Translate English UI text; `{0}`, `{1}`… are replaced by [values].
String tr(String source, [List<Object?> values = const []]) {
  final text = _current == 'ru' ? (ru[source] ?? source) : source;
  if (values.isEmpty) return text;
  return text.replaceAllMapped(RegExp(r'\{(\d+)\}'), (m) {
    final i = int.parse(m[1]!);
    return i < values.length ? '${values[i] ?? ''}' : '';
  });
}

/// Which of [one, few, many] a count takes in Russian.
int _russianForm(int count) {
  final n = count.abs() % 100;
  final last = n % 10;
  if (n >= 11 && n <= 14) return 2;
  if (last == 1) return 0;
  if (last >= 2 && last <= 4) return 1;
  return 2;
}

/// "1 operation", "3 operations" (in Russian: "1 операция", "3 операции", "5 операций").
String plural(int count, String one, [String? many]) {
  final number = NumberFormat.decimalPattern().format(count);
  final forms = _current == 'ru' ? ruPlurals[one] : null;
  if (forms != null) return '$number ${forms[_russianForm(count)]}';
  return '$number ${tr(count == 1 ? one : (many ?? '${one}s'))}';
}
