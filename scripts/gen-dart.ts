/**
 * Generates Dart code for the native app from the shared TypeScript definitions, so themes
 * and currencies are identical in the web client, the admin panel and the native apps.
 *
 *   pnpm gen:dart          (CI fails when a generated file is out of date)
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CURRENCIES } from '../packages/shared/src/currencies.ts';
import { THEMES, type ThemeColors } from '../packages/shared/src/themes.ts';

const out = fileURLToPath(new URL('../clients/app/lib/theme/palettes.g.dart', import.meta.url));
const currenciesOut = fileURLToPath(new URL('../clients/app/lib/api/currencies.g.dart', import.meta.url));

const dartColor = (hex: string) => `Color(0xFF${hex.replace('#', '').toUpperCase()})`;
const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const tokens = Object.keys(THEMES[0]!.colors) as (keyof ThemeColors)[];

const lines: string[] = [
  '// GENERATED FILE — do not edit. Run `pnpm gen:dart` after changing',
  '// packages/shared/src/themes.ts.',
  '',
  "import 'package:flutter/painting.dart';",
  '',
  '/// Colour tokens of one theme (same names as the web CSS variables).',
  'class OvlPalette {',
  '  const OvlPalette({',
  '    required this.id,',
  '    required this.name,',
  '    required this.description,',
  '    required this.dark,',
  ...tokens.map((t) => `    required this.${t},`),
  '  });',
  '',
  '  final String id;',
  '  final String name;',
  '  final String description;',
  '  final bool dark;',
  ...tokens.map((t) => `  final Color ${t};`),
  '}',
  '',
  '/// Every theme, in the order the pickers show them.',
  'const List<OvlPalette> ovlPalettes = [',
];
for (const theme of THEMES) {
  lines.push('  OvlPalette(');
  lines.push(`    id: ${quote(theme.id)},`);
  lines.push(`    name: ${quote(theme.name)},`);
  lines.push(`    description: ${quote(theme.description)},`);
  lines.push(`    dark: ${theme.mode === 'dark'},`);
  for (const t of tokens) lines.push(`    ${t}: ${dartColor(theme.colors[t])},`);
  lines.push('  ),');
}
lines.push('];', '');

writeFileSync(out, lines.join('\n'));
console.log(`Wrote ${THEMES.length} palettes to ${out}`);

const currencies = [
  '// GENERATED FILE — do not edit. Run `pnpm gen:dart` after changing',
  '// packages/shared/src/currencies.ts.',
  '',
  '/// Every supported currency: ISO code → (name, minor-unit decimals). Virtual-country currencies',
  '/// are added at start-up from GET /currencies (see Session).',
  'final currencies = <String, (String, int)>{',
  ...CURRENCIES.map((c) => `  '${c.code}': (${quote(c.name)}, ${c.decimals}),`),
  '};',
  '',
  'int currencyDecimals(String code) => currencies[code]?.$2 ?? 2;',
  '',
];
writeFileSync(currenciesOut, currencies.join('\n'));
console.log(`Wrote ${CURRENCIES.length} currencies to ${currenciesOut}`);
