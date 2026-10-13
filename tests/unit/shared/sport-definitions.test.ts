import {
  PARTICIPANT_SCORING_DEFINITIONS,
  SPORT_DEFINITIONS,
  ScoringFamily,
  SelectionType,
  Sport,
  type SportDefinition,
  getDefaultTournamentFormatForSport,
  getSportDefinition,
  getValidContestFormatsForTournamentFormat,
  sportAllowsSelectionType,
} from '@poolmaster/shared/domain';
import { getSelectionEngine } from '../../../packages/core-api/src/modules/selections/selection-engines/registry';

// The registry conformance suite (#602): every sport definition is checked here, so a sport
// added to the registry gets these checks without anyone writing them.

const definitions = Object.values(SPORT_DEFINITIONS);

describe.each(definitions.map((definition) => [definition.sport, definition] as const))('sport definition %s', (sport, definition) => {
  it('is registered under its own sport, and getSportDefinition returns it', () => {
    expect(SPORT_DEFINITIONS[sport].sport).toBe(sport);
    expect(getSportDefinition(sport)).toBe(definition);
  });

  it('allows only selection types that have an engine, each listed once', () => {
    expect(new Set(definition.selectionTypes).size).toBe(definition.selectionTypes.length);
    for (const selectionType of definition.selectionTypes) {
      expect(getSelectionEngine(selectionType).selectionType).toBe(selectionType);
    }
  });

  it('ranks only by scoring definitions that are declared with a direction', () => {
    for (const id of definition.scoringDefinitions) {
      expect(PARTICIPANT_SCORING_DEFINITIONS[id].direction).toMatch(/^(LOWER|HIGHER)_IS_BETTER$/);
    }
  });

  it('names a known scoring family, and a tournament format that admits at least one contest format', () => {
    expect(Object.values(ScoringFamily)).toContain(definition.scoringFamily);
    expect(getDefaultTournamentFormatForSport(sport)).toBe(definition.tournamentFormat);
    expect(getValidContestFormatsForTournamentFormat(definition.tournamentFormat).length).toBeGreaterThan(0);
  });

  it('gives a new event at least one round and at least one tier of at least one participant', () => {
    const { tierCount, tierSize } = definition.defaultTierLayout;

    for (const count of [definition.defaultRounds, tierCount, tierSize]) {
      expect(Number.isInteger(count) && count >= 1).toBe(true);
    }
  });

  it('has every vocabulary word filled in', () => {
    const { participant, round, eliminated, eventStart } = definition.vocabulary;
    for (const word of [participant.one, participant.many, round.one, round.many, eliminated, eventStart]) {
      expect(word.trim()).not.toBe('');
    }
  });

  it('labels every round of an eight-round event, each one differently', () => {
    const labels = Array.from({ length: 8 }, (_, index) => definition.roundLabel(index + 1, 8));

    expect(labels.every((label) => label.trim() !== '')).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('sport registry', () => {
  it('has a definition for every sport in the enum', () => {
    expect(Object.keys(SPORT_DEFINITIONS).sort()).toEqual(Object.values(Sport).sort());
  });

  it('labels golf rounds by number and calls an eliminated golfer Cut', () => {
    const golf = getSportDefinition(Sport.GOLF);

    expect(golf.roundLabel(2, 4)).toBe('Round 2');
    expect(golf.vocabulary.eliminated).toBe('Cut');
    expect(golf.scoringFamily).toBe(ScoringFamily.STROKE_PLAY);
  });

  it('gives a new golf event four rounds and six tiers of ten golfers', () => {
    const golf = getSportDefinition(Sport.GOLF);

    expect(golf.defaultRounds).toBe(4);
    expect(golf.defaultTierLayout).toEqual({ tierCount: 6, tierSize: 10 });
  });
});

describe('sportAllowsSelectionType', () => {
  it('refuses a selection type the sport definition does not list, and allows one it does', () => {
    const tieredOnly: SportDefinition = { ...getSportDefinition(Sport.GOLF), selectionTypes: [SelectionType.TIERED] };

    expect(sportAllowsSelectionType(tieredOnly, SelectionType.BUDGET_PICK)).toBe(false);
    expect(sportAllowsSelectionType(tieredOnly, SelectionType.TIERED)).toBe(true);
  });
});
