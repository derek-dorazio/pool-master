/**
 * Contest template coverage (#2010, #2153): which listed slots a template is refused for in each
 * coverage mode, which slots a bracket may list, and the play order of listed slots.
 */
import { expect } from '@jest/globals';
import {
  LeaguePhase,
  MatchFormat,
  SelectionType,
  SlotKind,
  TemplateCoverageMode,
  TemplateCoverageProblem,
  UpsetBonusRule,
  compareCoveredSlots,
  isBracketRoundSlot,
  isWeekEvent,
  templateBracketRounds,
  templateCoverageProblem,
  type ContestTemplateSlot,
} from '@poolmaster/shared/domain';

function slot(overrides: Partial<ContestTemplateSlot> = {}): ContestTemplateSlot {
  return {
    id: 'definition',
    key: 'SEMIFINAL',
    name: null,
    slotKind: SlotKind.SEMIFINAL,
    weekNumber: null,
    sportLeagueCompetitionId: 'postseason',
    competitionCode: 'POSTSEASON',
    competitionOrderIndex: 1,
    phase: LeaguePhase.POSTSEASON,
    matchFormat: MatchFormat.HEAD_TO_HEAD,
    ...overrides,
  };
}

/** A slot of the regular season's one competition. */
const regular = (overrides: Partial<ContestTemplateSlot> = {}) =>
  slot({ phase: LeaguePhase.REGULAR, sportLeagueCompetitionId: 'regular', competitionCode: 'REGULAR', ...overrides });

