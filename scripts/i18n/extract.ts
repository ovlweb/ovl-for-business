/**
 * List every text the apps and the server translate, into scripts/i18n/keys.json (`pnpm i18n` runs
 * this and then build-catalog.ts).
 *
 * - Web client, admin panel, UI kit: t('…') and msg('…'), static labels ({ label: 'Profile' }),
 *   plural() nouns.
 * - Server: error messages (badRequest('…'), conflict(text`… ${x}`)…, notFound('Invoice') →
 *   "Invoice not found"), text`…` templates, say(locale, '…'), and the plain strings of
 *   notifications and emails.
 * - Shared: labels (roles, licence types, workflows, statuses), validation messages, the risk
 *   disclosure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as shared from '../../packages/shared/src/index';
import { dartFiles, lex } from './dart-lex';

process.chdir(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));

const clientRoots = ['clients/web/src', 'admin/src', 'packages/ui/src'];
const serverRoots = ['server/src'];
const keys = new Set<string>();
const LABEL_PROPS = new Set([
  'label',
  'title',
  'hint',
  'description',
  'placeholder',
  'subtitle',
  'text',
  'cta',
  'group',
]);
const ERROR_HELPERS = new Set(['badRequest', 'unauthorized', 'forbidden', 'conflict', 'insufficientFunds']);
const MESSAGE_PROPS = new Set(['title', 'body', 'subject', 'greeting', 'footer', 'label', 'lines']);

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'locales' ? [] : walk(full);
    return /\.(tsx?|ts)$/.test(e.name) ? [full] : [];
  });

const isText = (n: ts.Node): n is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
  ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n);
const callee = (n: ts.CallExpression | ts.NewExpression) =>
  ts.isIdentifier(n.expression)
    ? n.expression.text
    : ts.isPropertyAccessExpression(n.expression)
      ? n.expression.name.text
      : '';

/** text`Pay from a ${currency} balance` → "Pay from a {0} balance". */
function templateKey(tpl: ts.TemplateLiteral): string {
  if (ts.isNoSubstitutionTemplateLiteral(tpl)) return tpl.text;
  return tpl.templateSpans.reduce((key, span, i) => `${key}{${i}}${span.literal.text}`, tpl.head.text);
}

/** Strings a value can be: 'a', cond ? 'a' : 'b', text`…`. */
function texts(n: ts.Node): string[] {
  if (isText(n)) return [n.text];
  if (ts.isTaggedTemplateExpression(n) && n.tag.getText() === 'text') return [templateKey(n.template)];
  if (ts.isConditionalExpression(n)) return [...texts(n.whenTrue), ...texts(n.whenFalse)];
  if (ts.isParenthesizedExpression(n)) return texts(n.expression);
  if (ts.isArrayLiteralExpression(n)) return n.elements.flatMap(texts);
  return [];
}

for (const file of clientRoots.flatMap(walk)) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ['t', 'msg'].includes(callee(node)) &&
      node.arguments[0] &&
      isText(node.arguments[0])
    )
      keys.add(node.arguments[0].text);
    // Tables of labels defined outside components ({ label: 'Profile', hint: '…' }), shown through t().
    if (
      ts.isPropertyAssignment(node) &&
      LABEL_PROPS.has(node.name.getText(source)) &&
      ts.isStringLiteral(node.initializer) &&
      /^\p{Lu}/u.test(node.initializer.text)
    )
      keys.add(node.initializer.text);
    // plural(n, 'member'): the noun's forms are looked up by its English singular.
    if (
      ts.isCallExpression(node) &&
      callee(node) === 'plural' &&
      node.arguments[1] &&
      ts.isStringLiteral(node.arguments[1])
    )
      keys.add(`plural:${node.arguments[1].text}`);
    ts.forEachChild(node, visit);
  };
  visit(source);
}

