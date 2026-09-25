/**
 * #192 — the published contract must carry named components, the generator must turn
 * them into importable types, and converted modules must leave no derivations behind.
 *
 * EVERY ASSERTION HERE IS DERIVED FROM THE COMMITTED ARTIFACTS. There is no hand-kept
 * list of converted modules, deliberately: a list is maintenance that gets forgotten,
 * and a forgotten entry makes the guard quietly stop covering a module. `api:check`
 * keeps the artifacts fresh, so deriving from them is not deriving from a stale
 * snapshot.
 *
 * This file exists because two failures during the leagues slice both looked like
 * success:
 *
 *   - Item derivations were deleted while ENVELOPE derivations (`Responses[200]` as a
 *     function return type) survived in test fixtures — a half-converted module.
 *   - A blanket rewrite matched `ListLeaguesResponses` inside
 *     `AdminListLeaguesResponses` and renamed a type belonging to an unconverted
 *     module. Overreach reads as progress unless something asserts the opposite.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../..');

interface OpenApiDoc {
  components?: { schemas?: Record<string, unknown> };
  paths: Record<string, Record<string, {
    operationId?: string;
    responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>;
  }>>;
}

const openapi = JSON.parse(
  readFileSync(join(ROOT, 'packages/shared/generated/openapi.json'), 'utf8'),
) as OpenApiDoc;
const generatedTypes = readFileSync(
  join(ROOT, 'packages/shared/generated/hey-api/types.gen.ts'),
  'utf8',
);

const componentNames = Object.keys(openapi.components?.schemas ?? {});

/**
 * Response-map names for operations already converted to a `$ref`.
 *
 * hey-api derives the map name from the operationId, so this is computable rather
 * than listed: `listLeagues` -> `ListLeaguesResponses`. An operation whose 200 is
 * still an inline schema is NOT here, which is what keeps the guard off unconverted
 * modules.
 */
function retiredResponseMaps(): string[] {
  const maps = new Set<string>();
  for (const ops of Object.values(openapi.paths)) {
    for (const op of Object.values(ops)) {
      if (typeof op !== 'object' || op === null) continue;
      const ref = op.responses?.['200']?.content?.['application/json']?.schema?.$ref;
      if (ref === undefined || op.operationId === undefined) continue;
      maps.add(`${op.operationId.charAt(0).toUpperCase()}${op.operationId.slice(1)}Responses`);
    }
  }
  return [...maps].sort();
}

/** Files under features/ that index into a response map, word-boundary matched. */
function filesIndexing(responseMap: string): string {
  try {
    return execFileSync('grep', [
      '-rlE', `\\b${responseMap}\\[`,
      'clients/poolmaster/src',
      '--include=*.ts', '--include=*.tsx',
    ], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return ''; // grep exits 1 when nothing matches
  }
}

describe('#192: DTOs publish as named OpenAPI components', () => {
  it('rule: the document declares components.schemas', () => {
    // Was 0 before #192 — every shape inlined per-operation.
    expect(componentNames.length).toBeGreaterThan(0);
  });

  it('rule: no component is published as a def-N placeholder', () => {
    // @fastify/swagger names hoisted schemas def-0, def-1, ... without a refResolver.
    // They exist, and generate as `Def0`, which is useless as an import.
    expect(componentNames.filter((n) => /^def-\d+$/.test(n))).toEqual([]);
  });

  it.each(componentNames)('rule: %s generates as an importable named type', (name) => {
    // The whole point: the frontend imports this instead of deriving from a
    // response map. A component that does not generate a type buys nothing.
    expect(generatedTypes).toMatch(new RegExp(`^export type ${name} =`, 'm'));
  });
});

describe('#192: converted modules leave no derivations behind', () => {
  const retired = retiredResponseMaps();

  it('rule: at least one operation is converted, so the guard is not vacuous', () => {
    expect(retired.length).toBeGreaterThan(0);
  });

  it.each(retired)('rule: no frontend file indexes into %s', (responseMap) => {
    // Deleting the derivations is the deliverable, not cleanup. Leaving one beside
    // the import gives two ways to name one shape and no signal which is current.
    expect(filesIndexing(responseMap)).toBe('');
  });

  it('rule: unconverted modules keep their response maps', () => {
    // The mirror of the above, and the one that catches OVERREACH: a rewrite that
    // matched a converted map's name as a substring of an unconverted one would
    // otherwise look like extra progress. At least one unconverted operation's map
    // must still be indexed somewhere, or this conversion has reached too far.
    const stillInline = Object.values(openapi.paths)
      .flatMap((ops) => Object.values(ops))
      .filter((op): op is { operationId: string } =>
        typeof op === 'object' && op !== null
        && typeof op.operationId === 'string'
        && op.responses?.['200']?.content?.['application/json']?.schema?.$ref === undefined)
      .map((op) => `${op.operationId.charAt(0).toUpperCase()}${op.operationId.slice(1)}Responses`);
    const anyStillIndexed = stillInline.some((m) => filesIndexing(m) !== '');
    expect(anyStillIndexed).toBe(true);
  });
});
