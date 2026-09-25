/**
 * Codemod: wrap user-facing text of the Flutter app in tr() so it can be translated.
 *
 *   pnpm --dir server exec tsx ../scripts/i18n/wrap-dart.ts ../clients/app/lib [--dry] [--values]
 *
 * - Text('…'), SectionHeader('…') and other widgets whose first fields are text (found from
 *   `const X(this.title…)` constructors), named text arguments (title:, label:, hintText:,
 *   tooltip:…), and toast(context, '…'); also both branches of `cond ? 'a' : 'b'` there.
 * - Interpolations become placeholders: 'Hi $name' → tr('Hi {0}', [name]).
 * - `const` above a wrapped text is removed (dart fix puts back what can stay const); text in
 *   top-level or class-level constants is only reported, since it has to be translated where shown.
 * Run dart format and flutter analyze afterwards.
 */
import fs from 'node:fs';
import path from 'node:path';
import { dartFiles as walk, lex, type Part } from './dart-lex';

const root = path.resolve(process.argv[2] ?? 'clients/app/lib');
const dry = process.argv.includes('--dry');
/** Also text a function returns or assigns: `return 'Paid'`, `'open' => 'Open'`, `final x = a ? 'Yes' : 'No'`. */
const valueMode = process.argv.includes('--values');

const NAMED = new Set([
  'title',
  'text',
  'label',
  'hint',
  'helper',
  'action',
  'hintText',
  'labelText',
  'helperText',
  'tooltip',
  'subtitle',
  'message',
  'semanticLabel',
  'semanticsLabel',
  'errorText',
  'confirmLabel',
  'cta',
  'heading',
  'caption',
  'description',
  'placeholder',
  'emptyText',
  'prefixText',
  'suffixText',
  'counterText',
]);
const TEXTISH = new Set([
  'title',
  'label',
  'text',
  'hint',
  'caption',
  'message',
  'subtitle',
  'heading',
  'description',
]);
/** Widgets whose positional arguments are text: index → yes. */
const POSITIONAL = new Map<string, Set<number>>([
  ['Text', new Set([0])],
  ['SelectableText', new Set([0])],
  ['toast', new Set([1])],
]);

const dartLiteral = (s: string) =>
  `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '\\$').replace(/\n/g, '\\n')}'`;

/** Constructors whose leading fields are text: `const _Fact(this.label, this.value)`. */
for (const file of walk(root)) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\bconst\s+(_?[A-Z]\w*)\(((?:\s*this\.\w+\s*,?)+)/g)) {
    const names = m[2]!
      .split(',')
      .map((s) => s.trim().replace(/^this\./, ''))
      .filter(Boolean);
    const indexes = new Set(names.flatMap((n, i) => (TEXTISH.has(n) ? [i] : [])));
    if (indexes.size && !POSITIONAL.has(m[1]!)) POSITIONAL.set(m[1]!, indexes);
  }
}

const keys = new Set<string>();
const reports: string[] = [];
let changed = 0;

