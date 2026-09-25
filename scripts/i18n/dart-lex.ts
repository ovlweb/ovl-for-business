/** A small Dart lexer for the i18n scripts: string literals (with interpolations) and which characters are code. */
import fs from 'node:fs';
import path from 'node:path';

export interface Part {
  kind: 'text' | 'expr';
  value: string; // decoded text, or the expression's source
}
export interface Literal {
  start: number;
  end: number;
  raw: boolean;
  triple: boolean;
  parts: Part[];
}

/** Lex a Dart file: its string literals (top level of the code) and which characters are code. */
export function lex(src: string) {
  const code = new Uint8Array(src.length).fill(1);
  const literals: Literal[] = [];
  const decode = (s: string) =>
    s.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/gs, (_, e: string) => {
      if (e.startsWith('u{')) return String.fromCodePoint(parseInt(e.slice(2, -1), 16));
      if (e.startsWith('u') && e.length === 5) return String.fromCharCode(parseInt(e.slice(1), 16));
      if (e.startsWith('x') && e.length === 3) return String.fromCharCode(parseInt(e.slice(1), 16));
      return { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v' }[e] ?? e;
    });

  // Returns the index after the literal starting at i (at the quote, after an optional r).
  const string = (i: number, depth: number): number => {
    const start = i;
    let raw = false;
    if (src[i] === 'r') {
      raw = true;
      i++;
    }
    const q = src[i]!;
    const triple = src.startsWith(q.repeat(3), i);
    const close = triple ? q.repeat(3) : q;
    i += close.length;
    const parts: Part[] = [];
    let text = '';
    let textFrom = i;
    const flush = (to: number) => {
      text += src.slice(textFrom, to);
      if (text) parts.push({ kind: 'text', value: raw ? text : decode(text) });
      text = '';
    };
    while (i < src.length && !src.startsWith(close, i)) {
      if (!raw && src[i] === '\\') {
        code[i] = 0;
        code[i + 1] = 0;
        i += 2;
        continue;
      }
      if (!raw && src[i] === '$') {
        if (src[i + 1] === '{') {
          flush(i);
          code[i] = 0;
          const exprStart = i + 2;
          const exprEnd = codeUntilBrace(exprStart, depth + 1);
          parts.push({ kind: 'expr', value: src.slice(exprStart, exprEnd) });
          i = exprEnd + 1;
          textFrom = i;
          continue;
        }
        const m = /^[A-Za-z_]\w*/.exec(src.slice(i + 1));
        if (m) {
          flush(i);
          parts.push({ kind: 'expr', value: m[0] });
          for (let k = i; k <= i + m[0].length; k++) code[k] = 0;
          i += 1 + m[0].length;
          textFrom = i;
          continue;
        }
      }
      code[i] = 0;
      i++;
    }
    flush(i);
    const end = i + close.length;
    for (let k = start; k < end; k++) if (k < start + (raw ? 1 : 0) + close.length || k >= i) code[k] = 0;
    if (depth === 0) literals.push({ start, end, raw, triple, parts });
    return end;
  };

  // Code until the matching `}` (for ${…}); returns the index of that brace.
  const codeUntilBrace = (i: number, depth: number): number => {
    let braces = 0;
    while (i < src.length) {
      const c = src[i]!;
      if (c === '/' && src[i + 1] === '/') {
        while (i < src.length && src[i] !== '\n') code[i++] = 0;
        continue;
      }
      if (c === '/' && src[i + 1] === '*') {
        const close = src.indexOf('*/', i + 2);
        const stop = close < 0 ? src.length : close + 2;
        while (i < stop) code[i++] = 0;
        continue;
      }
      if (
        c === "'" ||
        c === '"' ||
        (c === 'r' && (src[i + 1] === "'" || src[i + 1] === '"') && !/\w/.test(src[i - 1] ?? ''))
      ) {
        i = string(i, depth);
        continue;
      }
      if (c === '{') braces++;
      if (c === '}') {
        if (braces === 0 && depth > 0) return i;
        braces--;
      }
      i++;
    }
    return i;
  };
  codeUntilBrace(0, 0);

  // Adjacent literals ('a' 'b') are one string.
  const groups: Literal[] = [];
  for (const l of literals) {
    const last = groups[groups.length - 1];
    if (last && /^\s*$/.test(src.slice(last.end, l.start)) && !last.raw && !l.raw) {
      groups[groups.length - 1] = {
        ...last,
        end: l.end,
        triple: last.triple || l.triple,
        parts: [...last.parts, ...l.parts],
      };
    } else groups.push(l);
  }
  return { code, literals: groups };
}

/** Dart sources under a folder (generated files left out). */
export const dartFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return dartFiles(full);
    return e.name.endsWith('.dart') && !e.name.endsWith('.g.dart') ? [full] : [];
  });
