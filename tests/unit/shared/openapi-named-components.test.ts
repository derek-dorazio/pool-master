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
const CONVERTED_COMPONENTS = [
  // squads — the first converted module. The `version` module is deliberately NOT
  // here: it is operational plumbing with no frontend consumers, and its conversion
  // is deferred to #180, which already owns how /version reports build identity.
  'SquadDto',
  'SquadListResponse',
  'SquadResponse',
  'SquadMembershipDto',
  'SquadMembershipResponse',
  'TeamRelationshipDto',
  'CreateSquadRequest',
  'UpdateSquadRequest',
  'AddSquadMemberRequest',
  // leagues — the highest-derivation module (18 sites across 3 names)
  'LeagueSummaryDto',
  'LeagueDetailDto',
  'LeagueMemberDto',
  'LeagueResponse',
  'LeagueListResponse',
  'LeagueMembersResponse',
];

/**
 * Response maps that no frontend file may index into any more, because the module
 * that owns them has been converted. Each entry is a module's derivations being gone
 * for good — a new one anywhere re-opens the drift the conversion closed.
 */
const RETIRED_RESPONSE_MAPS = [
  'ListLeagueSquadsResponses',
  'GetLeagueResponses',
  'GetLeagueByCodeResponses',
  'ListLeaguesResponses',
  'ListLeagueMembersResponses',
];

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
    const squadListPaths = Object.entries(openapi.paths)
      .filter(([, ops]) => ops.get?.responses?.['200']?.content?.['application/json']?.schema?.$ref
        === '#/components/schemas/SquadListResponse');
    expect(squadListPaths.length).toBeGreaterThan(0);
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

describe('#192: converted modules leave no derived types behind', () => {
  // Deleting the derivations is the deliverable, not cleanup. A module that adds the
  // import but leaves `type X = ListFooResponses[200][...]` in place has made things
  // worse: two ways to name one shape, and no signal which is current.
  const featureSources = readFileSync(
    join(ROOT, 'clients/poolmaster/src/features/teams/teams-page.tsx'),
    'utf8',
  );

  it('rule: squads consumers import SquadDto rather than deriving it', () => {
    expect(featureSources).toMatch(/SquadDto/);
  });

  it.each(RETIRED_RESPONSE_MAPS)(
    'rule: no frontend file indexes into %s any more',
    (responseMap) => {
      // Guards the whole tree. The word boundary matters: an unanchored match would
      // also hit AdminListLeaguesResponses, a different endpoint that is NOT yet
      // converted — a blanket rewrite did exactly that during the leagues slice and
      // renamed an admin type out from under itself.
      const { execSync } = require('node:child_process') as typeof import('node:child_process');
      const hits = execSync(
        `grep -rlE "\\b${responseMap}\\[" clients/poolmaster/src --include=*.ts --include=*.tsx || true`,
        { cwd: ROOT, encoding: 'utf8' },
      ).trim();
      expect(hits).toBe('');
    },
  );

  it('rule: an unconverted module keeps its response map untouched', () => {
    // AdminListLeaguesResponses belongs to the admin module, which has not been
    // converted. It must still be there — its absence would mean a conversion
    // reached past its own module.
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    const hits = execSync(
      'grep -rl "AdminListLeaguesResponses" clients/poolmaster/src --include=*.tsx || true',
      { cwd: ROOT, encoding: 'utf8' },
    ).trim();
    expect(hits).not.toBe('');
  });
});
