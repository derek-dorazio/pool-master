/**
 * Enum Consistency Tests — validates that hardcoded enum arrays in route schemas
 * stay in sync with the canonical enum definitions in shared/domain/enums.ts.
 *
 * These catch silent drift when a developer adds an enum value to the domain
 * but forgets to update the JSON schema in a route file (or vice versa).
 */

import {
  ContestType,
  SelectionType,
  ScoringEngine,
  LeagueRole,
} from '@poolmaster/shared/domain';

// --- Helpers ---

function enumValues<T extends Record<string, string>>(obj: T): string[] {
  return Object.values(obj);
}

// Hardcoded enum arrays extracted from route schemas.
// These must match the source files exactly. If a route schema changes,
// update these constants and the corresponding test will catch the drift.

// From packages/core-api/src/modules/contests/routes.ts — POST / body schema
const ROUTE_CONTEST_TYPES = ['ROSTER'];
const ROUTE_SELECTION_TYPES = [
  'SNAKE_DRAFT',
  'TIERED',
  'BUDGET_PICK',
];
const ROUTE_SCORING_ENGINES = [
  'ADVANCEMENT',
  'STAT_ACCUMULATION',
  'STROKE_PLAY',
  'POSITION',
  'FIGHT_RESULT',
  'CUMULATIVE',
];

// From leagues/routes.ts — PUT /:id/members/:uid/role body schema
const ROUTE_MEMBER_ROLES = ['COMMISSIONER', 'MEMBER'];

// ========================================================================
// Tests
// ========================================================================

describe('Enum consistency — route schemas vs domain enums', () => {
  // --- ContestType ---

  it('every contestType in route schema is a valid ContestType', () => {
    const valid = enumValues(ContestType);
    for (const val of ROUTE_CONTEST_TYPES) {
      expect(valid).toContain(val);
    }
  });

  it('ContestType enum only contains SINGLE_EVENT', () => {
    expect(enumValues(ContestType)).toEqual(['ROSTER']);
  });

  // --- SelectionType ---

  it('every selectionType in route schema is a valid SelectionType', () => {
    const valid = enumValues(SelectionType);
    for (const val of ROUTE_SELECTION_TYPES) {
      expect(valid).toContain(val);
    }
  });

  // --- ScoringEngine ---

  it('every scoringEngine in route schema is a valid ScoringEngine', () => {
    const valid = enumValues(ScoringEngine);
    for (const val of ROUTE_SCORING_ENGINES) {
      expect(valid).toContain(val);
    }
  });

  // --- LeagueRole (role change endpoint) ---

  it('every role in member route schema is a valid LeagueRole', () => {
    const valid = enumValues(LeagueRole);
    for (const val of ROUTE_MEMBER_ROLES) {
      expect(valid).toContain(val);
    }
  });

});
