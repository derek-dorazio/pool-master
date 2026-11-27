import { sportPlay } from '../../support/sport-play';
import { expect } from '@jest/globals';
import { ParticipantType, ScoringFamily, SeasonSlotStatus, SlotKind, Sport, SportEventStatus } from '@poolmaster/shared/domain';
import { ContestLeaderboardResponseSchema } from '@poolmaster/shared/dto';
import {
  type ContestSportEventRow,
  type ScoredContestEntryPickRow,
  toContestEntryDetailResponse,
  toContestEntryDto,
  toContestEntryListResponse,
  toContestEntryResponse,
  toContestFinishedYearsResponse,
  toContestLeaderboardResponse,
  toContestLeaderboardSnapshotResponse,
  toContestListResponse,
  toContestResponse,
  toMyContestEntriesResponse,
} from '../../../packages/core-api/src/mappers/contests.mapper';
import { buildContest, buildCoveredSlot } from '../../factories';

describe('toContestListResponse', () => {
  const masters = {
    id: 'event-1',
    name: 'The Masters',
    startDate: new Date('2026-04-09T12:40:00.000Z'),
    status: SportEventStatus.SCHEDULED,
    ...sportPlay(Sport.GOLF),
  };
  const pga = {
    id: 'event-2',
    name: 'PGA Championship',
    startDate: new Date('2026-05-14T12:00:00.000Z'),
    status: SportEventStatus.SCHEDULED,
    ...sportPlay(Sport.GOLF),
  };

  it('gives each listed contest its entry count and its event\'s id, sequence, name, start and status', () => {
    const response = toContestListResponse(
      [buildContest({ id: 'contest-1', sportEventIds: ['event-1'] })],
      { allEntryCounts: new Map(), entryCaps: new Map([['contest-1', 50]]), entryCounts: new Map([['contest-1', 3]]), progress: new Map(), currentSlotIds: new Map() },
      new Map([['event-1', masters]]),
    );

    expect(response.contests[0]).toMatchObject({
      entryCount: 3,
      entriesPerContest: 50,
      sportEvents: [{
        sportEventId: 'event-1',
        name: 'The Masters',
        startDate: '2026-04-09T12:40:00.000Z',
        status: SportEventStatus.SCHEDULED,
      }],
    });
  });

  it('carries each event\'s scheduled end, and null for an event with none, so a contest\'s schedule needs no event read (#1198)', () => {
    const response = toContestListResponse(
      [buildContest({ id: 'majors', sportEventIds: ['event-1', 'event-2'] })],
      { allEntryCounts: new Map(), entryCaps: new Map(), entryCounts: new Map(), progress: new Map(), currentSlotIds: new Map() },
      new Map<string, ContestSportEventRow>([['event-1', { ...masters, endDate: new Date('2026-04-12T23:00:00.000Z') }], ['event-2', pga]]),
    );

    expect(response.contests[0]?.sportEvents.map((event) => event.endDate)).toEqual(['2026-04-12T23:00:00.000Z', null]);
  });

  it('lists a contest\'s covered slots in play order, each with its event, kind, status and competition, and dates as ISO strings (#2014)', () => {
    const week14 = buildCoveredSlot({ seasonSlotId: 'slot-14', slotDefinitionId: 'def-14', key: 'WEEK_14', slotKind: SlotKind.WEEK, weekNumber: 14, sportEventId: 'event-1', startsAt: new Date('2026-12-06T18:00:00.000Z') });
    const week15 = buildCoveredSlot({ seasonSlotId: 'slot-15', slotDefinitionId: 'def-15', key: 'WEEK_15', slotKind: SlotKind.WEEK, weekNumber: 15, status: SeasonSlotStatus.IN_PROGRESS, competitionName: 'Regular season' });
    const response = toContestListResponse(
      [buildContest({ id: 'pickem', sportEventIds: ['event-1'], coveredSlots: [week14, week15] })],
      { allEntryCounts: new Map(), entryCaps: new Map(), entryCounts: new Map(), progress: new Map(), currentSlotIds: new Map() },
      new Map([['event-1', masters]]),
    );

    expect(response.contests[0]?.coveredSlots).toEqual([
      { seasonSlotId: 'slot-14', slotDefinitionId: 'def-14', key: 'WEEK_14', name: null, slotKind: SlotKind.WEEK, weekNumber: 14, status: SeasonSlotStatus.SCHEDULED, startsAt: '2026-12-06T18:00:00.000Z', endsAt: null, sportEventId: 'event-1', competitionCode: 'REGULAR', competitionName: null },
      { seasonSlotId: 'slot-15', slotDefinitionId: 'def-15', key: 'WEEK_15', name: null, slotKind: SlotKind.WEEK, weekNumber: 15, status: SeasonSlotStatus.IN_PROGRESS, startsAt: null, endsAt: null, sportEventId: null, competitionCode: 'REGULAR', competitionName: 'Regular season' },
    ]);
  });

  it('gives each listed contest every entry it holds, drafts included, so a list knows when its cap is reached (#1781)', () => {
    const response = toContestListResponse(
      [buildContest({ id: 'contest-1', sportEventIds: ['event-1'] })],
      { allEntryCounts: new Map([['contest-1', 10]]), entryCaps: new Map([['contest-1', 10]]), entryCounts: new Map([['contest-1', 4]]), progress: new Map(), currentSlotIds: new Map() },
      new Map([['event-1', masters]]),
    );

    expect(response.contests[0]).toMatchObject({ allEntryCount: 10, entryCount: 4, entriesPerContest: 10 });
  });

  it('gives a live contest its progress and every other contest null (#1782)', () => {
    const response = toContestListResponse(
      [buildContest({ id: 'live', sportEventIds: ['event-1'] }), buildContest({ id: 'open', sportEventIds: ['event-1'] })],
      { allEntryCounts: new Map(), entryCaps: new Map(), entryCounts: new Map(), progress: new Map([['live', { played: 9, total: 14, unit: 'GAMES' as const }]]), currentSlotIds: new Map() },
      new Map([['event-1', masters]]),
    );

    expect(response.contests.map((contest) => contest.progress)).toEqual([{ played: 9, total: 14, unit: 'GAMES' }, null]);
  });

  it('leaves an event that was not found out of the contest\'s events rather than inventing one', () => {
    const response = toContestListResponse(
      [buildContest({ id: 'lost-event', sportEventIds: ['event-gone'] })],
      { allEntryCounts: new Map(), entryCaps: new Map(), entryCounts: new Map(), progress: new Map(), currentSlotIds: new Map() },
      new Map([['event-1', masters]]),
    );

    expect(response.contests[0]?.sportEvents).toEqual([]);
  });
});

