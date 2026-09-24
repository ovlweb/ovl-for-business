import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ovl_business/api/models.dart';
import 'package:ovl_business/theme/theme.dart';
import 'package:ovl_business/ui/chart.dart';
import 'package:ovl_business/ui/format.dart';
import 'package:ovl_business/ui/theme_gallery.dart';

Widget _themed(Widget child, [String theme = 'daylight']) => MaterialApp(
  theme: buildTheme(paletteById(theme)),
  home: Scaffold(body: SingleChildScrollView(child: child)),
);

void main() {
  group('format', () {
    test('money groups thousands and keeps decimals', () {
      expect(money('48500.5', 'EUR'), '48,500.50 EUR');
      expect(money('-1200.00', 'USD'), '−1,200.00 USD');
      expect(money('7', 'JPY', decimals: 0), '7 JPY');
      expect(money('1234567.891', 'BHD', code: false), '1,234,567.891');
    });

    test('plural and initials', () {
      expect(plural(1, 'member'), '1 member');
      expect(plural(3, 'currency', 'currencies'), '3 currencies');
      expect(initials('Maria Petrova'), 'MP');
      expect(initials('owner'), 'OW');
    });
  });

  group('themes', () {
    test('every shared theme is generated', () {
      expect(
        ovlPalettes.map((p) => p.id),
        containsAll(['daylight', 'midnight', 'graphite', 'emerald', 'obsidian', 'ivory', 'aurora', 'contrast']),
      );
    });

    test('system follows the platform brightness', () {
      expect(resolvePalette('system', Brightness.dark).id, 'midnight');
      expect(resolvePalette('system', Brightness.light).id, 'daylight');
      expect(resolvePalette('emerald', Brightness.dark).id, 'emerald');
      expect(resolvePalette('unknown', Brightness.light).id, 'daylight');
    });
  });

  test('application titles come from the payload', () {
    final a = Application.fromJson({
      'id': 'a',
      'type': 'council',
      'status': 'pending',
      'stageIndex': 0,
      'currentStage': 'council',
      'applicant': {
        'id': 'u',
        'username': 'maria',
        'displayName': 'Maria',
        'avatarUrl': null,
        'role': 'user',
        'badges': [],
      },
      'payload': {'motivation': 'I want to help the platform grow.'},
      'result': null,
      'rejectionReason': null,
      'reviews': [],
      'createdAt': '2026-09-01T10:00:00Z',
      'updatedAt': '2026-09-01T10:00:00Z',
      'decidedAt': null,
    });
    expect(a.title, 'Join the council');
  });

  testWidgets('theme gallery lists every theme and reports the tap', (tester) async {
    tester.view.physicalSize = const Size(1200, 2400);
    addTearDown(tester.view.resetPhysicalSize);
    String? picked;
    await tester.pumpWidget(_themed(ThemeGallery(value: 'daylight', onChanged: (id, _) => picked = id)));
    await tester.pumpAndSettle();
    for (final p in ovlPalettes) {
      expect(find.text(p.name), findsOneWidget);
    }
    await tester.tap(find.text('Emerald'));
    expect(picked, 'emerald');
  });

  testWidgets('area chart draws and shows a message without history', (tester) async {
    await tester.pumpWidget(
      _themed(
        const Column(
          children: [
            AreaChart(values: [1, 3, 2, 5], height: 120),
            AreaChart(values: [4], height: 80),
          ],
        ),
        'midnight',
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byType(CustomPaint), findsWidgets);
    expect(find.textContaining('Not enough history'), findsOneWidget);
  });
}
