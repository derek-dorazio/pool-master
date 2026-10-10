import { SelectionType } from '@poolmaster/shared/domain';
import type { ContestConfiguration } from '@poolmaster/shared/domain';
import { budgetPickSelectionEngine } from '../../../packages/core-api/src/modules/selections/selection-engines/budget-pick';
import { findSelectionEngine } from '../../../packages/core-api/src/modules/selections/selection-engines/registry';
import {
  SelectionOutcomeKind,
  SelectionRejectCode,
  type EntryPick,
  type SelectionRequest,
} from '../../../packages/core-api/src/modules/selections/selection-engines/selection-engine';
import {
  resolveTieredPlacement,
  tieredSelectionEngine,
} from '../../../packages/core-api/src/modules/selections/selection-engines/tiered';
import type {
  SelectionTierConfig,
  SelectionParticipant,
} from '../../../packages/core-api/src/modules/selections/types';

// The selection engines (#198), called directly. Each is pure: these tests hand it a request
// and read back the outcome, with no service, port or database. Exclusivity is not here
// because it is not an engine's rule; selection-service.test.ts runs it against both engines.

function tier(overrides: Partial<SelectionTierConfig> = {}): SelectionTierConfig {
  return {
    tierId: 'tier-1',
    tierName: 'Tier 1',
    tierNumber: 1,
    picksFromTier: 2,
    participantIds: [],
    ...overrides,
  };
}

