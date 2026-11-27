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
  contestRoundCoverage,
  coveredRoundNumbers,
  playsKnockoutRounds,
  coveredRoundValue,
  coversMatchRound,
  isWeekEvent,
  resolveCoveredSeasonSlots,
  ContestCoverageProblem,
  type CoverableSeasonSlot,
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

    it('accepts one round value for each listed bracket round, the third-place play-off no round of it, and a week no bracket round either', () => {
      expect(templateCoverageProblem(knockout([1, 2, 4, 8, 16]), ROUND_OF_32_TO_FINAL)).toBeNull();
      expect(templateCoverageProblem(knockout([1, 2]), [slot({ key: 'WEEK_1', slotKind: SlotKind.WEEK }), slot({ key: 'SEMIFINAL' }), slot({ key: 'FINAL', slotKind: SlotKind.FINAL })])).toBeNull();
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
      const tiered = { ...allListed, configJson: { scoring: { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL' as const, config: { unplayedRoundToPar: 8 } } } };
      expect(templateCoverageProblem(tiered, ROUND_OF_32_TO_FINAL)).toBeNull();
    });
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

describe('a contest\'s covered rounds (#2014)', () => {
  // A play-in is the event's round 1 (#2184); the template lists the slots of rounds 2 and 3.
  const match = (roundNumber: number, slotDefinitionId: string, slotKind: SlotKind = SlotKind.ROUND_OF_64) => ({ roundNumber, slot: { slotDefinitionId, slotKind } });
  const EVENT = [match(1, 'def-play-in', SlotKind.PLAY_IN), match(2, 'def-round-of-64'), match(2, 'def-round-of-64'), match(3, 'def-final', SlotKind.FINAL)];
  const AFTER_PLAY_IN = { slotDefinitionIds: ['def-round-of-64', 'def-final'] };

  it('covers the rounds whose slot the template lists, lowest first, leaving the play-in out', () => {
    expect(coveredRoundNumbers(AFTER_PLAY_IN, EVENT)).toEqual([2, 3]);
    expect(coversMatchRound(AFTER_PLAY_IN, match(1, 'def-play-in'))).toBe(false);
  });

  it('numbers only the knockout rounds of a soccer tournament a sweepstake covers whole, leaving out its group matchdays and the third-place play-off (#2241)', () => {
    const tournament = [
      match(1, 'def-matchday-1', SlotKind.WEEK), match(2, 'def-matchday-2', SlotKind.WEEK), match(3, 'def-matchday-3', SlotKind.WEEK),
      match(4, 'def-semifinal', SlotKind.SEMIFINAL), match(5, 'def-third-place', SlotKind.THIRD_PLACE), match(6, 'def-final', SlotKind.FINAL),
    ];
    const wholeTournament = { slotDefinitionIds: tournament.map((each) => each.slot.slotDefinitionId) };

    expect(coveredRoundNumbers(wholeTournament, tournament)).toEqual([4, 6]);
    expect(coveredRoundValue([1, 2], coveredRoundNumbers(wholeTournament, tournament), 6)).toBe(2);
  });

  it('plays knockout rounds in every slot kind but a week (a group matchday) and the third-place play-off, a tennis Slam\'s TOURNAMENT slot included (#2241)', () => {
    expect(Object.values(SlotKind).filter((kind) => !playsKnockoutRounds(kind)).sort()).toEqual([SlotKind.THIRD_PLACE, SlotKind.WEEK]);
  });

  it('values a covered round by its place among the covered rounds, and an uncovered or unvalued round at nothing', () => {
    expect([2, 3, 1].map((roundNumber) => coveredRoundValue([1, 4], [2, 3], roundNumber))).toEqual([1, 4, undefined]);
    expect(coveredRoundValue([1], [2, 3], 3)).toBeUndefined();
  });

  it('reads a contest\'s covered slots\' definitions as its coverage', () => {
    expect(contestRoundCoverage({ coveredSlotDefinitionIds: ['def-final'] })).toEqual({ slotDefinitionIds: ['def-final'] });
  });
});

describe('resolveCoveredSeasonSlots: the Season slots a new contest covers (#2014)', () => {
  /** A Season slot of the 2026 Season: its definition, competition and place, and the event covering it. */
  function seasonSlot(id: string, overrides: Partial<CoverableSeasonSlot> = {}): CoverableSeasonSlot {
    return {
      id,
      slotDefinitionId: `definition-${id}`,
      seasonCompetitionId: 'season-postseason',
      sportEventId: 'playoffs',
      isTestData: false,
      phase: LeaguePhase.POSTSEASON,
      competitionOrderIndex: 1,
      slotKind: SlotKind.QUARTERFINAL,
      weekNumber: null,
      key: id,
      ...overrides,
    };
  }
  const week = (n: number, overrides: Partial<CoverableSeasonSlot> = {}) => seasonSlot(`week-${String(n)}`, {
    seasonCompetitionId: 'season-regular', sportEventId: `week-event-${String(n)}`, phase: LeaguePhase.REGULAR,
    competitionOrderIndex: 0, slotKind: SlotKind.WEEK, weekNumber: n, ...overrides,
  });
  const playIn = seasonSlot('play-in', { slotKind: SlotKind.PLAY_IN });
  const quarters = seasonSlot('quarters');
  const semis = seasonSlot('semis', { slotKind: SlotKind.SEMIFINAL });
  const final = seasonSlot('final', { slotKind: SlotKind.FINAL });
  const playoffs = [final, playIn, semis, quarters];
  const listing = (...slots: CoverableSeasonSlot[]) => slots.map((each) => each.slotDefinitionId);

  it('covers every listed slot of the chosen event under ALL_LISTED, in play order, leaving the play-in out', () => {
    expect(resolveCoveredSeasonSlots(
      { coverageMode: TemplateCoverageMode.ALL_LISTED, slotDefinitionIds: listing(quarters, semis, final) },
      { sportEventIds: ['playoffs'], seasonSlots: playoffs },
    )).toEqual({ seasonSlotIds: ['quarters', 'semis', 'final'] });
  });

  it('covers the one listed slot of the chosen event under ONE_SLOT, or the chosen one when the event has several', () => {
    const oneSlot = { coverageMode: TemplateCoverageMode.ONE_SLOT, slotDefinitionIds: listing(final) };
    expect(resolveCoveredSeasonSlots(oneSlot, { sportEventIds: ['playoffs'], seasonSlots: playoffs })).toEqual({ seasonSlotIds: ['final'] });

    const eachRound = { coverageMode: TemplateCoverageMode.ONE_SLOT, slotDefinitionIds: listing(quarters, semis, final) };
    expect(resolveCoveredSeasonSlots(eachRound, { sportEventIds: ['playoffs'], seasonSlots: playoffs, startingSlotId: 'semis' })).toEqual({ seasonSlotIds: ['semis'] });
  });

  it('refuses ONE_SLOT on an event with several listed slots and none chosen, with SLOT_NOT_CHOSEN', () => {
    expect(resolveCoveredSeasonSlots(
      { coverageMode: TemplateCoverageMode.ONE_SLOT, slotDefinitionIds: listing(quarters, semis) },
      { sportEventIds: ['playoffs'], seasonSlots: playoffs },
    )).toEqual({ problem: ContestCoverageProblem.SLOT_NOT_CHOSEN });
  });

  it('refuses an event with none of the listed slots with NO_LISTED_SLOT, and a starting slot the template does not list or the event does not hold with SLOT_NOT_COVERABLE', () => {
    const allListed = { coverageMode: TemplateCoverageMode.ALL_LISTED, slotDefinitionIds: listing(semis, final) };
    expect(resolveCoveredSeasonSlots(allListed, { sportEventIds: ['week-event-1'], seasonSlots: [...playoffs, week(1)] })).toEqual({ problem: ContestCoverageProblem.NO_LISTED_SLOT });

    const oneSlot = { coverageMode: TemplateCoverageMode.ONE_SLOT, slotDefinitionIds: listing(semis, final) };
    expect(resolveCoveredSeasonSlots(oneSlot, { sportEventIds: ['playoffs'], seasonSlots: playoffs, startingSlotId: 'play-in' })).toEqual({ problem: ContestCoverageProblem.SLOT_NOT_COVERABLE });
    expect(resolveCoveredSeasonSlots(oneSlot, { sportEventIds: ['week-event-1'], seasonSlots: [...playoffs, week(1)], startingSlotId: 'final' })).toEqual({ problem: ContestCoverageProblem.SLOT_NOT_COVERABLE });
  });

  it('covers the starting week and every later listed week of the Season under FROM_SLOT, across their events', () => {
    const weeks = [week(3), week(1), week(2), week(4, { slotDefinitionId: 'unlisted' })];
    expect(resolveCoveredSeasonSlots(
      { coverageMode: TemplateCoverageMode.FROM_SLOT, slotDefinitionIds: listing(week(1), week(2), week(3)) },
      { sportEventIds: ['week-event-2'], seasonSlots: weeks },
    )).toEqual({ seasonSlotIds: ['week-2', 'week-3'] });
  });

  it('stops FROM_SLOT at its starting slot\'s competition: a survivor from the last regular week covers no postseason slot', () => {
    const lastWeek = week(18);
    const wildCard = seasonSlot('wild-card', { slotDefinitionId: 'definition-wild-card' });
    expect(resolveCoveredSeasonSlots(
      { coverageMode: TemplateCoverageMode.FROM_SLOT, slotDefinitionIds: [lastWeek.slotDefinitionId, wildCard.slotDefinitionId] },
      { sportEventIds: ['week-event-18'], seasonSlots: [lastWeek, wildCard] },
    )).toEqual({ seasonSlotIds: ['week-18'] });
  });

  it('stops FROM_SLOT before the next competition of the same phase: a survivor from a playoff round covers no bowl after it', () => {
    const cfpSemis = seasonSlot('cfp-semis', { seasonCompetitionId: 'season-cfp', sportEventId: 'cfp', competitionOrderIndex: 1, slotKind: SlotKind.SEMIFINAL });
    const cfpFinal = seasonSlot('cfp-final', { seasonCompetitionId: 'season-cfp', sportEventId: 'cfp', competitionOrderIndex: 1, slotKind: SlotKind.FINAL });
    const lateBowl = seasonSlot('late-bowl', { seasonCompetitionId: 'season-bowls', sportEventId: 'bowl', competitionOrderIndex: 2, slotKind: SlotKind.FINAL });
    expect(resolveCoveredSeasonSlots(
      { coverageMode: TemplateCoverageMode.FROM_SLOT, slotDefinitionIds: listing(cfpSemis, cfpFinal, lateBowl) },
      { sportEventIds: ['cfp'], seasonSlots: [lateBowl, cfpFinal, cfpSemis] },
    )).toEqual({ seasonSlotIds: ['cfp-semis', 'cfp-final'] });
  });

  it('covers a later listed slot under FROM_SLOT before any event holds it, so a survivor covers weeks not yet synced', () => {
    const weeks = [week(1), week(2, { sportEventId: null })];
    expect(resolveCoveredSeasonSlots(
      { coverageMode: TemplateCoverageMode.FROM_SLOT, slotDefinitionIds: listing(week(1), week(2)) },
      { sportEventIds: ['week-event-1'], seasonSlots: weeks },
    )).toEqual({ seasonSlotIds: ['week-1', 'week-2'] });
  });

  it('keeps FROM_SLOT to slots of its starting slot\'s kind: a synced survivor covers no test slot of the same definition', () => {
    const testWeek = week(2, { id: 'test-week-2', sportEventId: 'test-event', isTestData: true });
    expect(resolveCoveredSeasonSlots(
      { coverageMode: TemplateCoverageMode.FROM_SLOT, slotDefinitionIds: listing(week(1), week(2)) },
      { sportEventIds: ['week-event-1'], seasonSlots: [week(1), week(2), testWeek] },
    )).toEqual({ seasonSlotIds: ['week-1', 'week-2'] });
  });
});