for (const file of walk(root)) {
  const src = fs.readFileSync(file, 'utf8');
  const { code, literals } = lex(src);
  const lineOf = (i: number) => src.slice(0, i).split('\n').length;
  const isCode = (i: number) => code[i] === 1;

  /** Scan back from `i` to the start of the argument / element it is in. */
  const argumentStart = (i: number) => {
    let depth = 0;
    for (let k = i - 1; k >= 0; k--) {
      if (!isCode(k)) continue;
      const c = src[k]!;
      if (')]}'.includes(c)) depth++;
      else if ('([{'.includes(c)) {
        if (depth === 0) return { at: k + 1, opener: k };
        depth--;
      } else if (depth === 0 && (c === ',' || c === ';')) return { at: k + 1, opener: -1, sep: k };
      else if (depth === 0 && c === '>' && src[k - 1] === '=') return { at: k + 1, opener: -2 };
      else if (depth === 0 && c === '=' && !'=!<>'.includes(src[k - 1]!) && src[k + 1] !== '=')
        return { at: k + 1, opener: -2 };
    }
    return { at: 0, opener: -2 };
  };

  /** The unmatched opener before `i`. */
  const openerBefore = (i: number) => {
    let depth = 0;
    for (let k = i - 1; k >= 0; k--) {
      if (!isCode(k)) continue;
      const c = src[k]!;
      if (')]}'.includes(c)) depth++;
      else if ('([{'.includes(c)) {
        if (depth === 0) return k;
        depth--;
      }
    }
    return -1;
  };

  const withoutComments = (from: number, to: number) => {
    let s = '';
    for (let k = from; k < to; k++) s += isCode(k) ? src[k] : ' ';
    return s;
  };

  /** Split the arguments of the call opened at `opener` (index of `(`). */
  const argumentsOf = (opener: number) => {
    const args: { start: number; end: number }[] = [];
    let depth = 0;
    let from = opener + 1;
    for (let k = opener + 1; k < src.length; k++) {
      if (!isCode(k)) continue;
      const c = src[k]!;
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) {
        if (depth === 0) {
          args.push({ start: from, end: k });
          break;
        }
        depth--;
      } else if (c === ',' && depth === 0) {
        args.push({ start: from, end: k });
        from = k + 1;
      }
    }
    return args;
  };

  const calleeBefore = (opener: number) => {
    const before = withoutComments(Math.max(0, opener - 200), opener);
    const m = /((?:[A-Za-z_]\w*\.)*[A-Za-z_]\w*)\s*(?:<[^()]*>)?\s*$/.exec(before);
    return m ? m[1]!.split('.').pop()! : '';
  };

  const edits: { start: number; end: number; text: string }[] = [];
  const consts = new Set<number>(); // index of a `const` keyword to drop
  const finals = new Set<number>(); // `const` of a local declaration to turn into `final`

  for (const lit of literals) {
    if (lit.raw || lit.triple) continue;
    const { at, opener: first } = argumentStart(lit.start);
    const prefix = withoutComments(at, lit.start);
    const named = /^\s*(\w+)\s*:\s*([\s\S]*)$/.exec(prefix);
    const rest = (named ? named[2]! : prefix).trim();
    if (rest && !/(\?|\?\?|:)$/.test(rest)) continue;
    if (rest && /[=!<>]=\s*$|\bcase\b/.test(rest)) continue;
    const opener = first >= 0 ? first : openerBefore(at);
    let display = false;
    if (valueMode) {
      // A switch pattern or a map key is not text; neither is a comparison.
      const after = withoutComments(lit.end, Math.min(src.length, lit.end + 4)).trimStart();
      if (after.startsWith('=>') || after.startsWith(':') || after.startsWith('==') || after.startsWith('!='))
        continue;
      const tail = (named ? '' : prefix).replace(/^\s*return\b/, '').trim();
      const assigned =
        first === -2 || /^\s*return\b/.test(prefix) || (first === -1 && /;\s*$/.test(withoutComments(0, at)));
      if (named || !assigned || (tail && !/(\?|\?\?|:)$/.test(tail)) || /'\s*:$/.test(tail)) continue;
      const plain = lit.parts.map((p) => (p.kind === 'text' ? p.value : '{}')).join('');
      if (!/^[A-Z][a-z]/.test(plain.trim()) && !/\p{L}+\s+\p{L}+/u.test(plain)) continue;
      if (/^[^\s]*\/[^\s]*$/.test(plain) || /^(Bearer|Basic)\b/.test(plain)) continue;
      display = true;
    } else if (opener < 0 || src[opener] !== '(') continue;
    const callee = opener >= 0 ? calleeBefore(opener) : '';
    if (valueMode) {
      /* decided above */
    } else if (named) display = NAMED.has(named[1]!);
    else {
      const indexes = POSITIONAL.get(callee);
      if (indexes) {
        const args = argumentsOf(opener);
        const mine = args.findIndex((a) => a.start <= lit.start && lit.end <= a.end);
        const positionalIndex = args
          .slice(0, mine)
          .filter((a) => !/^\s*\w+\s*:(?!:)/.test(withoutComments(a.start, a.end))).length;
        display = mine >= 0 && indexes.has(positionalIndex);
      }
    }
    if (!display) continue;

    let key = '';
    const values: string[] = [];
    for (const p of lit.parts) {
      if (p.kind === 'text') key += p.value;
      else {
        key += `{${values.length}}`;
        values.push(p.value.trim());
      }
    }
    const words = key.replace(/\{\d+\}/g, '');
    if (!/\p{L}/u.test(words)) continue;
    if (/^[a-z0-9_.-]+$/.test(key) && /[_.]/.test(key)) continue; // a code
    if (/^(https?:|\/|@|#|mailto:)/.test(key)) continue;
    if (/^[A-Z0-9 ]{1,6}$/.test(key) && !/\s/.test(key.trim())) continue; // tickers, codes

    // Walk out: drop `const` above the text; text in constants outside functions is reported.
    let inFunction = false;
    const drops: number[] = [];
    let k = lit.start;
    for (;;) {
      const o = openerBefore(k);
      if (o < 0) break;
      const before = withoutComments(Math.max(0, o - 300), o);
      if (src[o] === '{') {
        if (/(\)|\basync\*?|\bsync\*|\belse|\btry|\bfinally|\bdo|\bget\s+\w+)\s*$/.test(before)) {
          inFunction = true;
          // A local `const x = […]` becomes `final`.
          const stmt = withoutComments(o + 1, lit.start);
          const semi = Math.max(stmt.lastIndexOf(';'), stmt.lastIndexOf('{'), stmt.lastIndexOf('}'));
          const decl = /^\s*const\s/.exec(stmt.slice(semi + 1));
          if (decl) finals.add(o + 1 + semi + 1 + decl[0].indexOf('const'));
          break;
        }
        if (/\b(class|extension|mixin|enum)\b[^{;]*$/.test(before)) break;
      }
      const m =
        src[o] === '('
          ? /\bconst\s+(?:(?:[A-Za-z_]\w*\.)*[A-Za-z_]\w*)\s*(?:<[^()]*>)?\s*$/.exec(before)
          : /\bconst\s*(?:<[^()]*>)?\s*$/.exec(before);
      if (m) drops.push(Math.max(0, o - 300) + m.index);
      k = o;
    }
    // Arrow functions (=> …) are code too.
    if (!inFunction) {
      const before = withoutComments(0, lit.start);
      if (
        /=>[^;]*$/.test(before.slice(before.lastIndexOf(';') + 1)) &&
        /\)\s*=>/.test(before.slice(before.lastIndexOf(';') + 1))
      )
        inFunction = true;
    }
    if (!inFunction) {
      reports.push(`${path.relative(root, file)}:${lineOf(lit.start)}: ${key}`);
      continue;
    }
    drops.forEach((d) => consts.add(d));
    keys.add(key);
    const call = values.length
      ? `tr(${dartLiteral(key)}, [${values.join(', ')}])`
      : `tr(${dartLiteral(key)})`;
    edits.push({ start: lit.start, end: lit.end, text: call });
  }
  if (!edits.length) continue;

  // A local `const x = [...]` whose `const` was dropped as a collection keyword stays valid only as final.
  const all = [
    ...edits,
    ...[...consts]
      .filter((c) => !finals.has(c))
      .map((c) => ({ start: c, end: c + 'const'.length + (/\s/.test(src[c + 5]!) ? 1 : 0), text: '' })),
    ...[...finals].map((c) => ({ start: c, end: c + 'const'.length, text: 'final' })),
  ].sort((a, b) => b.start - a.start);
  let out = src;
  let lastStart = Infinity;
  for (const e of all) {
    if (e.end > lastStart) continue;
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    lastStart = e.start;
  }
  const rel = path.relative(path.dirname(file), path.join(root, 'i18n', 'i18n.dart')).replace(/\\/g, '/');
  const importLine = `import '${rel.startsWith('.') ? rel : rel}';`;
  if (!out.includes(importLine) && !file.endsWith(path.join('i18n', 'i18n.dart'))) {
    const imports = [...out.matchAll(/^import [^;]+;$/gm)];
    const last = imports[imports.length - 1];
    const at = last ? last.index! + last[0].length : 0;
    out = `${out.slice(0, at)}\n${importLine}${out.slice(at)}`;
  }
  changed++;
  if (!dry) fs.writeFileSync(file, out);
  console.log(`${path.relative(root, file)}: ${edits.length}`);
}

console.log(`${dry ? 'Would change' : 'Changed'} ${changed} files, ${keys.size} strings.`);
if (reports.length) console.log(`Text in constants (translate where it is shown):\n${reports.join('\n')}`);
