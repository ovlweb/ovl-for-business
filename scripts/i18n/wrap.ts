/**
 * Codemod: wrap user-facing text of a React project in t() so it can be translated.
 *
 *   pnpm --dir server exec tsx ../scripts/i18n/wrap.ts ../clients/web [--dry]
 *
 * - JSX text becomes {t('…')}. A run of text and values ({x} typed string | number) becomes one
 *   sentence with placeholders: {t('You hold {0} shares', holding.shares)}.
 * - Text props (label, placeholder, title, subtitle, hint, aria-label, description, alt) and
 *   `label` / `title` / `hint` / `description` / `placeholder` in object literals inside components.
 * - toast.success / toast.error / confirm arguments, including template literals with simple values.
 * - Shared label maps (ROLE_LABELS[x]…) where they are shown.
 * The type checker keeps React nodes and booleans out of translated strings; edits are applied to
 * the original text so formatting and comments stay.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(process.argv[2] ?? '.');
const dry = process.argv.includes('--dry');
const insideUiKit = root.endsWith(path.join('packages', 'ui'));

const TEXT_ATTRS = new Set([
  'placeholder',
  'title',
  'label',
  'subtitle',
  'hint',
  'aria-label',
  'description',
  'alt',
]);
const TEXT_PROPS = new Set(['label', 'title', 'hint', 'description', 'placeholder', 'subtitle']);
const CALLS = new Set(['toast.success', 'toast.error', 'toast.info', 'confirm', 'window.confirm']);

interface Edit {
  start: number;
  end: number;
  text: string;
}

const letters = (s: string) => /\p{L}/u.test(s);
const lit = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** What JSX renders for a text child (Babel's whitespace rules). */
function cleanJsxText(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/);
  let lastNonEmpty = -1;
  lines.forEach((l, i) => {
    if (/[^ \t]/.test(l)) lastNonEmpty = i;
  });
  let out = '';
  lines.forEach((line, i) => {
    let s = line.replace(/\t/g, ' ');
    if (i !== 0) s = s.replace(/^ +/, '');
    if (i !== lines.length - 1) s = s.replace(/ +$/, '');
    if (s) out += i === lastNonEmpty ? s : `${s} `;
  });
  return out;
}

const configPath = path.join(root, 'tsconfig.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();

/** A value that prints sensibly inside a sentence: its type is only strings and numbers. */
function printable(expr: ts.Expression): boolean {
  let hasJsx = false;
  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) hasJsx = true;
    else ts.forEachChild(n, visit);
  };
  visit(expr);
  if (hasJsx) return false;
  const type = checker.getTypeAtLocation(expr);
  const parts = type.isUnion() ? type.types : [type];
  return parts.every((p) => (p.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike)) !== 0);
}

function insideT(node: ts.Node): boolean {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 't') return true;
  }
  return false;
}

function insideFunction(node: ts.Node): boolean {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isFunctionLike(n)) return true;
  }
  return false;
}

/** `Take "${r.title}" down?` → t('Take "{0}" down?', r.title), when every value is printable. */
function templateCall(tpl: ts.TemplateExpression, source: ts.SourceFile): string | null {
  let key = tpl.head.text;
  const args: string[] = [];
  for (const span of tpl.templateSpans) {
    if (!printable(span.expression)) return null;
    key += `{${args.length}}${span.literal.text}`;
    args.push(span.expression.getText(source));
  }
  return letters(key) ? `t(${[lit(key), ...args].join(', ')})` : null;
}

/** t('Text') for a string; spaces around the text stay outside the key: ` ${t('by {0}', x)}`. */
function padded(key: string, args: string[]): string {
  const core = key.trim();
  const call = `t(${[lit(core), ...args].join(', ')})`;
  if (core === key) return call;
  const lead = key.slice(0, key.indexOf(core));
  const trail = key.slice(key.indexOf(core) + core.length);
  return `\`${lead}\${${call}}${trail}\``;
}

/**
 * Whether a string is shown: it ends up, through `a ? 'x' : 'y'`, `a && 'x'` or `a ?? 'x'`, as a
 * JSX child, a text attribute or the message of a toast / confirm.
 */
