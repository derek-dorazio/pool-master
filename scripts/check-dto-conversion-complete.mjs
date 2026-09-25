/**
 * A DTO module that publishes named components must not still inline them (#192).
 *
 * The failure this catches: a module gets its `registerSchema()` block and most of its
 * routes converted to `schemaRef()`, but one or two routes keep calling
 * `zodToJsonSchema(XSchema)` on a schema that IS registered. Nothing else notices —
 * lint passes, types pass, `api:check` passes, and the document quietly carries that
 * one shape inline while every other route references it. The frontend then has a
 * named type for most of the module and a response-map derivation for the rest, which
 * is the exact split this epic exists to remove.
 *
 * Only registered names are checked. A schema with no `registerSchema()` call belongs
 * to an unconverted module and inlining it is correct, so untouched modules stay
 * silent — this gate does not create a backlog.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DTO_DIR = 'packages/shared/dto';
const ROUTES_ROOT = 'packages/core-api/src';

/** Component names registered anywhere in the DTO layer, and the schema each maps to. */
function registeredSchemaNames() {
  const bySchemaConst = new Map();
  for (const file of readdirSync(DTO_DIR)) {
    if (!file.endsWith('.dto.ts')) continue;
    const text = readFileSync(join(DTO_DIR, file), 'utf8');
    for (const m of text.matchAll(/registerSchema\(\s*'([^']+)'\s*,\s*(\w+)\s*\)/g)) {
      bySchemaConst.set(m[2], { component: m[1], dtoFile: file });
    }
  }
  return bySchemaConst;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith('.ts')) yield full;
  }
}

const registered = registeredSchemaNames();
const findings = [];

for (const file of walk(ROUTES_ROOT)) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    const m = /zodToJsonSchema\(\s*(\w+)\s*\)/.exec(line);
    if (m === null) return;
    const hit = registered.get(m[1]);
    if (hit === undefined) return;
    findings.push({
      location: `${relative(process.cwd(), file)}:${index + 1}`,
      schema: m[1],
      component: hit.component,
      dtoFile: hit.dtoFile,
    });
  });
}

if (findings.length > 0) {
  console.error(`Found ${findings.length} route(s) inlining a schema that is published as a named component:\n`);
  for (const f of findings) {
    console.error(`  ${f.location}`);
    console.error(`    zodToJsonSchema(${f.schema}) -- ${f.dtoFile} registers this as '${f.component}'`);
    console.error(`    Use schemaRef('${f.component}') instead.\n`);
  }
  console.error('A half-converted module publishes one shape inline and $refs it everywhere');
  console.error('else, so the frontend gets a named type for part of it and a response-map');
  console.error('derivation for the rest. See plans/143 (#192).');
  process.exit(1);
}

console.log(`No half-converted DTO modules (${registered.size} registered components checked).`);
