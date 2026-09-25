/**
 * Structural gates for the named-component contract (#192).
 *
 * Four checks, each covering a way the conversion fails SILENTLY — no type error, no
 * failing test, and a document that looks plausible:
 *
 *   1. A route inlines a schema that is published as a named component.
 *   2. A registered name never reaches `components.schemas`.
 *   3. `registerSchema('X', YSchema)` — the published name does not match its schema.
 *   4. A route file calls `schemaRef()` without registering the components plugin.
 *   5. A CONVERTED route file still inlines a domain schema that nobody registered.
 *
 * Check 1 is the original and the reason this file exists (#192).
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
const structural = [];

// --- 3. The published name must match the schema it publishes ------------------
// registerSchema('LeagueDto', SquadDtoSchema) publishes the wrong shape under a
// plausible name. Nothing downstream can tell: the component exists, generates a
// type, and every $ref to it resolves. Only the shape is wrong.
for (const [schemaConst, { component, dtoFile }] of registered) {
  const expected = schemaConst.replace(/Schema$/, '');
  if (expected !== component) {
    structural.push(
      `${dtoFile}: registerSchema('${component}', ${schemaConst}) — name does not match `
      + `its schema. Expected '${expected}', or rename the schema const.`,
    );
  }
}

// --- 2. A registered name must actually reach components.schemas ---------------
// registerSchema() runs as a module side effect, so a DTO module no route imports
// registers nothing. The registry looks correct, the document silently lacks the
// component, and the frontend has no type to import.
try {
  const doc = JSON.parse(readFileSync('packages/shared/generated/openapi.json', 'utf8'));
  const published = new Set(Object.keys(doc.components?.schemas ?? {}));
  for (const { component, dtoFile } of registered.values()) {
    if (!published.has(component)) {
      structural.push(
        `${dtoFile}: '${component}' is registered but absent from components.schemas. `
        + 'The DTO module is probably never imported by a route — add '
        + `\`import '@poolmaster/shared/dto/${dtoFile.replace(/\.ts$/, '')}';\` to the routes that use it.`,
      );
    }
  }
} catch {
  // No generated document in this checkout; api:check owns that failure.
}

// --- 4. schemaRef() requires the components plugin on that instance -------------
// Without it the route fails at BOOT with `Cannot resolve ref`, and only in whatever
// app-building path exercises that module. A module with no such test ships broken.
//
// Checked PER EXPORTED MODULE FUNCTION, not per file. One file can export several —
// contests/routes.ts exports both contestsModule and contestsByIdModule — and each
// gets its own encapsulated Fastify instance, so each needs its own registration. A
// file-level check passes as soon as ONE function registers the plugin, which is
// exactly how contestsByIdModule shipped unregistered and failed at boot.
function moduleFunctionBodies(text) {
  const bodies = [];
  const header = /^export (?:async )?function (\w+Module)\([^)]*\)[^{]*\{/gm;
  for (const m of text.matchAll(header)) {
    let i = m.index + m[0].length - 1;
    let depth = 0;
    for (; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    bodies.push({ name: m[1], body: text.slice(m.index + m[0].length, i) });
  }
  return bodies;
}

for (const file of walk(ROUTES_ROOT)) {
  const text = readFileSync(file, 'utf8');
  if (!text.includes('schemaRef(')) continue;
  for (const { name, body } of moduleFunctionBodies(text)) {
    if (body.includes('schemaRef(') && !body.includes('schemaComponentsPlugin')) {
      structural.push(
        `${relative(process.cwd(), file)}: ${name}() calls schemaRef() without registering `
        + 'schemaComponentsPlugin on its own instance. It will fail at boot with '
        + '"Cannot resolve ref". Each exported module function needs its own registration.',
      );
    }
  }
}

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

// --- 5. A converted route file must not inline any domain schema ---------------
// Checks 1-3 all reason about names that are ALREADY registered, so a DTO module
// nobody registered at all is invisible to every one of them. That is not
// hypothetical: `team-owner-invitations.dto.ts` had seven exported schemas and zero
// registrations while `squads/routes.ts` — a module marked converted — inlined five
// of them. Every guard passed.
//
// The rule that closes it: once a route file uses `schemaRef()` it has opted into the
// contract, so every remaining `zodToJsonSchema()` in it must be a generic envelope.
// Unconverted files use no `schemaRef()` and stay silent, so this creates no backlog.
const GENERIC_ENVELOPES = new Set(['ErrorEnvelopeSchema', 'SuccessSchema']);

//
// One honest exception. A route file can be MIXED on purpose: `admin/routes.ts` $refs
// league components because leagues' DTOs cross into it, while admin's own DTOs wait
// for their slice. A file declares that with a marker naming its tracking issue:
//
//     // #192-mixed: admin DTOs convert in their own slice; league components already $ref'd.
//
// The exemption lives at the violation site, not in a list inside this script, so it is
// visible in review and deleted by the slice that converts the file. Opted-out files are
// printed on success so they cannot go quiet.
const MIXED_MARKER = '#192-mixed:';
const mixedFiles = [];

for (const file of walk(ROUTES_ROOT)) {
  const text = readFileSync(file, 'utf8');
  if (!text.includes('schemaRef(')) continue; // unconverted module — inlining is correct
  const rel = relative(process.cwd(), file);
  if (text.includes(MIXED_MARKER)) {
    mixedFiles.push(rel);
    continue;
  }
  text.split('\n').forEach((line, index) => {
    const m = /zodToJsonSchema\(\s*(\w+)\s*\)/.exec(line);
    if (m === null || GENERIC_ENVELOPES.has(m[1])) return;
    structural.push(
      `${rel}:${index + 1}\n`
      + `    This file is converted (it calls schemaRef), but still inlines ${m[1]}.\n`
      + '    Register that schema and $ref it, or the module is only half published.\n'
      + `    If the file is deliberately mixed, add a '${MIXED_MARKER} <why>' comment.`,
    );
  });
}

if (structural.length > 0) {
  console.error(`Found ${structural.length} structural problem(s) with named components:\n`);
  for (const line of structural) console.error(`  ${line}\n`);
  console.error('See plans/143 (#192).');
  process.exit(1);
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

console.log(`Named-component contract OK (${registered.size} registered components, 5 checks).`);
if (mixedFiles.length > 0) {
  console.log(`  ${mixedFiles.length} file(s) opted out of check 5 via '${MIXED_MARKER}':`);
  for (const f of mixedFiles) console.log(`    ${f}`);
}