describe('toContestResponse events', () => {
  it('gives a single-contest read its events too, so a page reads each event\'s name and status from it', () => {
    expect(toContestResponse(buildContest({ id: 'contest-1', sportEventIds: ['event-1'] }), new Map([['event-1', masters()]]), { entriesPerContest: 20, currentSlotId: null }).contest.sportEvents)
      .toEqual([expect.objectContaining({ sportEventId: 'event-1', name: 'The Masters' })]);
  });

  it('carries each event\'s sport league participant type and scoring family on the contest\'s event, so a page reads the event\'s definition', () => {
    const worldSeries = {
      id: 'event-1', name: 'World Series', startDate: new Date('2026-10-23T00:08:00.000Z'), status: SportEventStatus.SCHEDULED,
      participantType: ParticipantType.TEAM, scoringFamily: ScoringFamily.HEAD_TO_HEAD,
    };
    const [golfEvent] = toContestResponse(buildContest({ id: 'contest-1', sportEventIds: ['event-1'] }), new Map([['event-1', masters()]]), { entriesPerContest: 20, currentSlotId: null }).contest.sportEvents;
    const [bracketEvent] = toContestResponse(buildContest({ id: 'contest-2', sportEventIds: ['event-1'] }), new Map([['event-1', worldSeries]]), { entriesPerContest: 20, currentSlotId: null }).contest.sportEvents;

    expect([golfEvent.participantType, golfEvent.scoringFamily]).toEqual([ParticipantType.INDIVIDUAL, ScoringFamily.STROKE_PLAY]);
    expect([bracketEvent.participantType, bracketEvent.scoringFamily]).toEqual([ParticipantType.TEAM, ScoringFamily.HEAD_TO_HEAD]);
  });

  it('gives a single-contest read its entry cap, and a contest with no cap none', () => {
    expect(toContestResponse(buildContest({ id: 'contest-1' }), new Map(), { entriesPerContest: 200, currentSlotId: null }).contest.entriesPerContest).toBe(200);
    expect(toContestResponse(buildContest({ id: 'contest-1' }), new Map(), { entriesPerContest: null, currentSlotId: null }).contest.entriesPerContest).toBeNull();
  });

  function masters() {
    return { id: 'event-1', name: 'The Masters', startDate: new Date('2026-04-09T12:40:00.000Z'), status: SportEventStatus.SCHEDULED, ...sportPlay(Sport.GOLF) };
  }
});

