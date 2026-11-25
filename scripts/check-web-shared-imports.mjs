/**
 * The web app imports only contract vocabulary from the shared domain, and the rest only shrinks
 * (#2107; rules/domain-model-conventions-rules.md §17 *Rules Live In The Model, Not In Code*).
 *
 * The web app holds no domain values and re-derives nothing the API decides. Shared code is fine
 * for the contract's vocabulary: enums and their order lists, types, zod schemas, display
 * formatters, the brand and image paths. A web import of anything else from
 * `@poolmaster/shared`, `@poolmaster/shared/domain` or `@poolmaster/shared/dto` reaches for a rule (a sport definition, a
 * limit, a derivation) that belongs in a DTO field the API fills.
 *
 * Every production file in `clients/poolmaster/src` is read with the TypeScript parser. Each
 * named import from those modules is allowed when it is:
 *
 * - type-only, or a type or interface (the contract's shape);
 * - an enum: a shared `const` object whose every value equals its key;
 * - matched by a pattern in `$allowed` of `scripts/web-shared-imports-baseline.json`, each with its
 *   reason.
 *
 * Every other name is counted per import, and the baseline holds the count each name may have.
 * The check fails both ways, like `check-retired-names.mjs`: a count above the baseline (or a name
 * not in it) is a new reach for a domain rule, so read the fact from a DTO field instead; a count
 * below it means a slice removed uses, so lower the entry with `--update` in the same PR.
 * `--update` only lowers entries and drops those at 0. `rules:check:baseline-ratchet` refuses a
 * new or raised entry unless `scripts/baseline-raises.json` declares it.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

export const BASELINE_FILE = 'scripts/web-shared-imports-baseline.json';
const WEB_SOURCE = 'clients/poolmaster/src';
const SHARED_SOURCE = 'packages/shared';

/** The shared modules whose imports are judged: the package root, the domain folder and the DTOs. */
export function isJudgedModule(specifier) {
  return ['@poolmaster/shared', '@poolmaster/shared/domain', '@poolmaster/shared/dto'].includes(specifier)
    || specifier.startsWith('@poolmaster/shared/domain/') || specifier.startsWith('@poolmaster/shared/dto/');
}

/** Production web source: not a test, a story or the test folder. */
export function isWebProduction(path) {
  return path.startsWith(`${WEB_SOURCE}/`) && /\.tsx?$/.test(path) && !/\.(test|spec|stories)\.tsx?$/.test(path) && !/(^|\/)test\//.test(path);
}

function parse(path, text) {
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

/**
 * The enums (const objects whose values equal their keys, with their values) and the types a
 * shared source file declares. The one definition of a shared enum: `no-enum-string-literals`
 * reads the same.
 */
export function sharedDeclarations(path, text) {
  const enums = new Set();
  const enumValues = new Map();
  const types = new Set();
  for (const statement of parse(path, text).statements) {
    if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) types.add(statement.name.text);
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      let init = declaration.initializer;
      while (init && (ts.isAsExpression(init) || ts.isSatisfiesExpression(init))) init = init.expression;
      if (!init || !ts.isObjectLiteralExpression(init) || init.properties.length === 0 || !ts.isIdentifier(declaration.name)) continue;
      const isEnum = init.properties.every((property) => {
        if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.initializer)) return false;
        const key = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : null;
        return key === property.initializer.text;
      });
      if (!isEnum) continue;
      enums.add(declaration.name.text);
      enumValues.set(declaration.name.text, init.properties.map((property) => property.initializer.text));
    }
  }
  return { enums, enumValues, types };
}

function listSharedSource(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'generated' || entry.name === 'dist' ? [] : listSharedSource(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

/** Every shared enum value, mapped to the names of the enums that hold it, read from the shared domain on disk. */
export function sharedEnumValuesOnDisk(repoRoot) {
  const values = new Map();
  for (const path of listSharedSource(resolve(repoRoot, SHARED_SOURCE, 'domain'))) {
    for (const [name, members] of sharedDeclarations(path, readFileSync(path, 'utf8')).enumValues) {
      for (const value of members) {
        if (!values.has(value)) values.set(value, []);
        values.get(value).push(name);
      }
    }
  }
  return values;
}

/**
 * Every named value a web file takes from a judged shared module: imports and re-exports.
 * Type-only ones are left out. A namespace import or `export *` reaches every name at once, so it
 * counts as the name `*`, which no pattern allows.
 */
export function sharedValueImports(path, text) {
  const names = [];
  for (const statement of parse(path, text).statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && isJudgedModule(statement.moduleSpecifier.text)) {
      const clause = statement.importClause;
      if (!clause || clause.isTypeOnly || !clause.namedBindings) continue;
      if (ts.isNamespaceImport(clause.namedBindings)) {
        names.push('*');
        continue;
      }
      for (const element of clause.namedBindings.elements) {
        if (!element.isTypeOnly) names.push((element.propertyName ?? element.name).text);
      }
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) && isJudgedModule(statement.moduleSpecifier.text)) {
      if (statement.isTypeOnly) continue;
      if (!statement.exportClause || ts.isNamespaceExport(statement.exportClause)) {
        names.push('*');
        continue;
      }
      for (const element of statement.exportClause.elements) {
        if (!element.isTypeOnly) names.push((element.propertyName ?? element.name).text);
      }
    }
  }
  return names;
}

