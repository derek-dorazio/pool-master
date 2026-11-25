import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compareWithBaseline, isAllowed, isWebProduction, ratchetBaseline, sharedDeclarations, sharedValueImports } from './check-web-shared-imports.mjs';

const allowed = [{ pattern: '^format', reason: 'r' }, { pattern: 'Order$', reason: 'r' }];

describe('check-web-shared-imports (#2107)', () => {
  it('finds a shared const object whose values equal its keys as an enum with its values, and one with other values as not', () => {
    const text = "export const ContestStatus = { OPEN: 'OPEN', FINAL: 'FINAL' } as const;\nexport const LIMITS = { MAX: 'max' };\nexport type Thing = { a: string };\nexport interface Other { b: number }\n";
    const { enums, enumValues, types } = sharedDeclarations('x.ts', text);
    assert.deepEqual([...enums], ['ContestStatus']);
    assert.deepEqual(enumValues.get('ContestStatus'), ['OPEN', 'FINAL']);
    assert.deepEqual([...types].sort(), ['Other', 'Thing']);
  });

  it('reads named value imports from the shared root and domain modules only, leaving out type-only imports', () => {
    const text = [
      "import { getSportDefinition, type SportDefinition } from '@poolmaster/shared/domain';",
      "import type { LeagueDto } from '@poolmaster/shared';",
      "import { LEAGUE_PLANS as plans } from '@poolmaster/shared';",
      "import { findTierLayoutProblem } from '@poolmaster/shared/domain/tier-profiles';",
      "import { t } from '@poolmaster/shared/display-strings';",
      "import { sdk } from '@poolmaster/shared/generated/hey-api';",
    ].join('\n');
    assert.deepEqual(sharedValueImports('a.tsx', text), ['getSportDefinition', 'LEAGUE_PLANS', 'findTierLayoutProblem']);
  });

  it('counts a namespace import or export star as the name *, and reads named re-exports and DTO-module imports, so none slips past', () => {
    const text = [
      "import * as domain from '@poolmaster/shared/domain';",
      "export { getSportDefinition } from '@poolmaster/shared/domain';",
      "export * from '@poolmaster/shared';",
      "export type { LeagueDto } from '@poolmaster/shared';",
      "import { ROUNDS_PAR_MAX } from '@poolmaster/shared/dto';",
    ].join('\n');
    assert.deepEqual(sharedValueImports('a.ts', text), ['*', 'getSportDefinition', '*', 'ROUNDS_PAR_MAX']);
  });

  it('allows types, enums and names an allow pattern matches, and counts everything else', () => {
    const declarations = { enums: new Set(['ContestStatus']), types: new Set(['SportDefinition']) };
    assert.equal(isAllowed('ContestStatus', declarations, allowed), true);
    assert.equal(isAllowed('SportDefinition', declarations, allowed), true);
    assert.equal(isAllowed('formatDollars', declarations, allowed), true);
    assert.equal(isAllowed('ContestStatusOrder', declarations, allowed), true);
    assert.equal(isAllowed('getSportDefinition', declarations, allowed), false);
    assert.equal(isAllowed('SURVIVOR_LIVES_MAX', declarations, allowed), false);
  });

  it('judges production web files only, not tests, stories or the test folder', () => {
    assert.equal(isWebProduction('clients/poolmaster/src/features/a.tsx'), true);
    assert.equal(isWebProduction('clients/poolmaster/src/features/a.test.tsx'), false);
    assert.equal(isWebProduction('clients/poolmaster/src/features/a.stories.tsx'), false);
    assert.equal(isWebProduction('clients/poolmaster/src/test/render.tsx'), false);
    assert.equal(isWebProduction('packages/shared/domain/a.ts'), false);
  });

  it('fails a name above its baseline or not listed at all, and asks to lower a name below it', () => {
    const { over, under } = compareWithBaseline({ getSportDefinition: 4, newRule: 1, championshipYear: 1 }, { getSportDefinition: 3, championshipYear: 2 });
    assert.deepEqual(over, [{ name: 'getSportDefinition', count: 4, allowed: 3 }, { name: 'newRule', count: 1, allowed: 0 }]);
    assert.deepEqual(under, [{ name: 'championshipYear', count: 1, allowed: 2 }]);
  });

  it('only lowers the baseline on update, dropping names at 0 and never adding or raising one', () => {
    assert.deepEqual(ratchetBaseline({ a: 1, b: 0, c: 9, d: 5 }, { a: 2, b: 1, c: 3 }), { a: 1, c: 3 });
  });
});
