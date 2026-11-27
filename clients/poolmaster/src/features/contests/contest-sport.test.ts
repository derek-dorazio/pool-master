import { describe, expect, it } from 'vitest';
import { Sport } from '@poolmaster/shared/domain';
import type { ContestDto } from '@/lib/api';
import { sportPlay } from '@/test/sport-play';
import {
  contestEntryTiebreaker,
  contestEventStart,
  contestMatchNoun,
  contestRosterParticipantNoun,
  contestScoreUnit,
  contestSportDefinition,
  contestTieLabel,
  selectionParticipantLabel,
} from './contest-sport';
import { getScoringFamilyUi } from './scoring-family-ui/registry';

type ContestSportFacts = Pick<ContestDto, 'sport' | 'sportEvents'>;

function golfContest(sportEvents: ContestDto['sportEvents']): ContestSportFacts {
  return { sport: Sport.GOLF, sportEvents };
}

const MASTERS: ContestDto['sportEvents'][number] = {
  sportEventId: 'event-1',
  sequence: 1,
  name: 'The Masters',
  startDate: '2026-04-09T12:00:00.000Z',
  endDate: null,
  status: 'SCHEDULED',
  ...sportPlay(Sport.GOLF),
};

describe('a contest\'s sport league definition and the words and tiebreaker read from it', () => {
  it('plays the participant type and scoring family its first event carries from its sport league', () => {
    expect(contestSportDefinition(golfContest([MASTERS]))).toMatchObject(sportPlay(Sport.GOLF));
  });

  it('has no definition and asks for no tiebreaker when no event is listed, since the scoring family is read off its events', () => {
    const contest = golfContest([]);

    expect(contestSportDefinition(contest)).toBeNull();
    expect(contestEntryTiebreaker(contest)).toBeNull();
  });

  it('asks a golf contest\'s entries for stroke play\'s tiebreaker', () => {
    expect(contestEntryTiebreaker(golfContest([MASTERS]))).toBe(getScoringFamilyUi(sportPlay(Sport.GOLF)).entryTiebreaker);
  });

  it('calls a pick by its sport\'s word whether or not the contest\'s events are listed, and by the generic word with no sport', () => {
    expect(contestRosterParticipantNoun(golfContest([])).one).toBe(contestRosterParticipantNoun(golfContest([MASTERS])).one);
    expect(contestRosterParticipantNoun(golfContest([])).one).not.toBe(contestRosterParticipantNoun({ sport: null, sportEvents: [] }).one);
  });

  it('calls a match and the first start by the sport\'s words, and by the generic game words with no sport', () => {
    expect(contestMatchNoun(Sport.TENNIS).one).not.toBe(contestMatchNoun(null).one);
    expect(contestEventStart(Sport.FOOTBALL)).not.toBe(contestEventStart(undefined));
  });

  it('names a seeded participant with their seed first, and an unseeded one by name alone', () => {
    expect(selectionParticipantLabel({ participantName: 'Duke', seedNumber: 1 })).toBe('(1) Duke');
    expect(selectionParticipantLabel({ participantName: 'Duke', seedNumber: null })).toBe('Duke');
  });

  it('reads the score unit and the tie word from the sport, and the generic ones with no sport', () => {
    expect(contestScoreUnit(Sport.TENNIS)).not.toBe(contestScoreUnit(undefined));
    expect(contestTieLabel(Sport.SOCCER)).not.toBe(contestTieLabel(null));
  });
});