/** Whether an imported name is contract vocabulary the web app may use. */
export function isAllowed(name, { enums, types }, allowed) {
  if (enums.has(name) || (types.has(name) && !enums.has(name))) return true;
  return allowed.some(({ pattern }) => new RegExp(pattern).test(name));
}

/** The baseline's counts and allow patterns, `$` keys kept apart. */
export function readBaseline(text) {
  const parsed = JSON.parse(text);
  const counts = Object.fromEntries(Object.entries(parsed).filter(([key]) => !key.startsWith('$')));
  return { parsed, counts, allowed: parsed.$allowed ?? [] };
}

/** Names over their baseline (a name not listed has a baseline of 0) and names under it. */
export function compareWithBaseline(counts, baseline) {
  const over = [];
  const under = [];
  for (const name of new Set([...Object.keys(counts), ...Object.keys(baseline)])) {
    const count = counts[name] ?? 0;
    const allowedCount = baseline[name] ?? 0;
    if (count > allowedCount) over.push({ name, count, allowed: allowedCount });
    else if (count < allowedCount) under.push({ name, count, allowed: allowedCount });
  }
  return { over, under };
}

/** The baseline after cleanups: each entry lowered to its count, entries at 0 dropped. Never raises or adds. */
export function ratchetBaseline(counts, baseline) {
  const next = {};
  for (const [name, allowedCount] of Object.entries(baseline)) {
    const count = Math.min(counts[name] ?? 0, allowedCount);
    if (count > 0) next[name] = count;
  }
  return next;
}

function listFiles(repoRoot, root) {
  const listed = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', root], { cwd: repoRoot, encoding: 'utf8' });
  if (listed.status !== 0) throw new Error(listed.stderr);
  return listed.stdout.split('\n').filter(Boolean);
}

/** Counts every disallowed name the web app imports, with the files that import it. */
export function countDisallowed(repoRoot, allowed) {
  const declarations = { enums: new Set(), types: new Set() };
  for (const path of listFiles(repoRoot, SHARED_SOURCE)) {
    if (!/\.ts$/.test(path) || /^packages\/shared\/(generated|dist)\//.test(path) || /\.test\.ts$/.test(path)) continue;
    const found = sharedDeclarations(path, readFileSync(join(repoRoot, path), 'utf8'));
    found.enums.forEach((name) => declarations.enums.add(name));
    found.types.forEach((name) => declarations.types.add(name));
  }
  const counts = {};
  const files = {};
  for (const path of listFiles(repoRoot, WEB_SOURCE).filter(isWebProduction)) {
    for (const name of sharedValueImports(path, readFileSync(join(repoRoot, path), 'utf8'))) {
      if (isAllowed(name, declarations, allowed)) continue;
      counts[name] = (counts[name] ?? 0) + 1;
      (files[name] ??= []).push(path);
    }
  }
  return { counts, files };
}

function main() {
  const repoRoot = new URL('..', import.meta.url).pathname;
  const { parsed, counts: baseline, allowed } = readBaseline(readFileSync(join(repoRoot, BASELINE_FILE), 'utf8'));
  const { counts, files } = countDisallowed(repoRoot, allowed);

  let current = baseline;
  if (process.argv.includes('--update')) {
    current = ratchetBaseline(counts, baseline);
    const next = { $comment: parsed.$comment, $allowed: allowed, ...Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b))) };
    writeFileSync(join(repoRoot, BASELINE_FILE), `${JSON.stringify(next, null, 2)}\n`);
    console.log(`Lowered ${BASELINE_FILE}: ${Object.keys(current).length} names.`);
  }

  const { over, under } = compareWithBaseline(counts, current);
  for (const { name, count, allowed: allowedCount } of over) {
    console.error(`${name} is imported from the shared domain ${count} times in the web app (baseline ${allowedCount}): ${files[name].join(', ')}. The web app reads what the API decides: add a DTO field instead (rules/domain-model-conventions-rules.md §17).`);
  }
  for (const { name, count, allowed: allowedCount } of under) {
    console.error(`${name} is now imported ${count} times (baseline ${allowedCount}). Lower its entry: run node scripts/check-web-shared-imports.mjs --update.`);
  }
  if (over.length > 0 || under.length > 0) process.exit(1);
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  console.log(`Web shared-domain imports match the baseline: ${Object.keys(counts).length} names, ${total} imports left.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