describe('toContestLeaderboardResponse', () => {
  it('publishes the event\'s sport, so a client can resolve the scoring family it renders the board with', () => {
    const response = toContestLeaderboardResponse({
      contestId: 'contest-1',
      sportEventId: 'event-1',
      sport: Sport.GOLF,
      ...sportPlay(Sport.GOLF),
      scoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
      countingRule: { type: 'BEST_N', count: 4, pickCount: 6 },
      upsetBonus: false,
      unplayedRoundToPar: 8,
      currentRound: { roundNumber: 2, isComplete: false },
      participants: [],
      entries: [],
      asOf: null,
    });

    expect(response.sport).toBe(Sport.GOLF);
    expect(ContestLeaderboardResponseSchema.parse(response).sport).toBe(Sport.GOLF);
    // The contest's unplayed-round score and the field's round, for the footnote and the header.
    expect(response).toMatchObject({ unplayedRoundToPar: 8, currentRound: { roundNumber: 2, isComplete: false } });
  });

  it('publishes a horse racing entry\'s total as its totalScore and each pick\'s points on the race block, leaving the golf one null', () => {
    const response = toContestLeaderboardResponse({
      contestId: 'contest-1',
      sportEventId: 'event-1',
      sport: Sport.HORSE_RACING,
      ...sportPlay(Sport.HORSE_RACING),
      scoringDefinitionId: 'FINISH_POSITION_POINTS',
      countingRule: { type: 'BEST_N', count: 3, pickCount: 6 },
      upsetBonus: false,
      unplayedRoundToPar: null,
      currentRound: null,
      participants: [],
      entries: [{
        entryId: 'entry-1',
        entryName: 'Paddock Pals',
        entryNumber: 1,
        squadId: 'squad-1',
        squadName: 'Paddock Pals',
        score: 8,
        position: 1,
        displayPosition: '1',
        countingPickLimit: 3,
        scoredPickCount: 2,
        events: [{ sportEventId: 'event-1', score: 8, position: 1, displayPosition: '1' }],
        picks: [{
          pickId: 'pick-1',
          sportEventParticipantId: 'sep-1',
          pickedAt: new Date('2026-05-01T12:00:00.000Z'),
          isCounting: true,
          isDropped: false,
          participant: {
            sportEventParticipantId: 'sep-1',
            name: 'Arrow',
            score: 5,
            detail: { scoringFamily: ScoringFamily.FINISH_POSITION },
            asOf: null,
          },
        }],
      }],
      asOf: null,
    });

    const [entry] = ContestLeaderboardResponseSchema.parse(response).entries;
    expect(entry.totalScore).toBe(8);
    expect([entry.picks[0].golf, entry.picks[0].race]).toEqual([null, { points: 5 }]);
    expect(entry.events).toEqual([{ sportEventId: 'event-1', totalScore: 8, position: 1, displayPosition: '1' }]);
  });
});

describe('toContestLeaderboardResponse per-sport pick detail', () => {
  const AS_OF = new Date('2026-04-12T22:00:00.000Z');
  const board = (sport: Sport, participant: ScoredContestEntryPickRow['participant'], asOf: Date | null) => toContestLeaderboardResponse({
    contestId: 'contest-1',
    sportEventId: 'event-1',
    sport,
    ...sportPlay(sport),
    scoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
    countingRule: { type: 'BEST_N', count: 4, pickCount: 6 },
    upsetBonus: false,
    unplayedRoundToPar: null,
    currentRound: null,
    participants: [],
    entries: [{
      entryId: 'entry-1',
      entryName: 'Mine',
      entryNumber: 1,
      squadId: 'squad-1',
      squadName: 'Mine',
      score: 3,
      position: 1,
      displayPosition: '1',
      countingPickLimit: 4,
      scoredPickCount: 1,
      events: [],
      picks: [{
        pickId: 'pick-1',
        sportEventParticipantId: 'sep-1',
        pickedAt: AS_OF,
        isCounting: true,
        isDropped: false,
        participant,
      }],
    }],
    asOf,
  });

  it('publishes a golf pick\'s score to par and unplayed rounds on the golf block, the others null, and the board\'s as-of time', () => {
    const response = board(Sport.GOLF, {
      sportEventParticipantId: 'sep-1',
      name: 'Scottie',
      score: -6,
      detail: { scoringFamily: ScoringFamily.STROKE_PLAY, unplayedRoundNumbers: [4] },
      asOf: null,
    }, AS_OF);

    const [pick] = response.entries[0].picks;
    expect(pick).toEqual(expect.objectContaining({ golf: { scoreToPar: -6, unplayedRoundNumbers: [4] }, race: null, knockout: null }));
    expect(response.asOf).toBe(AS_OF.toISOString());
  });

  it('publishes a knockout team pick\'s points, wins, upset bonus and whether it is alive on the knockout block, the others null', () => {
    const response = board(Sport.BASKETBALL, {
      sportEventParticipantId: 'sep-1',
      name: 'Duke',
      score: 7,
      detail: { scoringFamily: ScoringFamily.HEAD_TO_HEAD, wins: 2, upsetBonusPoints: 3, isAlive: false },
      asOf: null,
    }, null);

    const [pick] = response.entries[0].picks;
    expect(pick).toEqual(expect.objectContaining({ golf: null, race: null, knockout: { points: 7, wins: 2, upsetBonusPoints: 3, isAlive: false } }));
    expect(response.asOf).toBeNull();
  });

  it('answers a stored leaderboard with the board it holds, unchanged', () => {
    const stored = board(Sport.GOLF, {
      sportEventParticipantId: 'sep-1', name: 'Scottie', score: null, detail: { scoringFamily: ScoringFamily.STROKE_PLAY, unplayedRoundNumbers: [] }, asOf: null,
    }, null);

    expect(toContestLeaderboardSnapshotResponse({ board: stored })).toBe(stored);
  });
});

