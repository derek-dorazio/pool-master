/**
 * No export that nothing uses, and none that only tests use (#2111; `rules/testing-rules.md` §1B
 * *Forbidden Application-Code Patterns*).
 *
 * `no-unused-vars` catches a dead local and the coverage floors catch a dead branch, but neither
 * sees an export no other file reads. An export only a test reads is worse: it is a test-only
 * path in production source. This check reads every production file in `packages/core-api/src`,
 * `clients/poolmaster/src` and `packages/shared` (generated clients, tests, stories and test
 * folders left out) with the TypeScript parser, lists its exported names, and looks each name up
 * in every other source file in the repository:
 *
 * - **unused**: no file names it, its own included;
 * - **tests only**: its own file does not use it and only test, story, fixture or test-folder
 *   files name it, so it exists for the tests;
 * - **own file only**: its own file uses it and no other production file does, so it is alive
 *   and `export` only widens its surface (a test may read it too). A second, lower count per
 *   file.
 *
 * Types and interfaces are left out: they are erased and carry no path. Fixture files
 * (`…test-fixtures.ts`, `…test-context.tsx`, `…fixtures.ts`) count as tests.
 *
 * Uses are identifier tokens in code, read with the same parser: a name in a comment or a string
 * is not a use, and neither is an import or export list, so an `export { x } from` barrel line
 * keeps nothing alive. The lookup is by name, so an export shadowed by a same-named identifier
 * elsewhere is missed, never wrongly reported. An enum's order list (`…Order = explicitOrder(…)`
 * or `alphabeticalOrder(…)`) is exempt, since the enum-order rule requires one, and so is a
 * default export, which a framework or tool loads. A test hook that must stay takes
 * `// poolmaster-allow-test-export: <reason>` on the line before; the default is to delete it and
 * test through the public surface.
 *
 * `scripts/dead-exports.json` lists today's findings: `dead:<file>#<name>` for each unused or
 * tests-only export and `own:<file>` with the count of own-file-only exports. The check fails
 * both ways: a finding not listed (or a count above its entry) is new dead code; a listed one
 * that is gone must be dropped with `--update`, which only lowers. `rules:check:baseline-ratchet`
 * refuses a new or raised entry unless `scripts/baseline-raises.json` declares it.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

export const BASELINE_FILE = 'scripts/dead-exports.json';
const PRODUCTION_ROOTS = ['packages/core-api/src/', 'clients/poolmaster/src/', 'packages/shared/'];
const SOURCE = /\.(ts|tsx|mts|mjs|js|cjs)$/;
const NEVER_READ = /(^|\/)(node_modules|dist|generated)\//;
const TEST_LIKE = /(\.(test|spec|stories)\.[cm]?[jt]sx?$)|((^|\/)(__tests__|test|tests|e2e|fixtures)\/)|([/-]test-(fixtures?|context|helpers?)\.tsx?$)|([/-]fixtures?\.tsx?$)/;
const MARKER = /poolmaster-allow-test-export(?![\w-])\s*:\s*\S/;
const ORDER_BUILDERS = new Set(['explicitOrder', 'alphabeticalOrder']);

/** Production source: under a production root, not a test, story, test folder or generated client. */
export function isProduction(path) {
  return PRODUCTION_ROOTS.some((root) => path.startsWith(root)) && /\.tsx?$/.test(path) && !TEST_LIKE.test(path) && !NEVER_READ.test(path);
}

/** Whether a file that names an export counts as a test reading it. */
export function isTestLike(path) {
  return TEST_LIKE.test(path);
}

function hasModifier(node, kind) {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind);
}

function parse(path, text) {
  const kind = /\.tsx$/.test(path) ? ts.ScriptKind.TSX : /\.[cm]?jsx?$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
}

