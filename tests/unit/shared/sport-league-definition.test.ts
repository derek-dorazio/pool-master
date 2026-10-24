import {
  ParticipantType,
  ScoringFamily,
  SelectionType,
  Sport,
  TournamentFormat,
  contestTemplateEventTypeOf,
  eventPlaysMatches,
  eventSportDefinition,
  getSportDefinition,
  sportLeagueDefinitionOf,
} from '@poolmaster/shared/domain';

// A sport league's definition (#934): its sport's, unless the league plays its sport's stat pool,
// a field of players scored by the composite family in golf's shape.

describe('sportLeagueDefinitionOf', () => {
  it('gives a sport league with no overrides its sport\'s definition, unchanged', () => {
    expect(sportLeagueDefinitionOf(Sport.BASEBALL, { participantType: null, scoringFamily: null })).toBe(getSportDefinition(Sport.BASEBALL));
  });

  it('keeps the sport\'s scoring for a league that sets only its participant type', () => {
    const definition = sportLeagueDefinitionOf(Sport.GOLF, { participantType: ParticipantType.TEAM, scoringFamily: null });

    expect([definition.participantType, definition.scoringFamily, definition.scoringDefinitions])
      .toEqual([ParticipantType.TEAM, ScoringFamily.STROKE_PLAY, ['GOLF_RELATIVE_TO_PAR_TOTAL']]);
  });

  it('plays a composite league of a team sport as its stat pool: players, roster formats only, the composite total, no matches, games for rounds', () => {
    const worldSeries = sportLeagueDefinitionOf(Sport.BASEBALL, { participantType: ParticipantType.INDIVIDUAL, scoringFamily: ScoringFamily.COMPOSITE });

    expect(worldSeries).toMatchObject({
      sport: Sport.BASEBALL,
      participantType: ParticipantType.INDIVIDUAL,
      scoringFamily: ScoringFamily.COMPOSITE,
      tournamentFormat: TournamentFormat.STROKE_PLAY_TOURNAMENT,
      defaultRounds: 7,
      defaultTierLayout: { tierCount: 6 },
      selectionTypes: [SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW],
      scoringDefinitions: ['COMPOSITE_TOTAL'],
      shootout: null,
      vocabulary: { participant: { one: 'player', many: 'players' }, round: { one: 'game', many: 'games' }, eventStart: 'first pitch' },
    });
    expect(worldSeries.composite?.name).toBe('Box Score');
    expect(worldSeries.matchPeriodLayout).toBeUndefined();
    expect(worldSeries.roundLabel(3, 7)).toBe('Game 3');
  });

  it('schedules an NFL stat pool event for one game, its week\'s', () => {
    expect(sportLeagueDefinitionOf(Sport.AMERICAN_FOOTBALL, { participantType: null, scoringFamily: ScoringFamily.COMPOSITE }).defaultRounds).toBe(1);
  });

  it('refuses a composite league of a sport with no composite, and any other family a sport is not scored by', () => {
    expect(() => sportLeagueDefinitionOf(Sport.GOLF, { participantType: null, scoringFamily: ScoringFamily.COMPOSITE }))
      .toThrow('A GOLF sport league cannot be scored by COMPOSITE');
    expect(() => sportLeagueDefinitionOf(Sport.BASEBALL, { participantType: null, scoringFamily: ScoringFamily.STROKE_PLAY }))
      .toThrow('A BASEBALL sport league cannot be scored by STROKE_PLAY');
  });
});

describe('An event read through its sport league', () => {
  const worldSeriesGame = { sport: Sport.BASEBALL, participantType: ParticipantType.INDIVIDUAL, scoringFamily: ScoringFamily.COMPOSITE };

  it('plays no matches in a stat pool, though its sport\'s other leagues play a bracket', () => {
    expect([eventPlaysMatches(worldSeriesGame), eventPlaysMatches({ sport: Sport.BASEBALL })]).toEqual([false, true]);
    expect(eventSportDefinition(worldSeriesGame).scoringFamily).toBe(ScoringFamily.COMPOSITE);
  });

  it('is no kind of match event for a template, so a stat pool takes templates that name no kind of event', () => {
    expect(contestTemplateEventTypeOf({ ...worldSeriesGame, rounds: 7 })).toBeNull();
    expect(contestTemplateEventTypeOf({ sport: Sport.BASEBALL, rounds: 4 })).toBe('KNOCKOUT');
  });
});
