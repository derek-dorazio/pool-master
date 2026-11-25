/**
 * Contest template coverage (#2010): which Season slots a contest from a template covers in each
 * coverage mode, which listed slots a template is refused for, and play order of listed slots.
 */
import { expect } from '@jest/globals';
import {
  LeaguePhase,
  MatchFormat,
  SelectionType,
  SlotKind,
  TemplateCoverageMode,
  TemplateCoverageProblem,
  compareCoveredSlots,
  coveredSeasonSlots,
  isBracketSlot,
  isWeekEvent,
  templateCoverageProblem,
  type ContestTemplateSlot,
  type CoverageSeasonSlot,
} from '@poolmaster/shared/domain';

/** A Season's slots: weeks 1 to 3 of one event each, then a playoff event covering two rounds. */
const SEASON: CoverageSeasonSlot[] = [
  { id: 'week-1-2026', sportLeaguePhaseSlotId: 'week-1', sportEventId: 'event-week-1' },
  { id: 'week-2-2026', sportLeaguePhaseSlotId: 'week-2', sportEventId: 'event-week-2' },
  { id: 'week-3-2026', sportLeaguePhaseSlotId: 'week-3', sportEventId: null },
  { id: 'semifinal-2026', sportLeaguePhaseSlotId: 'semifinal', sportEventId: 'event-playoffs' },
  { id: 'final-2026', sportLeaguePhaseSlotId: 'final', sportEventId: 'event-playoffs' },
];
const ids = (slots: CoverageSeasonSlot[]) => slots.map((slot) => slot.id);

function slot(overrides: Partial<ContestTemplateSlot> = {}): ContestTemplateSlot {
  return {
    id: 'definition',
    key: 'SEMIFINAL',
    name: null,
    slotKind: SlotKind.SEMIFINAL,
    weekNumber: null,
    sportLeaguePhaseId: 'postseason',
    phase: LeaguePhase.POSTSEASON,
    matchFormat: MatchFormat.HEAD_TO_HEAD,
    ...overrides,
  };
}

describe('coveredSeasonSlots', () => {
  it('covers only the chosen slot for ONE_SLOT, and nothing when the template does not list it', () => {
    expect(ids(coveredSeasonSlots(['week-1', 'week-2'], SEASON, { coverageMode: TemplateCoverageMode.ONE_SLOT, seasonSlotId: 'week-2-2026' }))).toEqual(['week-2-2026']);
    expect(coveredSeasonSlots(['week-1'], SEASON, { coverageMode: TemplateCoverageMode.ONE_SLOT, seasonSlotId: 'week-2-2026' })).toEqual([]);
  });

  it("covers the chosen event's listed slots for ALL_LISTED, leaving out its slots the template does not list", () => {
    expect(ids(coveredSeasonSlots(['semifinal', 'final'], SEASON, { coverageMode: TemplateCoverageMode.ALL_LISTED, sportEventId: 'event-playoffs' }))).toEqual(['semifinal-2026', 'final-2026']);
    expect(ids(coveredSeasonSlots(['final'], SEASON, { coverageMode: TemplateCoverageMode.ALL_LISTED, sportEventId: 'event-playoffs' }))).toEqual(['final-2026']);
  });

  it('covers the starting slot and every later listed one for FROM_SLOT, slots with no event yet included, and nothing from an unlisted start', () => {
    const listed = ['week-1', 'week-2', 'week-3', 'final'];

    expect(ids(coveredSeasonSlots(listed, SEASON, { coverageMode: TemplateCoverageMode.FROM_SLOT, startingSeasonSlotId: 'week-2-2026' }))).toEqual(['week-2-2026', 'week-3-2026', 'final-2026']);
    expect(coveredSeasonSlots(listed, SEASON, { coverageMode: TemplateCoverageMode.FROM_SLOT, startingSeasonSlotId: 'semifinal-2026' })).toEqual([]);
  });
});

describe('templateCoverageProblem', () => {
  const allListed = { coverageMode: TemplateCoverageMode.ALL_LISTED, selectionType: SelectionType.TIERED };

  it("accepts ALL_LISTED over one phase's knockout rounds, and a single tournament", () => {
    expect(templateCoverageProblem(allListed, [slot(), slot({ slotKind: SlotKind.FINAL, key: 'FINAL' })])).toBeNull();
    expect(templateCoverageProblem(allListed, [slot({ slotKind: SlotKind.TOURNAMENT, phase: LeaguePhase.REGULAR, sportLeaguePhaseId: 'regular' })])).toBeNull();
  });

  it('refuses ALL_LISTED over two phases, or two tournaments, as one contest covers one event', () => {
    expect(templateCoverageProblem(allListed, [slot(), slot({ sportLeaguePhaseId: 'regular', phase: LeaguePhase.REGULAR })])).toBe(TemplateCoverageProblem.ALL_LISTED_SPANS_EVENTS);
    const tournament = slot({ slotKind: SlotKind.TOURNAMENT, phase: LeaguePhase.REGULAR, sportLeaguePhaseId: 'regular' });
    expect(templateCoverageProblem(allListed, [tournament, { ...tournament, key: 'OPEN' }])).toBe(TemplateCoverageProblem.ALL_LISTED_SPANS_EVENTS);
  });

  it('lets ONE_SLOT and FROM_SLOT list slots across phases', () => {
    const acrossPhases = [slot({ slotKind: SlotKind.WEEK, phase: LeaguePhase.REGULAR, sportLeaguePhaseId: 'regular' }), slot()];

    expect(templateCoverageProblem({ coverageMode: TemplateCoverageMode.ONE_SLOT, selectionType: SelectionType.PICK_EM }, acrossPhases)).toBeNull();
    expect(templateCoverageProblem({ coverageMode: TemplateCoverageMode.FROM_SLOT, selectionType: SelectionType.SURVIVOR }, acrossPhases)).toBeNull();
  });

  it('refuses a bracket listing a week of games or a field slot, and accepts one over knockout rounds of any phase', () => {
    const bracket = { coverageMode: TemplateCoverageMode.ONE_SLOT, selectionType: SelectionType.BRACKET };

    expect(templateCoverageProblem(bracket, [slot({ slotKind: SlotKind.WEEK })])).toBe(TemplateCoverageProblem.BRACKET_OUTSIDE_KNOCKOUT);
    expect(templateCoverageProblem(bracket, [slot({ slotKind: SlotKind.TOURNAMENT, matchFormat: MatchFormat.FIELD })])).toBe(TemplateCoverageProblem.BRACKET_OUTSIDE_KNOCKOUT);
    expect(templateCoverageProblem(bracket, [slot({ slotKind: SlotKind.TOURNAMENT, phase: LeaguePhase.REGULAR })])).toBeNull();
  });
});

describe('isBracketSlot', () => {
  it('takes a head-to-head slot that is not a week, whatever its phase, so a tennis Slam in the regular season fits', () => {
    expect(isBracketSlot(slot({ slotKind: SlotKind.TOURNAMENT, phase: LeaguePhase.REGULAR }))).toBe(true);
    expect(isBracketSlot(slot({ slotKind: SlotKind.WEEK }))).toBe(false);
    expect(isBracketSlot(slot({ matchFormat: MatchFormat.FIELD }))).toBe(false);
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
});