/** An enum's order list, which the enum-order rule requires: `…Order = explicitOrder<…>(…)` or `alphabeticalOrder(…)`. */
function isEnumOrderList(declaration) {
  let init = declaration.initializer;
  while (init && (ts.isAsExpression(init) || ts.isSatisfiesExpression(init))) init = init.expression;
  return Boolean(init && ts.isCallExpression(init) && ts.isIdentifier(init.expression) && ORDER_BUILDERS.has(init.expression.text));
}

function markedAsTestHook(sourceFile, node) {
  const leading = ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart()) ?? [];
  return leading.some((range) => MARKER.test(sourceFile.text.slice(range.pos, range.end)));
}

/** The names a production file exports, by declaration or by a local `export { … }`, minus the exempt ones. */
export function exportedNames(path, text) {
  const sourceFile = parse(path, text);
  const names = [];
  const add = (name, node) => {
    if (!name || markedAsTestHook(sourceFile, node)) return;
    names.push(name);
  };
  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.moduleSpecifier || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
      for (const element of statement.exportClause.elements) add(element.name.text, statement);
      continue;
    }
    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword) || hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && !isEnumOrderList(declaration)) add(declaration.name.text, statement);
      }
    } else if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
      continue;
    } else if ('name' in statement && statement.name && ts.isIdentifier(statement.name)) {
      add(statement.name.text, statement);
    }
  }
  return names;
}

/**
 * How many times each identifier token appears in a file's code. Comments and strings are not
 * code, so a name mentioned in either is not a use. Import and export lists are not uses either:
 * an `export { x } from './x'` barrel line, or an `import { x }` never read, keeps nothing alive;
 * the code that reads `x` does.
 */
export function identifierCounts(path, text) {
  const counts = new Map();
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isIdentifier(node)) counts.set(node.text, (counts.get(node.text) ?? 0) + 1);
    ts.forEachChild(node, visit);
  };
  visit(parse(path, text));
  return counts;
}

/**
 * The `[original, newName]` pairs a file's import and export lists rename: `import { a as b }`
 * and `export { a as b } from './x'`. Code that reads `b` is then a reader of `a`.
 */
export function renamedSpecifiers(path, text) {
  const pairs = [];
  for (const statement of parse(path, text).statements) {
    let elements = [];
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      elements = statement.exportClause.elements;
    } else if (ts.isImportDeclaration(statement)) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) elements = bindings.elements;
    }
    for (const element of elements) {
      if (element.propertyName && element.propertyName.text !== element.name.text) pairs.push([element.propertyName.text, element.name.text]);
    }
  }
  return pairs;
}

/**
 * Classifies each production export from the identifiers of every source file: `unused`,
 * `tests-only`, `own-file` or alive (left out).
 */
export function classifyExports(files) {
  const readers = new Map();
  for (const [path, { identifiers }] of files) {
    for (const word of identifiers.keys()) {
      if (!readers.has(word)) readers.set(word, []);
      readers.get(word).push(path);
    }
  }
  // A name passed on under a new one is read wherever the new name is (renames chain).
  const renames = [...files.values()].flatMap(({ renames: pairs }) => pairs ?? []);
  for (let changed = true; changed;) {
    changed = false;
    for (const [original, renamed] of renames) {
      const into = readers.get(original) ?? [];
      const added = (readers.get(renamed) ?? []).filter((reader) => !into.includes(reader));
      if (added.length === 0) continue;
      readers.set(original, [...into, ...added]);
      changed = true;
    }
  }
  const findings = [];
  for (const [path, { identifiers, exports }] of files) {
    for (const name of exports ?? []) {
      const others = (readers.get(name) ?? []).filter((reader) => reader !== path);
      if (others.some((reader) => !isTestLike(reader))) continue;
      const usedInOwnFile = (identifiers.get(name) ?? 0) > 1;
      if (usedInOwnFile) findings.push({ file: path, name, kind: 'own-file' });
      else if (others.length > 0) findings.push({ file: path, name, kind: 'tests-only' });
      else findings.push({ file: path, name, kind: 'unused' });
    }
  }
  return findings;
}

