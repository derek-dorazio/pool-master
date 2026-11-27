import {
  ContestStatus,
  ContestFormat,
  eventPlaysMatches,
  formatParticipantStatusLabel,
  isContestFormatValidForEvent,
  isLeaguePlayValid,
  LEAGUE_PLAY_BY_SCORING_FAMILY,
  MatchFormat,
  ParticipantType,
  ScoringFamily,
} from '@poolmaster/shared/domain';

describe('Contest validity by whether the event plays matches', () => {
  it.each([
    [true, ContestFormat.ROSTER, true],
    [true, ContestFormat.PREDICTION, true],
    [true, ContestFormat.SQUARES, true],
    [false, ContestFormat.ROSTER, true],
    [false, ContestFormat.PREDICTION, false],
    [false, ContestFormat.SQUARES, false],
  ])('an event that plays matches: %s takes a %s contest: %s', (playsMatches, contestFormat, valid) => {
    expect(isContestFormatValidForEvent(playsMatches, contestFormat)).toBe(valid);
  });
});

describe('Whether an event plays matches', () => {
  const slot = (matchFormat: MatchFormat) => ({ matchFormat });

  it('reads an event with a HEAD_TO_HEAD slot as playing matches, even beside a FIELD one', () => {
    expect(eventPlaysMatches({ slotDefinitions: [slot(MatchFormat.FIELD), slot(MatchFormat.HEAD_TO_HEAD)] })).toBe(true);
  });

  it('reads an event whose slots are all FIELD, a golf tournament or a race, as playing none', () => {
    expect(eventPlaysMatches({ slotDefinitions: [slot(MatchFormat.FIELD)] })).toBe(false);
  });

  it('reads an event that covers no slot as playing none', () => {
    expect(eventPlaysMatches({ slotDefinitions: [] })).toBe(false);
  });
});

describe('League play by scoring family', () => {
  it('names the match formats and participant types of every scoring family', () => {
    expect(Object.keys(LEAGUE_PLAY_BY_SCORING_FAMILY).sort()).toEqual(Object.values(ScoringFamily).sort());
  });

  it.each([
    [ScoringFamily.STROKE_PLAY, ParticipantType.INDIVIDUAL, MatchFormat.FIELD, true],
    [ScoringFamily.FINISH_POSITION, ParticipantType.INDIVIDUAL, MatchFormat.FIELD, true],
    [ScoringFamily.HEAD_TO_HEAD, ParticipantType.TEAM, MatchFormat.HEAD_TO_HEAD, true],
    [ScoringFamily.HEAD_TO_HEAD, ParticipantType.INDIVIDUAL, MatchFormat.HEAD_TO_HEAD, true],
    [ScoringFamily.STROKE_PLAY, ParticipantType.INDIVIDUAL, MatchFormat.HEAD_TO_HEAD, false],
    [ScoringFamily.FINISH_POSITION, ParticipantType.TEAM, MatchFormat.FIELD, false],
    [ScoringFamily.HEAD_TO_HEAD, ParticipantType.TEAM, MatchFormat.FIELD, false],
  ])('a %s league of %s participants playing %s games is valid: %s', (family, type, format, valid) => {
    expect(isLeaguePlayValid(family, type, format)).toBe(valid);
  });
});

describe('ContestStatus enum', () => {
  it('has full lifecycle', () => {
    expect(ContestStatus.DRAFT).toBe('DRAFT');
    expect(ContestStatus.OPEN).toBe('OPEN');
    expect(ContestStatus.ACTIVE).toBe('ACTIVE');
    expect(ContestStatus.COMPLETED).toBe('COMPLETED');
  });
});

describe('formatParticipantStatusLabel', () => {
  it('reads ELIMINATED in the sport\'s own word (Cut for golf); with no sport, and for every other status, reads in title case', () => {
    expect(formatParticipantStatusLabel('ELIMINATED', 'GOLF')).toBe('Cut');
    expect(formatParticipantStatusLabel('ELIMINATED', null)).toBe('Eliminated');
    expect(formatParticipantStatusLabel('WITHDRAWN', 'GOLF')).toBe('Withdrawn');
    expect(formatParticipantStatusLabel('IN_PROGRESS', 'GOLF')).toBe('In Progress');
  });

  it('reads a withdrawn horse as Scratched, and ELIMINATED generically for horse racing, which has no word for it', () => {
    expect(formatParticipantStatusLabel('WITHDRAWN', 'HORSE_RACING')).toBe('Scratched');
    expect(formatParticipantStatusLabel('ELIMINATED', 'HORSE_RACING')).toBe('Eliminated');
    expect(formatParticipantStatusLabel('WITHDRAWN', null)).toBe('Withdrawn');
  });
});
