/**
 * #1956 — every word the app shows for a code lives in one display-string module per language,
 * `packages/shared/display-strings/en-US.ts` first (rules/ux-rules.md §16 *Display Strings*).
 * This check fails when:
 *
 * 1. enums.ts declares an enum that `SharedEnums` (display-strings-module.ts) leaves out, so the
 *    type check could not ask for its words;
 * 2. a module misses a value of a shared enum or an API error code, or keeps one that no longer
 *    exists — each failure names the enum (or `error`) and the code;
 * 3. a `word.` key, or an error context (`error.<CODE>.<context>`), is used nowhere in the
 *    source, or a plural has `_one` without `_other`. A
 *    `sport.<SPORT>.<role>` entry, and the generic `word.<role>` it falls back to, are read
 *    through `sportWord` by role rather than by key, so they count as used when the role is a
 *    `SportWordRole` (#1960); a role that is not one fails;
 * 4. a language's module does not have exactly the `en-US` keys, or an entry's placeholders
 *    (`{{n}}`) differ from the `en-US` entry's;
 * 5. a `Record<SharedEnum | ApiErrorCode, string>` is declared outside display-strings/ and is
 *    not on the allowlist (`scripts/display-strings-allowlist.json`), or the allowlist names a
 *    map that is gone — each migration ticket deletes its own entries until none are left.
 *
 * Run as `node --import tsx scripts/check-display-strings.mjs`: it reads the modules themselves.
 * Tests, stories and comment lines are exempt from 5.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ENUMS_FILE = 'packages/shared/domain/enums.ts';
export const MODULE_TYPES_FILE = 'packages/shared/display-strings/display-strings-module.ts';
export const ERROR_CODES_FILE = 'packages/shared/dto/api-error-codes.ts';
export const DISPLAY_STRINGS_DIR = 'packages/shared/display-strings/';
export const ALLOWLIST_FILE = 'scripts/display-strings-allowlist.json';
export const SPORT_WORD_ROLES_FILE = 'packages/shared/display-strings/sport-word-roles.ts';
export const SOURCE_LOCALE = 'en-US';
const SOURCE = /^(packages|clients)\/.+\.(ts|tsx)$/;
const EXEMPT = /(\.(test|spec|stories)\.tsx?$)|(\/generated\/)|(\/src\/test\/)/;
const PLURAL = /_(zero|one|two|few|many|other)$/;
const RULE = 'rules/ux-rules.md §16 *Display Strings*';

/** The names of the `as const` enum objects enums.ts declares. */
export function sharedEnumNames(enumsSource) {
  return [...enumsSource.matchAll(/^export const (\w+) = \{/gm)].map((match) => match[1]);
}

/** The enum names `SharedEnums` lists, one `Name: Enums.Name;` line each. */
export function registeredEnumNames(moduleTypesSource) {
  const block = moduleTypesSource.match(/export type SharedEnums = \{([\s\S]*?)\n\};/);
  return block ? [...block[1].matchAll(/^\s*(\w+): Enums\.(\w+);/gm)].map((match) => match[1]) : [];
}

/** The codes `API_ERROR_CODES` lists. */
export function apiErrorCodes(errorCodesSource) {
  const list = errorCodesSource.slice(errorCodesSource.indexOf('API_ERROR_CODES'));
  return [...list.slice(0, list.indexOf('] as const')).matchAll(/^\s*'(\w+)',/gm)].map((match) => match[1]);
}

/** 1: an enum enums.ts declares that SharedEnums leaves out. */
export function unregisteredEnums(declared, registered) {
  const known = new Set(registered);
  return declared
    .filter((name) => !known.has(name))
    .map((name) => `${MODULE_TYPES_FILE}: SharedEnums leaves out ${name}. Add \`${name}: Enums.${name};\` and its words to every module (${RULE}).`);
}

/**
 * 2: a module's entries against the enums (`{ name: values[] }`) and the error codes. Every
 * failure names the enum (or `error`) and the code.
 */
export function completenessFailures(locale, module, enums, errorCodes) {
  const failures = [];
  const words = module.enum ?? {};
  for (const [enumName, values] of Object.entries(enums)) {
    const entries = words[enumName];
    if (entries === undefined) {
      failures.push(`${locale}: enum ${enumName} has no display strings.`);
      continue;
    }
    for (const value of values) {
      if (!(value in entries)) failures.push(`${locale}: enum ${enumName} has no display string for ${value}.`);
    }
    for (const value of Object.keys(entries)) {
      if (!values.includes(value)) failures.push(`${locale}: enum ${enumName} has a display string for ${value}, which is not one of its values.`);
    }
  }
  for (const enumName of Object.keys(words)) {
    if (!(enumName in enums)) failures.push(`${locale}: ${enumName} has display strings but is not a shared enum.`);
  }
  const messages = module.error ?? {};
  for (const code of errorCodes) {
    if (!(code in messages)) failures.push(`${locale}: error code ${code} has no display string.`);
  }
  for (const code of Object.keys(messages)) {
    if (!errorCodes.includes(code)) failures.push(`${locale}: error ${code} has a display string but is not an API error code.`);
  }
  for (const [code, contexts] of Object.entries(module.errorContext ?? {})) {
    if (!errorCodes.includes(code)) failures.push(`${locale}: errorContext ${code} has display strings but is not an API error code.`);
    if ('short' in (contexts ?? {})) failures.push(`${locale}: errorContext ${code} names a context "short", which a lookup would read as a short form. Rename the context.`);
  }
  return failures;
}

/**
 * Every key a module holds, flat: `enum.ContestStatus.LIVE`, `enum.ContestStatus.LIVE.short`,
 * `error.CONTEST_FULL`, `error.CONTEST_ENTRY_LOCKED.pickEm`, `word.roundCount_one`.
 */
export function flatKeys(module) {
  const keys = [];
  const add = (key, entry) => {
    keys.push(key);
    if (typeof entry === 'object' && entry !== null) keys.push(`${key}.short`);
  };
  for (const [enumName, values] of Object.entries(module.enum ?? {})) {
    for (const [code, entry] of Object.entries(values)) add(`enum.${enumName}.${code}`, entry);
  }
  for (const [code, entry] of Object.entries(module.error ?? {})) add(`error.${code}`, entry);
  for (const [code, contexts] of Object.entries(module.errorContext ?? {})) {
    for (const [context, entry] of Object.entries(contexts ?? {})) add(`error.${code}.${context}`, entry);
  }
  for (const [key, entry] of Object.entries(module.word ?? {})) add(`word.${key}`, entry);
  for (const [sport, roles] of Object.entries(module.sport ?? {})) {
    for (const [role, entry] of Object.entries(roles ?? {})) add(`sport.${sport}.${role}`, entry);
  }
  for (const section of ['tierProfile', 'pricingProfile']) {
    for (const [code, entry] of Object.entries(module[section] ?? {})) {
      add(`${section}.${code}.name`, entry?.name);
      add(`${section}.${code}.description`, entry?.description);
    }
  }
  return keys;
}

const quoted = (text, value) => text.includes(`'${value}'`) || text.includes(`"${value}"`) || text.includes(`\`${value}\``);

/**
 * 3: `word.` keys no source file uses (a plural counts as used through its base key), sport
 * word entries whose role is not a `SportWordRole`, error contexts no source file names, and plurals with `_one` but no `_other`.
 * Sport word entries and the generic words of their roles are read by role (`sportWord`), so
 * they count as used.
 */
export function unusedKeyFailures(module, sourceTexts, sportWordRoles = []) {
  const keys = flatKeys(module).filter((key) => (key.startsWith('word.') || key.startsWith('sport.')) && !key.endsWith('.short'));
  const failures = [];
  const contexts = new Set(Object.values(module.errorContext ?? {}).flatMap((byContext) => Object.keys(byContext ?? {})));
  for (const context of [...contexts].sort()) {
    if (!sourceTexts.some((text) => quoted(text, context))) {
      failures.push(`${SOURCE_LOCALE}: error context ${context} is named by no screen. Delete its errorContext entries, or pass it to extractErrorMessage.`);
    }
  }
  const roles = new Set(sportWordRoles);
  const bases = new Set(keys.map((key) => key.replace(PLURAL, '')));
  for (const base of bases) {
    if (base.startsWith('sport.')) {
      const role = base.split('.')[2];
      if (!roles.has(role)) failures.push(`${SOURCE_LOCALE}: ${base} is not a sport word role. Add ${role} to SPORT_WORD_ROLES, or delete it.`);
      continue;
    }
    if (roles.has(base.slice('word.'.length))) continue;
    if (!sourceTexts.some((text) => quoted(text, base))) {
      failures.push(`${SOURCE_LOCALE}: ${base} is used nowhere. Delete it, or use it through displayString.`);
    }
  }
  for (const key of keys) {
    if (key.endsWith('_one') && !keys.includes(key.replace(/_one$/, '_other'))) {
      failures.push(`${SOURCE_LOCALE}: ${key} has no ${key.replace(/_one$/, '_other')}.`);
    }
  }
  return failures;
}

/** Every entry a module holds, flat, with its text: a short form under `<key>.short`. */
export function flatEntries(module) {
  const entries = {};
  const add = (key, entry) => {
    if (typeof entry === 'object' && entry !== null) {
      entries[key] = entry.name;
      entries[`${key}.short`] = entry.short;
    } else {
      entries[key] = entry;
    }
  };
  for (const [enumName, values] of Object.entries(module.enum ?? {})) {
    for (const [code, entry] of Object.entries(values)) add(`enum.${enumName}.${code}`, entry);
  }
  for (const [code, entry] of Object.entries(module.error ?? {})) add(`error.${code}`, entry);
  for (const [key, entry] of Object.entries(module.word ?? {})) add(`word.${key}`, entry);
  for (const [sport, roles] of Object.entries(module.sport ?? {})) {
    for (const [role, entry] of Object.entries(roles ?? {})) add(`sport.${sport}.${role}`, entry);
  }
  for (const section of ['tierProfile', 'pricingProfile']) {
    for (const [code, entry] of Object.entries(module[section] ?? {})) {
      add(`${section}.${code}.name`, entry?.name);
      add(`${section}.${code}.description`, entry?.description);
    }
  }
  return entries;
}

/** The placeholder names in one string, sorted: `['n']` for "Week {{n}}". */
export function placeholdersOf(text) {
  return [...new Set([...String(text).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((match) => match[1]))].sort();
}

/** 4: a language's keys against the source language's, and each entry's placeholders against the source's. */
export function parityFailures(locale, module, source) {
  const theirs = new Set(flatKeys(module));
  const ours = new Set(flatKeys(source));
  const theirEntries = flatEntries(module);
  const ourEntries = flatEntries(source);
  const placeholderFailures = Object.keys(ourEntries)
    .filter((key) => key in theirEntries && placeholdersOf(ourEntries[key]).join() !== placeholdersOf(theirEntries[key]).join())
    .map((key) => `${locale}: ${key} has placeholders {${placeholdersOf(theirEntries[key]).join(', ')}}, but ${SOURCE_LOCALE} has {${placeholdersOf(ourEntries[key]).join(', ')}}.`);
  return [
    ...[...ours].filter((key) => !theirs.has(key)).map((key) => `${locale}: missing ${key}, which ${SOURCE_LOCALE} has.`),
    ...[...theirs].filter((key) => !ours.has(key)).map((key) => `${locale}: has ${key}, which ${SOURCE_LOCALE} does not.`),
    ...placeholderFailures,
  ];
}

/** 5: the label maps a source file declares: the enum (or `ApiErrorCode`) of each `Record<…, string>`, with its line. */
export function findLabelMaps(text, enumNames) {
  const names = [...enumNames, 'ApiErrorCode'].join('|');
  const pattern = new RegExp(`Record<\\s*(${names})\\s*,\\s*string\\s*>`, 'g');
  const found = [];
  text.split('\n').forEach((line, index) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    for (const match of line.matchAll(pattern)) found.push({ enumName: match[1], line: index + 1 });
  });
  return found;
}

/**
 * 5: label maps against the allowlist (`{ path: [enumName, …] }`, one entry per map). A map
 * not on it fails; so does an entry whose map is gone, so the allowlist only shrinks.
 */
export function labelMapFailures(mapsByPath, allowlist) {
  const failures = [];
  const paths = new Set([...Object.keys(mapsByPath), ...Object.keys(allowlist)]);
  for (const path of [...paths].sort()) {
    const remaining = [...(allowlist[path] ?? [])];
    for (const { enumName, line } of mapsByPath[path] ?? []) {
      const index = remaining.indexOf(enumName);
      if (index >= 0) {
        remaining.splice(index, 1);
      } else {
        failures.push(`${path}:${line} maps ${enumName} to words of its own. Read them with enumLabel or displayString from @poolmaster/shared/display-strings (${RULE}).`);
      }
    }
    for (const enumName of remaining) {
      failures.push(`${ALLOWLIST_FILE}: ${path} no longer maps ${enumName} to words. Delete that entry, so the allowlist only shrinks.`);
    }
  }
  return failures;
}

function listSources(repoRoot) {
  const listed = spawnSync('git', ['ls-files', 'packages', 'clients'], { cwd: repoRoot, encoding: 'utf8' });
  if (listed.status !== 0) throw new Error(listed.stderr);
  return listed.stdout.split('\n').filter((path) => SOURCE.test(path) && !EXEMPT.test(path));
}

async function main() {
  const repoRoot = new URL('..', import.meta.url).pathname;
  const read = (path) => readFileSync(join(repoRoot, path), 'utf8');
  const enumsModule = await import(pathToFileURL(join(repoRoot, ENUMS_FILE)).href);
  const enums = enumsModule.default ?? enumsModule;
  const { DISPLAY_STRING_MODULES } = await import(pathToFileURL(join(repoRoot, DISPLAY_STRINGS_DIR, 'languages.ts')).href).then((loaded) => loaded.default ?? loaded);
  const { SPORT_WORD_ROLES } = await import(pathToFileURL(join(repoRoot, SPORT_WORD_ROLES_FILE)).href).then((loaded) => loaded.default ?? loaded);

  const declared = sharedEnumNames(read(ENUMS_FILE));
  const enumValues = Object.fromEntries(declared.map((name) => [name, Object.values(enums[name])]));
  const errorCodes = apiErrorCodes(read(ERROR_CODES_FILE));
  const sources = listSources(repoRoot);
  const outside = sources.filter((path) => !path.startsWith(DISPLAY_STRINGS_DIR));
  const texts = outside.map(read);
  const source = DISPLAY_STRING_MODULES[SOURCE_LOCALE];

  const mapsByPath = {};
  outside.forEach((path, index) => {
    const maps = findLabelMaps(texts[index], declared);
    if (maps.length > 0) mapsByPath[path] = maps;
  });

  const failures = [
    ...unregisteredEnums(declared, registeredEnumNames(read(MODULE_TYPES_FILE))),
    ...Object.entries(DISPLAY_STRING_MODULES).flatMap(([locale, module]) => completenessFailures(locale, module, enumValues, errorCodes)),
    ...unusedKeyFailures(source, texts, SPORT_WORD_ROLES),
    ...Object.entries(DISPLAY_STRING_MODULES)
      .filter(([locale]) => locale !== SOURCE_LOCALE)
      .flatMap(([locale, module]) => parityFailures(locale, module, source)),
    ...labelMapFailures(mapsByPath, JSON.parse(read(ALLOWLIST_FILE))),
  ];
  for (const failure of failures) console.error(failure);
  if (failures.length > 0) {
    process.exitCode = 1;
    return;
  }
  const allowed = Object.values(mapsByPath).reduce((count, maps) => count + maps.length, 0);
  console.log(
    `Display strings complete: ${declared.length} enums and ${errorCodes.length} error codes in ${Object.keys(DISPLAY_STRING_MODULES).length} language(s); ${allowed} allowlisted label maps left.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
