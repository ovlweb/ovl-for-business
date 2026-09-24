import 'package:intl/intl.dart';

import '../api/currencies.g.dart';

/// "48500.5" → "48,500.50 EUR" (money arrives from the API as decimal strings).
String money(String amount, String currency, {bool code = true, int? decimals}) {
  final negative = amount.startsWith('-');
  final parts = amount.replaceFirst('-', '').split('.');
  final whole = parts[0].replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',');
  var fraction = parts.length > 1 ? parts[1] : '';
  final d = decimals ?? currencyDecimals(currency);
  fraction = fraction.padRight(d, '0').substring(0, d);
  return '${negative ? '−' : ''}$whole${d > 0 ? '.$fraction' : ''}${code ? ' $currency' : ''}';
}

String moneyOf(double value, String currency, {bool code = true}) =>
    money(value.toStringAsFixed(2), currency, code: code);

String plural(int count, String one, [String? many]) =>
    '${NumberFormat.decimalPattern().format(count)} ${count == 1 ? one : (many ?? '${one}s')}';

String shortTime(DateTime d) => DateFormat.jm().format(d);

String dayLabel(DateTime d) {
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  final day = DateTime(d.year, d.month, d.day);
  final diff = today.difference(day).inDays;
  if (diff == 0) return 'Today';
  if (diff == 1) return 'Yesterday';
  if (diff < 7) return DateFormat.EEEE().format(d);
  return DateFormat.yMMMd().format(d);
}

/// Chat-list style: time today, weekday this week, date otherwise.
String listTime(DateTime d) {
  final now = DateTime.now();
  if (now.difference(d).inHours < 24 && now.day == d.day) return shortTime(d);
  if (now.difference(d).inDays < 7) return DateFormat.E().format(d);
  return DateFormat.MMMd().format(d);
}

String date(DateTime d) => DateFormat.yMMMd().format(d);
String dateTime(DateTime d) => DateFormat.yMMMd().add_jm().format(d);

String timeAgo(DateTime d) {
  final s = DateTime.now().difference(d).inSeconds;
  if (s < 60) return 'just now';
  if (s < 3600) return '${s ~/ 60} min ago';
  if (s < 86400) return '${s ~/ 3600} h ago';
  if (s < 86400 * 7) return '${s ~/ 86400} d ago';
  return date(d);
}

String humanize(String key) {
  final s = key.replaceAll('_', ' ');
  return s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);
}

String greeting() {
  final h = DateTime.now().hour;
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

String initials(String name) {
  final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
  if (parts.isEmpty) return '?';
  return (parts.length == 1 ? parts[0].substring(0, parts[0].length.clamp(1, 2)) : '${parts[0][0]}${parts[1][0]}')
      .toUpperCase();
}
