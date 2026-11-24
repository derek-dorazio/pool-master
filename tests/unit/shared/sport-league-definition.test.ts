import {
  contestTemplateEventTypeOf,
  eventPlaysMatches,
  eventSportDefinition,
  getSportDefinition,
  ParticipantType,
  ScoringFamily,
  Sport,
  sportLeagueDefinitionOf,
} from '@poolmaster/shared/domain';

// A sport league's definition (#934): its sport's, with the participant type the league sets.

describe('sportLeagueDefinitionOf', () => {
  it('gives a sport league with no overrides its sport\'s definition, unchanged', () => {
    expect(sportLeagueDefinitionOf(Sport.BASEBALL, { participantType: null, scoringFamily: null })).toBe(getSportDefinition(Sport.BASEBALL));
  });

  it('keeps the sport\'s scoring for a league that sets only its participant type', () => {
    const definition = sportLeagueDefinitionOf(Sport.GOLF, { participantType: ParticipantType.TEAM, scoringFamily: null });

    expect([definition.participantType, definition.scoringFamily, definition.scoringDefinitions])
      .toEqual([ParticipantType.TEAM, ScoringFamily.STROKE_PLAY, ['GOLF_RELATIVE_TO_PAR_TOTAL']]);
  });

  it('keeps the sport\'s definition for a league that names its sport\'s own family', () => {
    expect(sportLeagueDefinitionOf(Sport.BASEBALL, { participantType: null, scoringFamily: ScoringFamily.HEAD_TO_HEAD })).toBe(getSportDefinition(Sport.BASEBALL));
  });

  it('refuses any family a sport is not scored by, as a broken reference row', () => {
    expect(() => sportLeagueDefinitionOf(Sport.GOLF, { participantType: null, scoringFamily: ScoringFamily.HEAD_TO_HEAD }))
      .toThrow('A GOLF sport league cannot be scored by HEAD_TO_HEAD');
    expect(() => sportLeagueDefinitionOf(Sport.BASEBALL, { participantType: null, scoringFamily: ScoringFamily.STROKE_PLAY }))
      .toThrow('A BASEBALL sport league cannot be scored by STROKE_PLAY');
  });
});

describe('An event read through its sport league', () => {
  it('reads its sport\'s definition, with the participant type the event carries', () => {
    expect(eventSportDefinition({ sport: Sport.BASEBALL })).toBe(getSportDefinition(Sport.BASEBALL));
    expect(eventSportDefinition({ sport: Sport.GOLF, participantType: ParticipantType.TEAM }).participantType).toBe(ParticipantType.TEAM);
  });

  it('plays matches when its sport does, and is the kind of match event its sport\'s format names', () => {
    expect([eventPlaysMatches({ sport: Sport.BASEBALL }), eventPlaysMatches({ sport: Sport.GOLF })]).toEqual([true, false]);
    expect(contestTemplateEventTypeOf({ sport: Sport.BASEBALL, rounds: 4 })).toBe('KNOCKOUT');
  });
});