function displayed(node: ts.Node, source: ts.SourceFile): boolean {
  let n: ts.Node = node;
  for (;;) {
    const p = n.parent;
    if (!p) return false;
    const logical =
      ts.isBinaryExpression(p) &&
      p.right === n &&
      [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(p.operatorToken.kind);
    if (ts.isParenthesizedExpression(p) || (ts.isConditionalExpression(p) && p.condition !== n) || logical) {
      n = p;
      continue;
    }
    if (ts.isJsxExpression(p))
      return !ts.isJsxAttribute(p.parent) || TEXT_ATTRS.has(p.parent.name.getText(source));
    if (ts.isCallExpression(p) && p.arguments[0] === n) return CALLS.has(p.expression.getText(source));
    return false;
  }
}

const keys = new Set<string>();
let filesChanged = 0;
const collisions: string[] = [];

for (const file of program.getSourceFiles()) {
  if (
    !file.fileName.startsWith(root) ||
    !file.fileName.endsWith('.tsx') ||
    file.fileName.includes('node_modules')
  )
    continue;
  const edits: Edit[] = [];
  const text = file.getFullText();

  const wrapChildren = (children: ts.NodeArray<ts.JsxChild>) => {
    // Runs of text and values between elements become one sentence each.
    let run: ts.JsxChild[] = [];
    const flush = (before: ts.JsxChild | undefined, after: ts.JsxChild | undefined) => {
      const items = run;
      run = [];
      if (!items.some((c) => ts.isJsxText(c) && letters(c.text))) return;
      const simple = items.every(
        (c) =>
          ts.isJsxText(c) ||
          (ts.isJsxExpression(c) &&
            (!c.expression || ts.isStringLiteral(c.expression) || printable(c.expression))),
      );
      if (!simple) {
        // Values we cannot put in a sentence: translate the text pieces on their own.
        for (const c of items) {
          if (!ts.isJsxText(c) || !letters(c.text)) continue;
          const clean = cleanJsxText(c.text);
          const core = clean.trim();
          keys.add(core);
          const lead = clean.startsWith(' ') ? "{' '}" : '';
          const trail = clean.endsWith(' ') ? "{' '}" : '';
          edits.push({ start: c.pos, end: c.end, text: `${lead}{t(${lit(core)})}${trail}` });
        }
        return;
      }
      let key = '';
      const args: string[] = [];
      for (const c of items) {
        if (ts.isJsxText(c)) key += cleanJsxText(c.text);
        else if (ts.isJsxExpression(c) && c.expression) {
          if (ts.isStringLiteral(c.expression)) key += c.expression.text;
          else {
            key += `{${args.length}}`;
            args.push(c.expression.getText(file));
          }
        }
      }
      const core = key.trim();
      if (!letters(core)) return;
      keys.add(core);
      const lead = before && key.startsWith(' ') ? "{' '}" : '';
      const trail = after && key.endsWith(' ') ? "{' '}" : '';
      const first = items[0]!;
      const last = items[items.length - 1]!;
      edits.push({
        start: ts.isJsxText(first) ? first.pos : first.getStart(file),
        end: last.end,
        text: `${lead}{t(${[lit(core), ...args].join(', ')})}${trail}`,
      });
    };
    let previousElement: ts.JsxChild | undefined;
    for (const child of children) {
      if (ts.isJsxExpression(child) && !child.expression) {
        // A {/* comment */}: keep it, and do not join the text around it.
        flush(previousElement, undefined);
        continue;
      }
      if (ts.isJsxText(child) || ts.isJsxExpression(child)) run.push(child);
      else {
        flush(previousElement, child);
        previousElement = child;
      }
    }
    flush(previousElement, undefined);
  };

  const visit = (node: ts.Node) => {
    if ((ts.isJsxElement(node) || ts.isJsxFragment(node)) && !insideT(node)) wrapChildren(node.children);

    if (ts.isJsxAttribute(node) && TEXT_ATTRS.has(node.name.getText(file)) && node.initializer) {
      const init = node.initializer;
      if (ts.isStringLiteral(init) && letters(init.text)) {
        keys.add(init.text);
        edits.push({ start: init.getStart(file), end: init.end, text: `{t(${lit(init.text)})}` });
      } else if (ts.isJsxExpression(init) && init.expression && ts.isTemplateExpression(init.expression)) {
        const call = templateCall(init.expression, file);
        if (call) {
          keys.add(call);
          edits.push({ start: init.expression.getStart(file), end: init.expression.end, text: call });
        }
      }
    }

    if (
      ts.isPropertyAssignment(node) &&
      TEXT_PROPS.has(node.name.getText(file)) &&
      ts.isStringLiteral(node.initializer) &&
      letters(node.initializer.text) &&
      insideFunction(node) &&
      !insideT(node)
    ) {
      keys.add(node.initializer.text);
      edits.push({
        start: node.initializer.getStart(file),
        end: node.initializer.end,
        text: `t(${lit(node.initializer.text)})`,
      });
    }

    if (ts.isCallExpression(node) && CALLS.has(node.expression.getText(file)) && node.arguments[0]) {
      const arg = node.arguments[0];
      if (ts.isStringLiteral(arg) && letters(arg.text)) {
        keys.add(arg.text);
        edits.push({ start: arg.getStart(file), end: arg.end, text: `t(${lit(arg.text)})` });
      } else if (ts.isTemplateExpression(arg)) {
        const call = templateCall(arg, file);
        if (call) edits.push({ start: arg.getStart(file), end: arg.end, text: call });
      }
    }

    // Text chosen by a condition: {done ? 'Paid' : 'Due'}, {x && ` by ${name}`}.
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateExpression(node)) &&
      !insideT(node) &&
      !ts.isJsxAttribute(node.parent) &&
      displayed(node, file)
    ) {
      if (ts.isTemplateExpression(node)) {
        let key = node.head.text;
        const args: string[] = [];
        let ok = true;
        for (const span of node.templateSpans) {
          if (!printable(span.expression)) ok = false;
          key += `{${args.length}}${span.literal.text}`;
          args.push(span.expression.getText(file));
        }
        if (ok && letters(key.replace(/\{\d+\}/g, ''))) {
          keys.add(key.trim());
          edits.push({ start: node.getStart(file), end: node.end, text: padded(key, args) });
        }
      } else if (letters(node.text)) {
        keys.add(node.text.trim());
        edits.push({ start: node.getStart(file), end: node.end, text: padded(node.text, []) });
      }
    }

    // item.label where `label` is static text: a string literal in an object (nav items, routes,
    // shared workflow stages) or a field of an interface declared in this project.
    if (
      ts.isPropertyAccessExpression(node) &&
      TEXT_PROPS.has(node.name.text) &&
      !insideT(node) &&
      (ts.isTemplateSpan(node.parent) ||
        (ts.isJsxExpression(node.parent) &&
          (!ts.isJsxAttribute(node.parent.parent) || TEXT_ATTRS.has(node.parent.parent.name.getText(file)))))
    ) {
      const symbol = checker.getSymbolAtLocation(node.name);
      const declarations = symbol?.declarations ?? [];
      const staticText = declarations.some(
        (d) =>
          (ts.isPropertyAssignment(d) && ts.isStringLiteral(d.initializer) && letters(d.initializer.text)) ||
          (ts.isPropertySignature(d) &&
            (d.getSourceFile().fileName.startsWith(root) ||
              d.getSourceFile().fileName.endsWith('workflows.ts'))),
      );
      if (staticText && printable(node))
        edits.push({ start: node.getStart(file), end: node.end, text: `t(${node.getText(file)})` });
    }

    // ROLE_LABELS[role] and friends, where they are shown.
    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      /_LABELS$/.test(node.expression.text) &&
      !insideT(node) &&
      insideFunction(node) &&
      (ts.isJsxExpression(node.parent) || ts.isTemplateSpan(node.parent))
    ) {
      edits.push({ start: node.getStart(file), end: node.end, text: `t(${node.getText(file)})` });
    }

    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!edits.length) continue;

  // A local named `t` would hide the function.
  const shadow = (n: ts.Node) => {
    if (
      (ts.isParameter(n) || ts.isVariableDeclaration(n) || ts.isBindingElement(n)) &&
      ts.isIdentifier(n.name) &&
      n.name.text === 't'
    )
      collisions.push(
        `${path.relative(root, file.fileName)}:${file.getLineAndCharacterOfPosition(n.getStart(file)).line + 1}`,
      );
    ts.forEachChild(n, shadow);
  };
  shadow(file);

  // Outermost edits win (a sentence already contains the smaller pieces).
  edits.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Edit[] = [];
  for (const e of edits) {
    const last = kept[kept.length - 1];
    if (last && e.start < last.end) continue;
    kept.push(e);
  }
  let out = text;
  for (const e of [...kept].reverse()) out = out.slice(0, e.start) + e.text + out.slice(e.end);

  // Import t.
  const from = insideUiKit
    ? `./${path
        .relative(path.dirname(file.fileName), path.join(root, 'src', 'i18n'))
        .replace(/\\/g, '/')
        .replace(/^\.\//, '')}`
    : '@ovl/ui';
  const importRe = new RegExp(`import \\{([^}]*)\\} from '${from.replace(/[./]/g, (c) => `\\${c}`)}';`);
  const existing = importRe.exec(out);
  if (existing) {
    const names = existing[1]!
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!names.includes('t'))
      out = out.replace(importRe, `import { ${[...names, 't'].join(', ')} } from '${from}';`);
  } else {
    const lastImport = [...out.matchAll(/^import [^;]+;$/gm)].pop();
    const at = lastImport ? lastImport.index! + lastImport[0].length : 0;
    out = `${out.slice(0, at)}\nimport { t } from '${from}';${out.slice(at)}`;
  }
  filesChanged++;
  if (!dry) fs.writeFileSync(file.fileName, out);
}

console.log(`${dry ? 'Would change' : 'Changed'} ${filesChanged} files, ${keys.size} strings.`);
if (collisions.length) console.log(`Locals named t (rename them): ${collisions.join(', ')}`);