describe('contest entry mappers', () => {
  const CREATED = new Date('2026-04-01T00:00:00.000Z');
  const row = {
    id: 'entry-1',
    contestId: 'contest-1',
    squadId: 'squad-1',
    entryNumber: 1,
    name: 'Mine',
    events: [
      { sportEventId: 'event-1', status: 'SUBMITTED', submittedAt: CREATED },
      { sportEventId: 'event-2', status: 'DRAFT', submittedAt: null },
    ] as never,
    picksCount: 2,
    createdAt: CREATED,
    updatedAt: CREATED,
  };

  it('hides an entry\'s picks when none are given, sending an omitted tiebreaker and an unsubmitted event\'s time as null', () => {
    const dto = toContestEntryDto(row, { name: 'Squad' });

    expect(dto).not.toHaveProperty('participants');
    expect(dto.tiebreakerValue).toBeNull();
    expect(dto.squadName).toBe('Squad');
    expect(dto.events.map((event) => event.submittedAt)).toEqual([CREATED.toISOString(), null]);
  });

  it('shows an entry\'s picks when given, an omitted status, role and team as null', () => {
    const dto = toContestEntryDto({ ...row, tiebreakerValue: 140 }, { name: 'Squad' }, [
      { pickId: 'p1', sportEventParticipantId: 'sep-1', sportEventId: 'event-1', participantId: 'x1', participantName: 'One', pickedAt: CREATED },
      {
        pickId: 'p2',
        sportEventParticipantId: 'sep-2',
        sportEventId: 'event-1',
        participantId: 'x2',
        participantName: 'Two',
        participantStatus: 'ACTIVE',
        role: 'QB',
        teamAffiliation: 'KC',
        pickedAt: CREATED,
      },
    ]);

    expect(dto.tiebreakerValue).toBe(140);
    expect(dto.participants?.map((pick) => [pick.participantStatus, pick.role, pick.teamAffiliation]))
      .toEqual([[null, null, null], ['ACTIVE', 'QB', 'KC']]);
  });

  it('wraps an entry for its single, detail, list and own-entries responses, the list counting its entries', () => {
    const entry = toContestEntryDto(row, { name: 'Squad' });

    expect(toContestEntryResponse('contest-1', entry)).toEqual({ contestId: 'contest-1', entry });
    expect(toContestEntryDetailResponse('contest-1', entry, true)).toEqual({ contestId: 'contest-1', picksRevealed: true, entry });
    expect(toContestEntryListResponse({ contestId: 'contest-1', entries: [entry, entry], picksRevealed: false }))
      .toEqual({ contestId: 'contest-1', total: 2, picksRevealed: false, entries: [entry, entry] });
    const place = { entryId: entry.id, position: 2, displayPosition: '2' };
    expect(toMyContestEntriesResponse({ entries: [entry], places: [place] })).toEqual({ entries: [entry], places: [place] });
  });

  it('sends a league\'s finished years as a copy, in the order given', () => {
    const years = [2026, 2025];

    const dto = toContestFinishedYearsResponse(years);

    expect(dto.years).toEqual([2026, 2025]);
    expect(dto.years).not.toBe(years);
  });
});
