/**
 * #192 — the published contract must carry named components, and the generated client
 * must turn them into importable named types.
 *
 * This asserts on the COMMITTED artifacts rather than on the registry, because the
 * failure this guards against is silent: the registry can be perfectly correct while
 * the document still publishes `def-0` (no refResolver), or inlines the shape at the
 * route (no $ref), or the generator emits nothing importable. Each of those happened
 * while building the plumbing, and each looked fine one layer up.
 *
 * `api:check` keeps these artifacts fresh, so asserting on them is not asserting on a
 * stale snapshot.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../..');
const openapi = JSON.parse(
  readFileSync(join(ROOT, 'packages/shared/generated/openapi.json'), 'utf8'),
) as {
  components?: { schemas?: Record<string, unknown> };
  paths: Record<string, Record<string, {
    responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>;
  }>>;
};
const generatedTypes = readFileSync(
  join(ROOT, 'packages/shared/generated/hey-api/types.gen.ts'),
  'utf8',
);

/** Modules converted to named components so far. Extend as each slice lands. */
const CONVERTED_COMPONENTS = ['ServiceVersionResponse', 'VersionComponent'];

describe('#192: DTOs publish as named OpenAPI components', () => {
  it('rule: the document declares components.schemas', () => {
    // Was 0 before #192 — every shape inlined per-operation.
    expect(Object.keys(openapi.components?.schemas ?? {}).length).toBeGreaterThan(0);
  });

  it.each(CONVERTED_COMPONENTS)(
    'rule: %s is published under its own name, not def-N',
    (name) => {
      expect(openapi.components?.schemas ?? {}).toHaveProperty(name);
    },
  );

  it('rule: no component is published as a def-N placeholder', () => {
    // @fastify/swagger names hoisted schemas def-0, def-1, ... without a refResolver.
    // Components exist but generate as `Def0`, which is useless as an import.
    const names = Object.keys(openapi.components?.schemas ?? {});
    expect(names.filter((n) => /^def-\d+$/.test(n))).toEqual([]);
  });

  it('rule: a converted route $refs its component instead of inlining the shape', () => {
    const versionPaths = Object.entries(openapi.paths)
      .filter(([path]) => path.includes('version'));
    expect(versionPaths.length).toBeGreaterThan(0);
    for (const [path, ops] of versionPaths) {
      const schema = ops.get?.responses?.['200']?.content?.['application/json']?.schema;
      expect(schema?.$ref)
        .toBe('#/components/schemas/ServiceVersionResponse');
      expect(path).toBeTruthy();
    }
  });

  it.each(CONVERTED_COMPONENTS)(
    'rule: %s generates as an importable named type',
    (name) => {
      // The whole point: the frontend imports this instead of deriving
      // `GetVersionResponses[200][...]`.
      expect(generatedTypes).toMatch(new RegExp(`^export type ${name} =`, 'm'));
    },
  );
});
