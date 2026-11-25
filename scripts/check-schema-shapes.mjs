/**
 * No opaque JSON column and no feed key outside a provider mapping table, unless listed (#2112;
 * rules/domain-model-conventions-rules.md *Guiding Principle* and §17 *Provider keys live only in
 * ProviderMapping tables*).
 *
 * `packages/core-api/prisma/schema.prisma` is read model by model:
 *
 * - every `Json` or `Json?` column is a `json:<Model>.<field>` entry;
 * - every column named like a feed key (`externalId`, `external…Id`, `providerKey`,
 *   `providerCode`, `providerValue`, `provider…Id`) is a `key:<Model>.<field>` entry, unless it
 *   sits on a model named `…ProviderMapping`, `Provider…` or `ProviderSyncFinding`, or is the
 *   foreign key of a relation to `Provider` (a row id, not the feed's key).
 *
 * `scripts/schema-shapes.json` lists each entry with its owner ticket or the reason it is
 * allowed. The check fails both ways: a column not listed is a new opaque shape or a misplaced
 * feed key, so give it typed columns or move it to a mapping table; a listed column that is gone
 * must be dropped with `--update`, which only removes. `rules:check:baseline-ratchet` refuses a
 * new entry unless `scripts/baseline-raises.json` declares it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BASELINE_FILE = 'scripts/schema-shapes.json';
export const SCHEMA_FILE = 'packages/core-api/prisma/schema.prisma';
const FEED_KEY = /^(externalId|external\w*Id|providerKey|providerCode|providerValue|provider\w*Id)$/;
const FIELD = /^\s+(\w+)\s+(\w+)(\?|\[\])?(.*)$/;

/** Whether a model is where feed keys belong: a mapping table, the provider's own lists, or a sync finding. */
export function isFeedKeyHome(model) {
  return /ProviderMapping$/.test(model) || /^Provider/.test(model);
}

/** The entries a schema implies: `json:<Model>.<field>` and `key:<Model>.<field>`. */
export function schemaEntries(schema) {
  const entries = [];
  let model = null;
  let fields = [];
  const close = () => {
    const providerForeignKeys = new Set();
    for (const { type, rest } of fields) {
      if (type !== 'Provider') continue;
      const match = /@relation\([^)]*fields:\s*\[([^\]]*)\]/.exec(rest);
      for (const name of match?.[1].split(',') ?? []) providerForeignKeys.add(name.trim());
    }
    for (const { name, type } of fields) {
      if (type === 'Json') entries.push(`json:${model}.${name}`);
      else if (FEED_KEY.test(name) && !isFeedKeyHome(model) && !providerForeignKeys.has(name)) entries.push(`key:${model}.${name}`);
    }
  };
  for (const line of schema.split('\n')) {
    const opened = /^model (\w+) \{/.exec(line);
    if (opened) {
      model = opened[1];
      fields = [];
      continue;
    }
    if (model === null) continue;
    if (/^\}/.test(line)) {
      close();
      model = null;
      continue;
    }
    const field = FIELD.exec(line);
    if (field && !field[1].startsWith('@')) fields.push({ name: field[1], type: field[2], rest: field[4] });
  }
  return entries;
}

/** The listed entries, `$` keys left out, each with its owner or reason. */
export function readBaseline(text) {
  const parsed = JSON.parse(text);
  return { parsed, listed: Object.fromEntries(Object.entries(parsed).filter(([key]) => !key.startsWith('$'))) };
}

/** Columns the schema has and the baseline does not list, and listed columns the schema no longer has. */
export function compareWithBaseline(entries, listed) {
  const present = new Set(entries);
  return {
    unlisted: entries.filter((entry) => !(entry in listed)),
    gone: Object.keys(listed).filter((entry) => !present.has(entry)),
  };
}

/** The baseline after `--update`: entries whose column is gone removed. Never adds. */
export function ratchetBaseline(entries, listed) {
  const present = new Set(entries);
  return Object.fromEntries(Object.entries(listed).filter(([entry]) => present.has(entry)));
}

function main() {
  const repoRoot = new URL('..', import.meta.url).pathname;
  const entries = schemaEntries(readFileSync(join(repoRoot, SCHEMA_FILE), 'utf8'));
  const { parsed, listed: baseline } = readBaseline(readFileSync(join(repoRoot, BASELINE_FILE), 'utf8'));
  let listed = baseline;
  if (process.argv.includes('--update')) {
    listed = ratchetBaseline(entries, baseline);
    writeFileSync(join(repoRoot, BASELINE_FILE), `${JSON.stringify({ $comment: parsed.$comment, ...listed }, null, 2)}\n`);
    console.log(`Updated ${BASELINE_FILE}: ${Object.keys(listed).length} columns.`);
  }
  const { unlisted, gone } = compareWithBaseline(entries, listed);
  for (const entry of unlisted) {
    const [kind, column] = entry.split(':');
    console.error(kind === 'json'
      ? `${column} is a Json column. Give its shape typed columns or a child table (rules/domain-model-conventions-rules.md *Guiding Principle: Strongly Typed End-to-End*); an integration boundary is listed in ${BASELINE_FILE} with its reason.`
      : `${column} holds a feed key outside a provider mapping table. Move it to a …ProviderMapping table (rules/domain-model-conventions-rules.md §17).`);
  }
  for (const entry of gone) console.error(`${entry} is listed in ${BASELINE_FILE} but the schema no longer has it. Run node scripts/check-schema-shapes.mjs --update.`);
  if (unlisted.length > 0 || gone.length > 0) process.exit(1);
  console.log(`Schema shapes match the baseline: ${entries.filter((e) => e.startsWith('json:')).length} Json columns, ${entries.filter((e) => e.startsWith('key:')).length} feed keys outside mapping tables.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
