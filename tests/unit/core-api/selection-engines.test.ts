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
import {
  LineupIssueKind,
  type SelectionTierConfig,
  type SelectionParticipant,
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

describe('tiered selection engine — findLineupIssues decides whether an entry may be submitted', () => {
  const held = (...ids: string[]) => ids.map((participantId) => ({ participantId }));
  const issues = (rosterSize: number, tiers: SelectionTierConfig[], lineup: { participantId: string }[]) =>
    tieredSelectionEngine.findLineupIssues({ configuration: null, rosterSize, tiers, picks: lineup });

  it('finds no issue when the lineup holds exactly each tier\'s picks', () => {
    expect(issues(3, TIERS, held('a', 'b', 'd'))).toEqual([]);
  });

  it('reports the roster short and names every tier still short of its picks', () => {
    expect(issues(3, TIERS, held('a'))).toEqual([
      { kind: LineupIssueKind.ROSTER_SHORT, pickCount: 1, rosterSize: 3 },
      { kind: LineupIssueKind.TIER_SHORT, tierNames: ['Tier 1', 'Tier 2'] },
    ]);
  });

  it('refuses a lineup with the full pick count but the wrong spread across tiers', () => {
    expect(issues(3, TIERS, held('a', 'b', 'c'))).toEqual([
      { kind: LineupIssueKind.TIER_SHORT, tierNames: ['Tier 1', 'Tier 2'] },
    ]);
  });

  it('refuses a lineup whose extra pick sits on a golfer outside every tier', () => {
    expect(issues(3, TIERS, held('a', 'b', 'untiered'))).toEqual([
      { kind: LineupIssueKind.TIER_SHORT, tierNames: ['Tier 2'] },
    ]);
  });

  it('never finds a lineup complete when the roster has no places', () => {
    expect(issues(0, [], [])).toEqual([{ kind: LineupIssueKind.ROSTER_SHORT, pickCount: 0, rosterSize: 0 }]);
  });
});

describe('tiered selection engine — groupField and summarizeLineup', () => {
  it('lists one group per tier with the tier\'s golfers on the field, leaving out one not on it', () => {
    const groups = tieredSelectionEngine.groupField({
      tiers: TIERS,
      participants: [participant('a', 'Tier 1'), participant('d', 'Tier 2')],
      rosterSize: 3,
    });

    expect(groups.map((group) => [group.groupName, group.picksFromGroup, group.participants.map((row) => row.participantId)]))
      .toEqual([['Tier 1', 2, ['a']], ['Tier 2', 1, ['d']]]);
  });

  it('has no lineup summary', () => {
    expect(tieredSelectionEngine.summarizeLineup({
      configuration: null,
      rosterSize: 3,
      tiers: TIERS,
      picks: [],
      openField: [],
    })).toBeNull();
  });
});

describe('tiered selection engine — historyRound', () => {
  it('shows a pick in its tier\'s round, and by its place in the entry when it sits in no tier', () => {
    expect(tieredSelectionEngine.historyRound({ tierNumber: 2, entryPickIndex: 5 })).toBe(2);
    expect(tieredSelectionEngine.historyRound({ tierNumber: undefined, entryPickIndex: 5 })).toBe(5);
  });
});

describe('budget-pick selection engine', () => {
  const pricedParticipant = (participantId: string, price: number | undefined, isAvailable = true): SelectionParticipant => ({
    ...participant(participantId, null),
    price,
    isAvailable,
  });
  const budgetRequest = (overrides: Partial<SelectionRequest> = {}) =>
    request({ participant: pricedParticipant('a', 9_000), tiers: [], rosterSize: 2, ...overrides });
  const budgetConfiguration = (salaryCap: number) =>
    configuration({
      selectionType: SelectionType.BUDGET_PICK,
      configJson: { selectionType: SelectionType.BUDGET_PICK, rosterSize: 2, salaryCap, countedScores: 2 },
    });

  it('reads the roster size off the contest\'s budget rules, and 0 when it carries none', () => {
    expect(budgetPickSelectionEngine.rosterSize({
      configuration: configuration({ configJson: { selectionType: SelectionType.BUDGET_PICK, rosterSize: 6, salaryCap: 50_000, countedScores: 4 } }),
      tiers: [],
    })).toBe(6);
    expect(budgetPickSelectionEngine.rosterSize({ configuration: configuration(), tiers: [] })).toBe(0);
    expect(budgetPickSelectionEngine.rosterSize({ configuration: null, tiers: TIERS })).toBe(0);
  });

  it('accepts a pick into the next free place while the roster has room, whatever tier the golfer sits in', () => {
    expect(budgetPickSelectionEngine.evaluate(budgetRequest({ existingPicks: [{ id: 'pick-z', participantId: 'z', lineupSlot: 1 }] })))
      .toEqual({ kind: SelectionOutcomeKind.ACCEPT, lineupSlot: 2 });
  });

  it('reuses the place a removed pick left, so two picks never share one', () => {
    expect(budgetPickSelectionEngine.evaluate(budgetRequest({
      rosterSize: 3,
      existingPicks: [{ id: 'pick-y', participantId: 'y', lineupSlot: 2 }, { id: 'pick-z', participantId: 'z', lineupSlot: 3 }],
    }))).toEqual({ kind: SelectionOutcomeKind.ACCEPT, lineupSlot: 1 });
  });

  it('toggles off a participant the entry holds, which is how a full budget roster makes room', () => {
    expect(
      budgetPickSelectionEngine.evaluate(budgetRequest({
        heldPick: { id: 'pick-a', participantId: 'a' },
        existingPicks: picks('a', 'z'),
      })),
    ).toEqual({ kind: SelectionOutcomeKind.TOGGLE_OFF, pickId: 'pick-a' });
  });

  it('rejects a golfer with no price as PRICE_MISSING, since a pick must be spent against the cap', () => {
    expect(budgetPickSelectionEngine.evaluate(budgetRequest({ participant: pricedParticipant('a', undefined) })))
      .toEqual({ kind: SelectionOutcomeKind.REJECT, code: SelectionRejectCode.PRICE_MISSING });
  });

  it('rejects ENTRY_COMPLETE once the roster is full, replacing nothing', () => {
    expect(budgetPickSelectionEngine.evaluate(budgetRequest({ existingPicks: picks('y', 'z') })))
      .toEqual({ kind: SelectionOutcomeKind.REJECT, code: SelectionRejectCode.ENTRY_COMPLETE });
  });

  it('never rejects a pick for the budget: a pick that takes the entry over the cap is accepted', () => {
    expect(budgetPickSelectionEngine.evaluate(budgetRequest({
      participant: pricedParticipant('a', 1_000_000),
      existingPicks: [],
    }))).toEqual({ kind: SelectionOutcomeKind.ACCEPT, lineupSlot: 1 });
  });

  describe('findLineupIssues', () => {
    const issues = (salaryCap: number, ...prices: number[]) =>
      budgetPickSelectionEngine.findLineupIssues({
        configuration: budgetConfiguration(salaryCap),
        rosterSize: 2,
        tiers: TIERS,
        picks: prices.map((price, index) => ({ participantId: `p${index}`, price })),
      });

    it('finds none for a full roster costing exactly the cap', () => {
      expect(issues(100, 60, 40)).toEqual([]);
    });

    it('reports a full roster a cent over the cap as over budget, summing in cents', () => {
      expect(issues(100, 60.01, 40)).toEqual([{ kind: LineupIssueKind.OVER_BUDGET, spent: 100.01, salaryCap: 100 }]);
    });

    it('sums thirds of a dollar without float drift', () => {
      expect(issues(66.67, 33.34, 33.33)).toEqual([]);
    });

    it('reports a short roster by count, and over budget alongside it when it already costs too much', () => {
      expect(issues(100, 40)).toEqual([{ kind: LineupIssueKind.ROSTER_SHORT, pickCount: 1, rosterSize: 2 }]);
      expect(issues(100, 140)).toEqual([
        { kind: LineupIssueKind.ROSTER_SHORT, pickCount: 1, rosterSize: 2 },
        { kind: LineupIssueKind.OVER_BUDGET, spent: 140, salaryCap: 100 },
      ]);
    });
  });

  it('lists the whole field as one group, dearest first, unpriced last, ties by name', () => {
    const [group, ...others] = budgetPickSelectionEngine.groupField({
      tiers: TIERS,
      participants: [
        pricedParticipant('c', 6_000),
        pricedParticipant('a', undefined),
        pricedParticipant('b', 12_000),
        pricedParticipant('d', 6_000),
      ],
      rosterSize: 6,
    });

    expect(others).toEqual([]);
    expect(group).toMatchObject({ groupName: 'Field', picksFromGroup: 6 });
    expect(group.participants.map((row) => row.participantId)).toEqual(['b', 'c', 'd', 'a']);
  });

  describe('summarizeLineup', () => {
    // What the entry could still add; the room has already dropped held, taken and withdrawn rows.
    const openField = [
      pricedParticipant('cheap', 10),
      pricedParticipant('mid', 20),
      pricedParticipant('unpriced', undefined),
      pricedParticipant('dear', 90),
    ];
    const summarize = (salaryCap: number, rosterSize: number, heldPrices: number[]) =>
      budgetPickSelectionEngine.summarizeLineup({
        configuration: budgetConfiguration(salaryCap),
        rosterSize,
        tiers: [],
        picks: heldPrices.map((price) => ({ participantId: 'held', price })),
        openField,
      });

    it('reports spend, what is left, and what the cheapest priced golfers the entry could add cost to fill its open places', () => {
      expect(summarize(100, 3, [50])).toEqual({
        selectionType: SelectionType.BUDGET_PICK,
        salaryCap: 100,
        spent: 50,
        remaining: 50,
        isOverBudget: false,
        openSlots: 2,
        cheapestFill: 30,
      });
    });

    it('goes negative and flags over budget once the picks cost more than the cap', () => {
      expect(summarize(40, 1, [50])).toMatchObject({ remaining: -10, isOverBudget: true, openSlots: 0, cheapestFill: 0 });
    });

    it('has no cheapest fill when the priced golfers the entry could add cannot fill the open places', () => {
      expect(summarize(1_000, 6, [50])).toMatchObject({ openSlots: 5, cheapestFill: null });
    });

    it('has no summary for a contest without budget rules', () => {
      expect(budgetPickSelectionEngine.summarizeLineup({
        configuration: configuration(),
        rosterSize: 2,
        tiers: [],
        picks: [],
        openField,
      })).toBeNull();
    });
  });

  it('shows a pick in the round of its place in the entry, ignoring tiers', () => {
    expect(budgetPickSelectionEngine.historyRound({ tierNumber: 2, entryPickIndex: 5 })).toBe(5);
  });
});
