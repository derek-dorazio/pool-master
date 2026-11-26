import { LEAGUE_PLAY_BY_SCORING_FAMILY, MatchFormat, ParticipantType, ScoringFamily, SlotKind, Sport, type SportEventSlotDefinition, type SportLeaguePlay } from '@poolmaster/shared/domain';

/**
 * Who competes in a sport's leagues and how they are scored, as the migrations seed them (#2001).
 * Test data only: the app reads both from each sport league, never from the sport. A test league
 * or event built for a sport takes its play from here unless the test is about another.
 */
const SPORT_PLAY: Readonly<Record<Sport, SportLeaguePlay>> = {
  [Sport.GOLF]: { participantType: ParticipantType.INDIVIDUAL, scoringFamily: ScoringFamily.STROKE_PLAY },
  [Sport.HORSE_RACING]: { participantType: ParticipantType.INDIVIDUAL, scoringFamily: ScoringFamily.FINISH_POSITION },
  [Sport.AUTO_RACING]: { participantType: ParticipantType.INDIVIDUAL, scoringFamily: ScoringFamily.FINISH_POSITION },
  [Sport.CYCLING]: { participantType: ParticipantType.INDIVIDUAL, scoringFamily: ScoringFamily.FINISH_POSITION },
  [Sport.RUNNING]: { participantType: ParticipantType.INDIVIDUAL, scoringFamily: ScoringFamily.FINISH_POSITION },
  [Sport.TENNIS]: { participantType: ParticipantType.INDIVIDUAL, scoringFamily: ScoringFamily.HEAD_TO_HEAD },
  [Sport.BASKETBALL]: { participantType: ParticipantType.TEAM, scoringFamily: ScoringFamily.HEAD_TO_HEAD },
  [Sport.FOOTBALL]: { participantType: ParticipantType.TEAM, scoringFamily: ScoringFamily.HEAD_TO_HEAD },
  [Sport.HOCKEY]: { participantType: ParticipantType.TEAM, scoringFamily: ScoringFamily.HEAD_TO_HEAD },
  [Sport.BASEBALL]: { participantType: ParticipantType.TEAM, scoringFamily: ScoringFamily.HEAD_TO_HEAD },
  [Sport.SOCCER]: { participantType: ParticipantType.TEAM, scoringFamily: ScoringFamily.HEAD_TO_HEAD },
};

/** A sport's leagues' participant type and scoring family, for a test row or event. */
export function sportPlay(sport: Sport): SportLeaguePlay {
  return SPORT_PLAY[sport];
}

/**
 * The one slot a test event of this sport covers unless the test gives its own (#2008): a FIELD
 * slot for a stroke-play or finishing-place league, a HEAD_TO_HEAD one for a head-to-head league,
 * so whether it plays matches (`eventPlaysMatches`) follows its play as the migrations seed it.
 */
export function sportEventSlots(sport: Sport): SportEventSlotDefinition[] {
  const [matchFormat] = LEAGUE_PLAY_BY_SCORING_FAMILY[SPORT_PLAY[sport].scoringFamily].matchFormats;
  return [matchFormat === MatchFormat.FIELD
    ? { id: 'test-field-slot-definition', slotKind: SlotKind.TOURNAMENT, canEndTied: true, periods: null, matchFormat }
    : { id: 'test-match-slot-definition', slotKind: SlotKind.FINAL, canEndTied: true, periods: null, matchFormat }];
}