/** The baseline entries a list of findings implies: one per dead export, a count per file of own-file-only ones. */
export function entriesFor(findings) {
  const entries = {};
  for (const { file, name, kind } of findings) {
    const key = kind === 'own-file' ? `own:${file}` : `dead:${file}#${name}`;
    entries[key] = (entries[key] ?? 0) + 1;
  }
  return entries;
}

/** Entries above the baseline (new dead code) and below it (cleaned up, so lower the baseline). */
export function compareWithBaseline(current, baseline) {
  const over = [];
  const under = [];
  for (const key of new Set([...Object.keys(current), ...Object.keys(baseline)])) {
    const now = current[key] ?? 0;
    const allowed = baseline[key] ?? 0;
    if (now > allowed) over.push({ key, now, allowed });
    else if (now < allowed) under.push({ key, now, allowed });
  }
  return { over, under };
}

/** The baseline after cleanups: each entry lowered to today's count, entries at 0 dropped. Never raises or adds. */
export function ratchetBaseline(current, baseline) {
  const next = {};
  for (const [key, allowed] of Object.entries(baseline)) {
    const now = Math.min(current[key] ?? 0, allowed);
    if (now > 0) next[key] = now;
  }
  return next;
}

export function readRepo(repoRoot) {
  const listed = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (listed.status !== 0) throw new Error(listed.stderr);
  const files = new Map();
  for (const path of listed.stdout.split('\n')) {
    if (!path || !SOURCE.test(path) || NEVER_READ.test(path)) continue;
    let text;
    try {
      text = readFileSync(join(repoRoot, path), 'utf8');
    } catch {
      continue;
    }
    files.set(path, { identifiers: identifierCounts(path, text), exports: isProduction(path) ? exportedNames(path, text) : null, renames: renamedSpecifiers(path, text) });
  }
  return files;
}

function main() {
  const repoRoot = new URL('..', import.meta.url).pathname;
  const parsed = JSON.parse(readFileSync(join(repoRoot, BASELINE_FILE), 'utf8'));
  const baseline = Object.fromEntries(Object.entries(parsed).filter(([key]) => !key.startsWith('$')));
  const findings = classifyExports(readRepo(repoRoot));
  const current = entriesFor(findings);

  let allowed = baseline;
  if (process.argv.includes('--update')) {
    allowed = ratchetBaseline(current, baseline);
    const sorted = Object.fromEntries(Object.entries(allowed).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(join(repoRoot, BASELINE_FILE), `${JSON.stringify({ $comment: parsed.$comment, ...sorted }, null, 2)}\n`);
    console.log(`Lowered ${BASELINE_FILE}: ${Object.keys(allowed).length} entries.`);
  }

  const { over, under } = compareWithBaseline(current, allowed);
  const kindOf = new Map(findings.map((f) => [f.kind === 'own-file' ? `own:${f.file}` : `dead:${f.file}#${f.name}`, f.kind]));
  for (const { key, now, allowed: was } of over) {
    if (key.startsWith('own:')) {
      console.error(`${key.slice(4)} has ${now} exports only its own file uses (baseline ${was}). Drop \`export\` from the new one.`);
    } else {
      const how = kindOf.get(key) === 'tests-only' ? 'only tests use it: test through the caller and un-export it, or delete it' : 'nothing uses it: delete it';
      console.error(`${key.slice(5)} is exported and ${how} (rules/testing-rules.md §1B). A test hook that must stay takes "// poolmaster-allow-test-export: <reason>".`);
    }
  }
  for (const { key, now, allowed: was } of under) {
    console.error(`${key} is now ${now} (baseline ${was}). Lower it: run node scripts/check-dead-exports.mjs --update.`);
  }
  if (over.length > 0 || under.length > 0) process.exit(1);
  const dead = findings.filter((f) => f.kind !== 'own-file').length;
  console.log(`Dead exports match the baseline: ${dead} unused or tests-only, ${findings.length - dead} used only in their own file.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