function configuration(overrides: Partial<ContestConfiguration> = {}): ContestConfiguration {
  return {
    id: 'config-1',
    contestId: 'contest-1',
    selectionType: SelectionType.TIERED,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as ContestConfiguration;
}

function participant(participantId: string, tierLabel: string | null): SelectionParticipant {
  return {
    sportEventParticipantId: `sep-${participantId}`,
    participantId,
    participantName: `Golfer ${participantId}`,
    tier: tierLabel,
    isAvailable: true,
  };
}

const picks = (...participantIds: string[]): EntryPick[] =>
  participantIds.map((participantId) => ({ id: `pick-${participantId}`, participantId }));

const TIERS = [
  tier({ tierId: 'tier-1', tierName: 'Tier 1', tierNumber: 1, picksFromTier: 2, participantIds: ['a', 'b', 'c'] }),
  tier({ tierId: 'tier-2', tierName: 'Tier 2', tierNumber: 2, picksFromTier: 1, participantIds: ['d', 'e'] }),
];
const ROSTER_SIZE = 3;

function request(overrides: Partial<SelectionRequest> = {}): SelectionRequest {
  return {
    participant: participant('a', 'Tier 1'),
    heldPick: null,
    existingPicks: [],
    tiers: TIERS,
    rosterSize: ROSTER_SIZE,
    ...overrides,
  };
}

describe('selection engine registry', () => {
  it('serves tiered and budget-pick contests with their own engines', () => {
    expect(findSelectionEngine(SelectionType.TIERED)).toBe(tieredSelectionEngine);
    expect(findSelectionEngine(SelectionType.BUDGET_PICK)).toBe(budgetPickSelectionEngine);
  });

  it('has no engine for snake draft or the deferred types, which is what makes the room answer 501', () => {
    expect(findSelectionEngine(SelectionType.SNAKE_DRAFT)).toBeUndefined();
    expect(findSelectionEngine(SelectionType.OPEN_SELECTION)).toBeUndefined();
    expect(findSelectionEngine(SelectionType.PICK_EM)).toBeUndefined();
    expect(findSelectionEngine(SelectionType.BRACKET_PICK_EM)).toBeUndefined();
  });
});

describe('tiered selection engine — roster size', () => {
  it('adds up the roster from the tiers', () => {
    const tiers = [
      tier({ tierNumber: 1, picksFromTier: 2 }),
      tier({ tierId: 'tier-2', tierNumber: 2, picksFromTier: 3 }),
    ];

    expect(tieredSelectionEngine.rosterSize({ configuration: configuration(), tiers })).toBe(5);
  });

  it('gives a contest with no tiers a roster of 0, which SELECTION_CONFIG_INVALID rests on', () => {
    expect(tieredSelectionEngine.rosterSize({ configuration: configuration(), tiers: [] })).toBe(0);
  });
});

describe('tiered selection engine — evaluate', () => {
  it('toggles off a participant the entry already holds, before looking at tiers at all', () => {
    expect(
      tieredSelectionEngine.evaluate(request({
        participant: participant('a', null),
        heldPick: { id: 'pick-a', participantId: 'a' },
        existingPicks: picks('a'),
      })),
    ).toEqual({ kind: SelectionOutcomeKind.TOGGLE_OFF, pickId: 'pick-a' });
  });

  it('rejects TIER_MISSING for a participant with no tier', () => {
    expect(tieredSelectionEngine.evaluate(request({ participant: participant('z', null) })))
      .toEqual({ kind: SelectionOutcomeKind.REJECT, code: SelectionRejectCode.TIER_MISSING });
  });

  it('rejects TIER_NOT_FOUND, carrying the label, for a tier the contest does not configure', () => {
    expect(tieredSelectionEngine.evaluate(request({ participant: participant('z', 'Tier 9') })))
      .toEqual({ kind: SelectionOutcomeKind.REJECT, code: SelectionRejectCode.TIER_NOT_FOUND, tierLabel: 'Tier 9' });
  });

  it('finds the participant\'s tier by its id as well as its display name', () => {
    expect(tieredSelectionEngine.evaluate(request({ participant: participant('d', 'tier-2') })))
      .toEqual({ kind: SelectionOutcomeKind.ACCEPT, lineupSlot: 3 });
  });

  it('replaces the newest pick in a full tier rather than rejecting', () => {
    expect(tieredSelectionEngine.evaluate(request({ participant: participant('c', 'Tier 1'), existingPicks: picks('a', 'b') })))
      .toEqual({ kind: SelectionOutcomeKind.REPLACE, lineupSlot: 2, replacedPickId: 'pick-b' });
  });
});

describe('tiered selection engine — resolveTieredPlacement', () => {
  it('places a first pick in tier 1 at round 1', () => {
    expect(
      resolveTieredPlacement({ tier: TIERS[0], tiers: TIERS, existingPicks: [], rosterSize: ROSTER_SIZE }),
    ).toEqual({ kind: SelectionOutcomeKind.ACCEPT, lineupSlot: 1 });
  });

  it('places a second pick in tier 1 at round 2', () => {
    expect(
      resolveTieredPlacement({ tier: TIERS[0], tiers: TIERS, existingPicks: picks('a'), rosterSize: ROSTER_SIZE }),
    ).toEqual({ kind: SelectionOutcomeKind.ACCEPT, lineupSlot: 2 });
  });

  it('counts the rounds the earlier tiers take before placing in a later one', () => {
    expect(
      resolveTieredPlacement({ tier: TIERS[1], tiers: TIERS, existingPicks: picks('a', 'b'), rosterSize: ROSTER_SIZE }),
    ).toEqual({ kind: SelectionOutcomeKind.ACCEPT, lineupSlot: 3 });
  });

  // The central rule, and the one the deleted engines had backwards: given a full tier, they
  // rejected the pick; the live room replaces it. This assertion is the difference.
  it('replaces the tier\'s last pick when the tier is already full, rather than rejecting', () => {
    expect(
      resolveTieredPlacement({ tier: TIERS[0], tiers: TIERS, existingPicks: picks('a', 'b'), rosterSize: ROSTER_SIZE }),
    ).toEqual({ kind: SelectionOutcomeKind.REPLACE, lineupSlot: 2, replacedPickId: 'pick-b' });
  });

  it('replaces within a full tier even when the whole entry is full', () => {
    expect(
      resolveTieredPlacement({ tier: TIERS[1], tiers: TIERS, existingPicks: picks('a', 'b', 'd'), rosterSize: ROSTER_SIZE }),
    ).toEqual({ kind: SelectionOutcomeKind.REPLACE, lineupSlot: 3, replacedPickId: 'pick-d' });
  });

  it('rejects ENTRY_COMPLETE only for a full entry with no pick in this tier to displace', () => {
    expect(
      resolveTieredPlacement({ tier: TIERS[1], tiers: TIERS, existingPicks: picks('a', 'b', 'c'), rosterSize: 3 }),
    ).toEqual({ kind: SelectionOutcomeKind.REJECT, code: SelectionRejectCode.ENTRY_COMPLETE });
  });

  it('places, not replaces, a tier that contributes no picks while the entry has room', () => {
    const zeroPickTier = tier({ tierId: 'tier-0', tierNumber: 1, picksFromTier: 0, participantIds: ['z'] });

    expect(
      resolveTieredPlacement({ tier: zeroPickTier, tiers: [zeroPickTier, TIERS[1]], existingPicks: [], rosterSize: 1 }),
    ).toEqual({ kind: SelectionOutcomeKind.ACCEPT, lineupSlot: 0 });
  });

  it('rejects ENTRY_COMPLETE for a zero-pick tier once the entry is full, having nothing to displace', () => {
    const zeroPickTier = tier({ tierId: 'tier-0', tierNumber: 1, picksFromTier: 0, participantIds: ['z'] });

    expect(
      resolveTieredPlacement({ tier: zeroPickTier, tiers: [zeroPickTier, TIERS[1]], existingPicks: picks('d'), rosterSize: 1 }),
    ).toEqual({ kind: SelectionOutcomeKind.REJECT, code: SelectionRejectCode.ENTRY_COMPLETE });
  });
});

describe('tiered selection engine — findShortfall decides whether an entry may be submitted', () => {
  const held = (...ids: string[]) => ids.map((participantId) => ({ participantId }));

  it('finds no shortfall when the lineup holds exactly each tier\'s picks', () => {
    expect(tieredSelectionEngine.findShortfall({ rosterSize: 3, tiers: TIERS, picks: held('a', 'b', 'd') })).toBeNull();
  });

  it('names every tier still short of its picks, with the picks held against the roster', () => {
    expect(tieredSelectionEngine.findShortfall({ rosterSize: 3, tiers: TIERS, picks: held('a') }))
      .toEqual({ pickCount: 1, rosterSize: 3, shortTierNames: ['Tier 1', 'Tier 2'] });
  });

  it('refuses a lineup with the full pick count but the wrong spread across tiers', () => {
    expect(tieredSelectionEngine.findShortfall({ rosterSize: 3, tiers: TIERS, picks: held('a', 'b', 'c') }))
      .toEqual({ pickCount: 3, rosterSize: 3, shortTierNames: ['Tier 1', 'Tier 2'] });
  });

  it('refuses a lineup whose extra pick sits on a golfer outside every tier', () => {
    expect(tieredSelectionEngine.findShortfall({ rosterSize: 3, tiers: TIERS, picks: held('a', 'b', 'untiered') }))
      .toEqual({ pickCount: 3, rosterSize: 3, shortTierNames: ['Tier 2'] });
  });

  it('never finds a lineup complete when the roster has no places', () => {
    expect(tieredSelectionEngine.findShortfall({ rosterSize: 0, tiers: [], picks: [] }))
      .toEqual({ pickCount: 0, rosterSize: 0, shortTierNames: [] });
  });
});

describe('tiered selection engine — historyRound', () => {
  it('shows a pick in its tier\'s round, and by its place in the entry when it sits in no tier', () => {
    expect(tieredSelectionEngine.historyRound({ tierNumber: 2, entryPickIndex: 5 })).toBe(2);
    expect(tieredSelectionEngine.historyRound({ tierNumber: undefined, entryPickIndex: 5 })).toBe(5);
  });
});

describe('budget-pick selection engine', () => {
  const budgetRequest = (overrides: Partial<SelectionRequest> = {}) =>
    request({ participant: participant('a', null), tiers: [], rosterSize: 2, ...overrides });

  it('reads the roster size off the contest\'s budget rules, and 0 when it carries none', () => {
    expect(budgetPickSelectionEngine.rosterSize({
      configuration: configuration({ configJson: { selectionType: SelectionType.BUDGET_PICK, rosterSize: 6, salaryCap: 50_000, countedScores: 4 } }),
      tiers: [],
    })).toBe(6);
    expect(budgetPickSelectionEngine.rosterSize({ configuration: configuration(), tiers: [] })).toBe(0);
    expect(budgetPickSelectionEngine.rosterSize({ configuration: null, tiers: TIERS })).toBe(0);
  });

  it('accepts a pick into the next round while the roster has room, whatever tier the golfer sits in', () => {
    expect(budgetPickSelectionEngine.evaluate(budgetRequest({ existingPicks: picks('z') })))
      .toEqual({ kind: SelectionOutcomeKind.ACCEPT, lineupSlot: 2 });
  });

  it('rejects re-selecting a participant the entry holds as DUPLICATE_PICK, never toggling it off', () => {
    expect(
      budgetPickSelectionEngine.evaluate(budgetRequest({
        heldPick: { id: 'pick-a', participantId: 'a' },
        existingPicks: picks('a'),
      })),
    ).toEqual({ kind: SelectionOutcomeKind.REJECT, code: SelectionRejectCode.DUPLICATE_PICK });
  });

  it('rejects ENTRY_COMPLETE once the roster is full, replacing nothing', () => {
    expect(budgetPickSelectionEngine.evaluate(budgetRequest({ existingPicks: picks('y', 'z') })))
      .toEqual({ kind: SelectionOutcomeKind.REJECT, code: SelectionRejectCode.ENTRY_COMPLETE });
  });

  it('judges a lineup by its pick count alone', () => {
    const held = (...ids: string[]) => ids.map((participantId) => ({ participantId }));

    expect(budgetPickSelectionEngine.findShortfall({ rosterSize: 2, tiers: TIERS, picks: held('a', 'z') })).toBeNull();
    expect(budgetPickSelectionEngine.findShortfall({ rosterSize: 2, tiers: TIERS, picks: held('a') }))
      .toEqual({ pickCount: 1, rosterSize: 2, shortTierNames: [] });
  });

  it('shows a pick in the round of its place in the entry, ignoring tiers', () => {
    expect(budgetPickSelectionEngine.historyRound({ tierNumber: 2, entryPickIndex: 5 })).toBe(5);
  });
});
