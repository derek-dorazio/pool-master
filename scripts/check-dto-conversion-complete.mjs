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
for (const file of walk(ROUTES_ROOT)) {
  const text = readFileSync(file, 'utf8');
  if (text.includes('schemaRef(') && !text.includes('schemaComponentsPlugin')) {
    structural.push(
      `${relative(process.cwd(), file)}: calls schemaRef() without registering `
      + 'schemaComponentsPlugin. The route will fail at boot with "Cannot resolve ref".',
    );
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

console.log(`Named-component contract OK (${registered.size} registered components, 4 checks).`);