describe('templateCoverageProblem', () => {
  const allListed = { coverageMode: TemplateCoverageMode.ALL_LISTED, selectionType: SelectionType.TIERED, configJson: {} };
  const fromSlot = { coverageMode: TemplateCoverageMode.FROM_SLOT, selectionType: SelectionType.SURVIVOR, configJson: {} };
  const oneSlot = { coverageMode: TemplateCoverageMode.ONE_SLOT, selectionType: SelectionType.PICK_EM, configJson: {} };

  it("accepts ALL_LISTED over one competition's knockout rounds, and a single tournament", () => {
    expect(templateCoverageProblem(allListed, [slot(), slot({ slotKind: SlotKind.FINAL, key: 'FINAL' })])).toBeNull();
    expect(templateCoverageProblem(allListed, [regular({ slotKind: SlotKind.TOURNAMENT })])).toBeNull();
  });

  it('refuses ALL_LISTED and FROM_SLOT over two competitions with SPANS_COMPETITIONS, as no contest crosses competitions', () => {
    const acrossCompetitions = [regular({ slotKind: SlotKind.WEEK, weekNumber: 18 }), slot()];
    // Two competitions of one phase, as a postseason with bowls and a playoff has.
    const samePhase = [slot({ sportLeagueCompetitionId: 'bowls', competitionCode: 'BOWLS' }), slot({ sportLeagueCompetitionId: 'cfp', competitionCode: 'CFP', competitionOrderIndex: 2 })];

    expect(templateCoverageProblem(allListed, acrossCompetitions)).toBe(TemplateCoverageProblem.SPANS_COMPETITIONS);
    expect(templateCoverageProblem(fromSlot, acrossCompetitions)).toBe(TemplateCoverageProblem.SPANS_COMPETITIONS);
    expect(templateCoverageProblem(allListed, samePhase)).toBe(TemplateCoverageProblem.SPANS_COMPETITIONS);
    expect(templateCoverageProblem(fromSlot, samePhase)).toBe(TemplateCoverageProblem.SPANS_COMPETITIONS);
  });

  it('accepts FROM_SLOT over the weeks of one competition', () => {
    expect(templateCoverageProblem(fromSlot, [regular({ slotKind: SlotKind.WEEK, weekNumber: 1 }), regular({ slotKind: SlotKind.WEEK, weekNumber: 2, key: 'WEEK_2' })])).toBeNull();
  });

  it('lets ONE_SLOT list slots of several competitions, since each of its contests covers a single slot', () => {
    expect(templateCoverageProblem(oneSlot, [regular({ slotKind: SlotKind.WEEK }), slot()])).toBeNull();
  });

  it('refuses ALL_LISTED over two tournaments, as one contest covers one event', () => {
    const tournament = regular({ slotKind: SlotKind.TOURNAMENT });
    expect(templateCoverageProblem(allListed, [tournament, { ...tournament, key: 'OPEN' }])).toBe(TemplateCoverageProblem.ALL_LISTED_SPANS_EVENTS);
  });

  it('refuses a bracket listing a week of games or a field slot, and accepts one over knockout rounds of any phase', () => {
    const bracket = { coverageMode: TemplateCoverageMode.ONE_SLOT, selectionType: SelectionType.BRACKET, configJson: {} };

    expect(templateCoverageProblem(bracket, [slot({ slotKind: SlotKind.WEEK })])).toBe(TemplateCoverageProblem.BRACKET_OUTSIDE_KNOCKOUT);
    expect(templateCoverageProblem(bracket, [slot({ slotKind: SlotKind.TOURNAMENT, matchFormat: MatchFormat.FIELD })])).toBe(TemplateCoverageProblem.BRACKET_OUTSIDE_KNOCKOUT);
    expect(templateCoverageProblem(bracket, [regular({ slotKind: SlotKind.TOURNAMENT })])).toBeNull();
  });

  describe('knockout round values', () => {
    const knockout = (roundValues: number[], coverageMode: TemplateCoverageMode = TemplateCoverageMode.ALL_LISTED) => ({
      coverageMode,
      selectionType: SelectionType.RANDOM_DRAW,
      configJson: { scoring: { participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS' as const, config: { roundValues, upsetBonus: { rule: UpsetBonusRule.NONE } } } },
    });
    const ROUND_OF_32_TO_FINAL = [
      slot({ key: 'ROUND_OF_32', slotKind: SlotKind.ROUND_OF_32 }),
      slot({ key: 'ROUND_OF_16', slotKind: SlotKind.ROUND_OF_16 }),
      slot({ key: 'QUARTERFINAL', slotKind: SlotKind.QUARTERFINAL }),
      slot({ key: 'SEMIFINAL', slotKind: SlotKind.SEMIFINAL }),
      slot({ key: 'THIRD_PLACE', slotKind: SlotKind.THIRD_PLACE }),
      slot({ key: 'FINAL', slotKind: SlotKind.FINAL }),
    ];

    it('accepts one round value for each listed bracket round, the third-place play-off no round of it', () => {
      expect(templateCoverageProblem(knockout([1, 2, 4, 8, 16]), ROUND_OF_32_TO_FINAL)).toBeNull();
    });

    it('refuses with ROUND_VALUES_MISMATCH a table one round short, which would score the final nothing, or one round long', () => {
      expect(templateCoverageProblem(knockout([1, 2, 4, 8]), ROUND_OF_32_TO_FINAL)).toBe(TemplateCoverageProblem.ROUND_VALUES_MISMATCH);
      expect(templateCoverageProblem(knockout([1, 2, 4, 8, 16, 32]), ROUND_OF_32_TO_FINAL)).toBe(TemplateCoverageProblem.ROUND_VALUES_MISMATCH);
    });

    it('leaves the round values of a template on one slot at a time, or on a tournament, to the event, whose rounds its slots do not show', () => {
      expect(templateCoverageProblem(knockout([1, 2], TemplateCoverageMode.ONE_SLOT), ROUND_OF_32_TO_FINAL)).toBeNull();
      expect(templateCoverageProblem(knockout([1, 2, 4, 8, 16, 32, 64]), [regular({ slotKind: SlotKind.TOURNAMENT })])).toBeNull();
    });

    it('holds a template scored by another definition to no round count', () => {
      const tiered = { ...allListed, configJson: { scoring: { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL' as const, config: {} } } };
      expect(templateCoverageProblem(tiered, ROUND_OF_32_TO_FINAL)).toBeNull();
    });
  });
});

describe('templateBracketRounds', () => {
  it('lists the bracket rounds of a template covering all its slots, in their order, without the third-place play-off or a week', () => {
    const slots = [slot({ key: 'SEMIFINAL' }), slot({ key: 'THIRD_PLACE', slotKind: SlotKind.THIRD_PLACE }), slot({ key: 'FINAL', slotKind: SlotKind.FINAL })];

    expect(templateBracketRounds({ coverageMode: TemplateCoverageMode.ALL_LISTED }, slots)?.map((each) => each.key)).toEqual(['SEMIFINAL', 'FINAL']);
    expect(isBracketRoundSlot(regular({ slotKind: SlotKind.WEEK }))).toBe(false);
  });

  it('shows no rounds for a template on one slot at a time or on a tournament', () => {
    expect(templateBracketRounds({ coverageMode: TemplateCoverageMode.FROM_SLOT }, [slot()])).toBeNull();
    expect(templateBracketRounds({ coverageMode: TemplateCoverageMode.ALL_LISTED }, [regular({ slotKind: SlotKind.TOURNAMENT })])).toBeNull();
  });
});

describe('isWeekEvent', () => {
  it('calls an event a week of games only when it has slots and every one is a WEEK slot', () => {
    expect(isWeekEvent({ slotDefinitions: [{ slotKind: SlotKind.WEEK }] })).toBe(true);
    expect(isWeekEvent({ slotDefinitions: [{ slotKind: SlotKind.WEEK }, { slotKind: SlotKind.FINAL }] })).toBe(false);
    expect(isWeekEvent({ slotDefinitions: [] })).toBe(false);
  });
});

describe('compareCoveredSlots', () => {
  it('orders listed slots by phase as a Season plays them, then weeks by number, then the knockout rounds', () => {
    const slots = [
      slot({ key: 'FINAL', slotKind: SlotKind.FINAL }),
      slot({ key: 'WEEK_2', slotKind: SlotKind.WEEK, weekNumber: 2, phase: LeaguePhase.REGULAR }),
      slot({ key: 'SEMIFINAL' }),
      slot({ key: 'WEEK_10', slotKind: SlotKind.WEEK, weekNumber: 10, phase: LeaguePhase.REGULAR }),
      slot({ key: 'PRESEASON_1', slotKind: SlotKind.WEEK, weekNumber: 1, phase: LeaguePhase.PRESEASON }),
    ];

    expect([...slots].sort(compareCoveredSlots).map((each) => each.key)).toEqual(['PRESEASON_1', 'WEEK_2', 'WEEK_10', 'SEMIFINAL', 'FINAL']);
  });

  it('orders the competitions of one phase by their order before the slots within each, so a playoff after the bowls comes after every bowl', () => {
    const bowls = { sportLeagueCompetitionId: 'bowls', competitionCode: 'BOWLS', competitionOrderIndex: 1 };
    const cfp = { sportLeagueCompetitionId: 'cfp', competitionCode: 'CFP', competitionOrderIndex: 2 };
    const slots = [
      slot({ ...cfp, key: 'ROUND_OF_16', slotKind: SlotKind.ROUND_OF_16 }),
      slot({ ...bowls, key: 'BOWL_FINAL', slotKind: SlotKind.FINAL }),
      slot({ ...cfp, key: 'FINAL', slotKind: SlotKind.FINAL }),
      slot({ ...bowls, key: 'BOWL_SEMI', slotKind: SlotKind.SEMIFINAL }),
    ];

    expect([...slots].sort(compareCoveredSlots).map((each) => each.key)).toEqual(['BOWL_SEMI', 'BOWL_FINAL', 'ROUND_OF_16', 'FINAL']);
  });
});
