import { ContestRulesSchema, ContestRulesWithEntryLimitSchema, SelectionType, canFillBudgetRoster, survivorLivesOf } from '@poolmaster/shared/domain';

describe('canFillBudgetRoster', () => {
  it('fits when the cheapest golfers for every place cost exactly the cap', () => {
    expect(canFillBudgetRoster([9_000, 3_000, 2_000], 2, 5_000)).toBe(true);
  });

  it('refuses when even the cheapest golfers for every place cost more than the cap', () => {
    expect(canFillBudgetRoster([9_000, 3_000, 2_001], 2, 5_000)).toBe(false);
  });

  it('sums cent prices exactly, so three thirds of a dollar cap fit without float drift', () => {
    expect(canFillBudgetRoster([33.34, 33.33, 33.33], 3, 100)).toBe(true);
  });

  it('refuses a roster larger than the priced field, since its places cannot all be filled', () => {
    expect(canFillBudgetRoster([100, 100], 3, 50_000)).toBe(false);
  });
});

describe('survivorLivesOf', () => {
  it('reads a survivor contest\'s lives, 1 when its rules name none, and 1 for any other format', () => {
    expect(survivorLivesOf({ selectionType: SelectionType.SURVIVOR, lives: 2 })).toBe(2);
    expect(survivorLivesOf({ selectionType: SelectionType.SURVIVOR })).toBe(1);
    expect(survivorLivesOf({ selectionType: SelectionType.BRACKET })).toBe(1);
    expect(survivorLivesOf(null)).toBe(1);
  });
});

describe('the retired bracket start round and tiers used', () => {
  it('drops a starting round sent with bracket rules, so every bracket is picked from the first round to the final', () => {
    for (const schema of [ContestRulesSchema, ContestRulesWithEntryLimitSchema]) {
      expect(schema.parse({ selectionType: SelectionType.BRACKET, startsAtRound: 3 })).toEqual({ selectionType: SelectionType.BRACKET });
    }
  });

  it('drops the tiers used sent with tiered rules, so a tiered entry picks from every tier of the event', () => {
    for (const schema of [ContestRulesSchema, ContestRulesWithEntryLimitSchema]) {
      expect(schema.parse({ selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4, tiersUsed: 4 }))
        .toEqual({ selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 });
    }
  });
});
