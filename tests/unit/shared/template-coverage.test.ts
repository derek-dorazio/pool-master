/**
 * Contest template coverage (#2010): which listed slots a template is refused for in each coverage
 * mode, which slots a bracket may list, and the play order of listed slots.
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
  isWeekEvent,
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
    sportLeaguePhaseId: 'postseason',
    phase: LeaguePhase.POSTSEASON,
    matchFormat: MatchFormat.HEAD_TO_HEAD,
    ...overrides,
  };
}

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
