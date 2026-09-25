/**
 * Rename a local (for example a `t` parameter that would hide the t() function):
 *   pnpm --dir server exec tsx ../scripts/i18n/rename.ts ../<project> <file>:<line>:<name> [...]
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(process.argv[2]!);
const config = ts.parseJsonConfigFileContent(
  ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile).config,
  ts.sys,
  root,
);
const versions = new Map<string, number>();
const host: ts.LanguageServiceHost = {
  getScriptFileNames: () => config.fileNames,
  getScriptVersion: (f) => String(versions.get(f) ?? 0),
  getScriptSnapshot: (f) =>
    fs.existsSync(f) ? ts.ScriptSnapshot.fromString(fs.readFileSync(f, 'utf8')) : undefined,
  getCurrentDirectory: () => root,
  getCompilationSettings: () => config.options,
  getDefaultLibFileName: ts.getDefaultLibFilePath,
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
};
const service = ts.createLanguageService(host);

for (const spec of process.argv.slice(3)) {
  const [file, line, name] = spec.split(':');
  const full = path.join(root, file!);
  const text = fs.readFileSync(full, 'utf8');
  const source = ts.createSourceFile(full, text, ts.ScriptTarget.Latest, true);
  const lineStart = source.getPositionOfLineAndCharacter(Number(line) - 1, 0);
  const lineText = text.slice(lineStart, text.indexOf('\n', lineStart));
  // The last `t` parameter on the line (`.filter((t) => …).map((t) => (` renames the map's).
  const matches = [...lineText.matchAll(/\(t\)|\(t,|, t\)/g)];
  const match = matches[matches.length - 1];
  if (!match) throw new Error(`No t parameter on ${spec}`);
  const at = lineStart + match.index! + match[0].indexOf('t');
  const locations =
    service.findRenameLocations(full, at, false, false, { providePrefixAndSuffixTextForRename: false }) ?? [];
  let out = text;
  for (const loc of [...locations].sort((a, b) => b.textSpan.start - a.textSpan.start)) {
    if (loc.fileName !== full) continue;
    out = out.slice(0, loc.textSpan.start) + name + out.slice(loc.textSpan.start + loc.textSpan.length);
  }
  fs.writeFileSync(full, out);
  versions.set(full, (versions.get(full) ?? 0) + 1);
  console.log(`${spec}: ${locations.length} places`);
}