for (const file of serverRoots.flatMap(walk)) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node, inMessage: boolean) => {
    if (ts.isTaggedTemplateExpression(node) && node.tag.getText(source) === 'text')
      keys.add(templateKey(node.template));
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const name = callee(node);
      const args = node.arguments ?? ts.factory.createNodeArray();
      if (ERROR_HELPERS.has(name) && args[0]) texts(args[0]).forEach((k) => keys.add(k));
      if (name === 'HttpError' && args[2]) texts(args[2]).forEach((k) => keys.add(k));
      if (name === 'notFound')
        keys.add(`${args[0] && isText(args[0]) ? args[0].text : 'Resource'} not found`);
      if ((name === 'say' && args[1]) || (name === 'msg' && args[0]))
        texts(name === 'say' ? args[1]! : args[0]!).forEach((k) => keys.add(k));
      if (name === 'queueNotification' || name === 'actionEmail') {
        ts.forEachChild(node, (child) => visit(child, true));
        return;
      }
    }
    // title / body of a notification, subject / lines / footer of an email.
    if (inMessage && ts.isPropertyAssignment(node) && MESSAGE_PROPS.has(node.name.getText(source)))
      texts(node.initializer).forEach((k) => keys.add(k));
    // Defaults of the error helpers: unauthorized(message = 'Authentication required').
    if (file.endsWith(path.join('lib', 'errors.ts')) && ts.isParameter(node) && node.initializer)
      texts(node.initializer).forEach((k) => keys.add(k));
    ts.forEachChild(node, (child) => visit(child, inMessage));
  };
  visit(source, false);
}

// The native apps: tr('…') and plural() in Dart, and the text in their label tables (shown through tr()).
const NOT_TEXT = new Set(['Inter', 'Manrope', 'Bearer', 'OVL For Business']);
for (const file of dartFiles('clients/app/lib')) {
  const src = fs.readFileSync(file, 'utf8');
  const { code, literals } = lex(src);
  const before = (i: number) => {
    let s = '';
    for (let k = i - 1; k >= 0 && s.length < 40; k--) if (code[k]) s = src[k] + s;
    return s;
  };
  const after = (i: number) => {
    let s = '';
    for (let k = i; k < src.length && s.length < 4; k++) if (code[k] && !/\s/.test(src[k]!)) s += src[k];
    return s;
  };
  // plural(n, 'noun') anywhere, also inside ${…}.
  for (const m of src.matchAll(/\bplural\([^;']*,\s*'([^']+)'/g)) keys.add(`plural:${m[1]}`);
  for (const lit of literals) {
    if (lit.raw) continue;
    let key = '';
    let n = 0;
    for (const p of lit.parts) key += p.kind === 'text' ? p.value : `{${n++}}`;
    const prev = before(lit.start);
    if (/\b(tr|msg)\(\s*$/.test(prev)) keys.add(key);
    else if (/\bplural\([^()]*,\s*$/.test(prev)) keys.add(`plural:${key}`);
    else if (
      n === 0 &&
      /^\p{Lu}\p{Ll}/u.test(key) &&
      !NOT_TEXT.has(key) &&
      !/^(:|=>|==|!=)/.test(after(lit.end)) &&
      !/(==|!=|case|import|export|part)\s*$/.test(prev)
    )
      keys.add(key);
  }
}

// Validation messages of the shared schemas and money parsing, shown next to the field.
for (const file of walk('packages/shared/src')) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const name = callee(node);
      const args = node.arguments ?? ts.factory.createNodeArray();
      if (['min', 'max', 'length', 'regex', 'refine', 'email', 'url'].includes(name))
        for (const arg of args) if (isText(arg)) keys.add(arg.text);
      if (name === 'MoneyError' && args[0] && isText(args[0])) keys.add(args[0].text);
    }
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'message' && isText(node.initializer))
      keys.add(node.initializer.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
}

const humanize = (key: string) =>
  key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());

for (const [name, value] of Object.entries(shared)) {
  if (name.endsWith('_LABELS') && value && typeof value === 'object')
    for (const label of Object.values(value)) if (typeof label === 'string') keys.add(label);
  if (/_(STATUSES|KINDS|TYPES|METHODS)$/.test(name) && Array.isArray(value))
    for (const item of value) if (typeof item === 'string') keys.add(humanize(item));
}
for (const workflow of Object.values(shared.WORKFLOWS)) {
  keys.add(workflow.label);
  for (const stage of workflow.stages) {
    keys.add(stage.label);
    if (stage.description) keys.add(stage.description);
    for (const item of stage.checklist ?? []) keys.add(item.label);
  }
}
for (const point of [shared.RISK_DISCLOSURE.title, ...shared.RISK_DISCLOSURE.points]) keys.add(point);
// Theme names are names (Daylight, Midnight); their descriptions are text.
for (const theme of shared.THEMES) keys.add(theme.description);

const sorted = [...keys].filter((k) => /\p{L}/u.test(k)).sort((a, b) => a.localeCompare(b));
fs.writeFileSync('scripts/i18n/keys.json', `${JSON.stringify(sorted, null, 2)}\n`);
console.log(`${sorted.length} texts to translate.`);
