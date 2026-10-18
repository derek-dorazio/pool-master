/**
 * Settlement of a contest of several events (#713): each event's standings freeze when that
 * event completes, and only the last event's completion settles the contest itself, with each
 * entry's total the sum of its frozen event scores.
 */
import type {
  ContestEntryEventStandingResult,
  ContestEntryRepository,
  ContestEntryStandingResult,
  ContestEntryWithSquad,
  ContestRepository,
  SportEventRepository,
} from '@poolmaster/shared/db';
import {
  ContestStatus,
  SportEventStatus,
  parseContestScoringSettings,
  type Contest,
  type SportEvent,
} from '@poolmaster/shared/domain';
import { ContestSettlementService } from '../../../packages/core-api/src/modules/contests/contest-settlement-service';
import { buildContest } from '../../factories';
import {
  fakeContestConfigurationRepo,
  fakeContestEntryPickRepo,
  fakeContestEntryRepo,
  fakeContestRepo,
  fakeParticipantContestScoringRuleRepo,
  fakeSportEventRepo,
} from '../../support/repo-fakes';
import { mockFn } from '../../support/mock-fn';

const MASTERS = 'event-masters';
const PGA = 'event-pga';
const T = new Date('2026-05-31T22:00:00.000Z');

/** One golfer's completed event, as the field read publishes it; only the to-par total is scored. */
function golfer(sportEventParticipantId: string, eventScoreToPar: number) {
  return {
    entry: { id: sportEventParticipantId, participantId: `participant-${sportEventParticipantId}`, isActive: true },
    participant: { id: `participant-${sportEventParticipantId}`, name: `Golfer ${sportEventParticipantId}` },
    valuation: null,
    standing: {
      standing: { currentRound: 4, status: 'COMPLETE', asOf: T },
      golf: { eventScoreToPar, eventStrokes: 288 + eventScoreToPar, currentRoundThru: 18 },
    },
    rounds: [],
    raceResult: null,
    matches: [],
    affiliatedWithSportLeague: true,
  };
}

function pick(id: string, entryId: string, sportEventParticipantId: string) {
  return { id, entryId, sportEventParticipantId, pickedAt: new Date('2026-04-01T12:00:00.000Z'), slot: undefined };
}

function entry(id: string, entryNumber: number, submitted: readonly string[]): ContestEntryWithSquad {
  return {
    id,
    contestId: 'majors',
    squadId: `squad-${id}`,
    squadName: `Squad ${id}`,
    entryNumber,
    name: `Entry ${id}`,
    events: [MASTERS, PGA].map((sportEventId) => ({
      sportEventId,
      status: submitted.includes(sportEventId) ? 'SUBMITTED' as const : 'DRAFT' as const,
    })),
    createdAt: T,
    updatedAt: T,
  };
}

/**
 * A two-major contest: entry A leads the Masters (-6 against -1) and entry B wins the PGA (-8
 * against +2), so B wins the contest on the sum (-9 against -4). One counted golfer per event.
 */
function world({
  configJson = { selectionType: 'TIERED', picksPerTier: 1, countedScores: 1 } as Record<string, unknown>,
  scoringRules = [parseContestScoringSettings('GOLF_RELATIVE_TO_PAR_TOTAL', {})],
}: { configJson?: Record<string, unknown>; scoringRules?: ReturnType<typeof parseContestScoringSettings>[] } = {}) {
  const events = new Map<string, SportEvent>([
    [MASTERS, { id: MASTERS, sport: 'GOLF', status: SportEventStatus.SCHEDULED, startDate: new Date('2026-04-09T12:00:00.000Z') } as SportEvent],
    [PGA, { id: PGA, sport: 'GOLF', status: SportEventStatus.SCHEDULED, startDate: new Date('2026-05-14T12:00:00.000Z') } as SportEvent],
  ]);
  let contest: Contest = buildContest({ id: 'majors', sportEventIds: [MASTERS, PGA], status: ContestStatus.ACTIVE });
  const fields = new Map([
    [MASTERS, [golfer('sep-m1', -6), golfer('sep-m2', -1)]],
    [PGA, [golfer('sep-p1', 2), golfer('sep-p2', -8)]],
  ]);
  const entries = [entry('entry-a', 1, [MASTERS, PGA]), entry('entry-b', 2, [MASTERS, PGA])];
  const picks = [
    pick('pick-a-m', 'entry-a', 'sep-m1'),
    pick('pick-a-p', 'entry-a', 'sep-p1'),
    pick('pick-b-m', 'entry-b', 'sep-m2'),
    pick('pick-b-p', 'entry-b', 'sep-p2'),
  ];
  const eventStandings: ContestEntryEventStandingResult[] = [];
  const standings: ContestEntryStandingResult[] = [];

  const service = new ContestSettlementService({
    sportEvents: fakeSportEventRepo({
      findById: mockFn<SportEventRepository['findById']>(async (id) => events.get(id) ?? null),
      findByIds: mockFn<SportEventRepository['findByIds']>(async (ids) => ids.flatMap((id) => events.get(id) ?? [])),
    }),
    contests: fakeContestRepo({
      findBySportEvent: mockFn<ContestRepository['findBySportEvent']>(async (sportEventId, filter) =>
        (contest.sportEventIds.includes(sportEventId) && !filter?.excludeStatuses?.includes(contest.status) ? [contest] : [])),
      transitionStatus: mockFn<ContestRepository['transitionStatus']>(async (_id, transition) => {
        if (!transition.from.includes(contest.status)) return false;
        contest = { ...contest, status: transition.to };
        return true;
      }),
    }),
    configurations: fakeContestConfigurationRepo({
      findByContest: jest.fn().mockResolvedValue({
        id: 'config-majors',
        contestId: 'majors',
        selectionType: 'TIERED',
        configJson,
        createdAt: T,
        updatedAt: T,
      }),
    }),
    scoringRules: fakeParticipantContestScoringRuleRepo({
      findByContestConfiguration: jest.fn().mockResolvedValue(scoringRules.map((scoring, index) => ({
        id: `rule-${index + 1}`,
        contestConfigurationId: 'config-majors',
        sortOrder: index + 1,
        active: true,
        scoring,
        createdAt: T,
        updatedAt: T,
      }))),
    }),
    entries: fakeContestEntryRepo({
      findByContestWithSquad: mockFn<ContestEntryRepository['findByContestWithSquad']>(async (_contestId, options) =>
        entries.filter((row) => options?.submittedFor === undefined
          || row.events.some((event) => event.sportEventId === options.submittedFor && event.status === 'SUBMITTED'))),
    }),
    picks: fakeContestEntryPickRepo({
      findByEntries: jest.fn().mockImplementation(async (entryIds: readonly string[]) =>
        picks.filter((row) => entryIds.includes(row.entryId))),
    }),
    eventParticipants: {
      listEventParticipants: jest.fn().mockImplementation(async (sportEventId: string) => fields.get(sportEventId) ?? []),
    },
    // Golf contests pick no games; a bracket contest's settlement is in bracket-standings.test.ts.
    predictions: { findByEntriesAndEvent: jest.fn().mockResolvedValue([]) },
    matches: { findBySportEvent: jest.fn().mockResolvedValue([]) },
    eventStandings: {
      findByContest: async (contestId) => eventStandings.filter((row) => row.contestId === contestId),
      upsert: async (write) => {
        const at = eventStandings.findIndex((row) =>
          row.contestEntryId === write.contestEntryId && row.sportEventId === write.sportEventId);
        const row = { id: `event-standing-${write.contestEntryId}-${write.sportEventId}`, ...write };
        if (at >= 0) eventStandings[at] = row;
        else eventStandings.push(row);
      },
    },
    standings: {
      findByContest: async (contestId) => standings.filter((row) => row.contestId === contestId),
      upsert: async (write) => {
        const at = standings.findIndex((row) => row.contestEntryId === write.contestEntryId);
        const row = { id: `standing-${write.contestEntryId}`, ...write };
        if (at >= 0) standings[at] = row;
        else standings.push(row);
      },
    },
  });

  return {
    service,
    fields,
    eventStandings,
    standings,
    entries,
    contest: () => contest,
    complete: (sportEventId: string) => {
      const event = events.get(sportEventId);
      if (event) events.set(sportEventId, { ...event, status: SportEventStatus.COMPLETED });
    },
  };
}

const eventRows = (rows: readonly ContestEntryEventStandingResult[], sportEventId: string) =>
  rows.filter((row) => row.sportEventId === sportEventId)
    .map((row) => [row.contestEntryId, row.totalScore, row.position]);

describe('ContestSettlementService — a contest of two events (#713)', () => {
  it('freezes only the first event\'s standings when it completes, writing no contest total and leaving the contest ACTIVE', async () => {
    const w = world();
    w.complete(MASTERS);

    const summary = await w.service.settleCompletedSportEvent(MASTERS, { completedAt: T });

    expect(eventRows(w.eventStandings, MASTERS)).toEqual([['entry-a', -6, 1], ['entry-b', -1, 2]]);
    expect(eventRows(w.eventStandings, PGA)).toEqual([]);
    expect(w.standings).toEqual([]);
    expect(w.contest().status).toBe(ContestStatus.ACTIVE);
    expect(summary).toMatchObject({ contestsSettled: 1, contestsCompleted: 0, standingsUpserted: 0 });
  });

  it('settles the contest when its last event completes: that event\'s standings, totals summed over both events, and COMPLETED', async () => {
    const w = world();
    w.complete(MASTERS);
    await w.service.settleCompletedSportEvent(MASTERS, { completedAt: T });
    w.complete(PGA);

    const summary = await w.service.settleCompletedSportEvent(PGA, { completedAt: T });

    expect(eventRows(w.eventStandings, PGA)).toEqual([['entry-b', -8, 1], ['entry-a', 2, 2]]);
    expect(w.standings.map((row) => [row.contestEntryId, row.totalScore, row.position, row.scoredPickCount]))
      .toEqual([['entry-b', -9, 1, 2], ['entry-a', -4, 2, 2]]);
    expect(w.contest().status).toBe(ContestStatus.COMPLETED);
    expect(summary).toMatchObject({ contestsSettled: 1, contestsCompleted: 1, standingsUpserted: 2 });
  });

  it('does not rewrite an event\'s frozen standings when that event is settled again while the contest is still live', async () => {
    const w = world();
    w.complete(MASTERS);
    await w.service.settleCompletedSportEvent(MASTERS, { completedAt: T });
    // A late score correction arrives for the Masters after it settled.
    w.fields.set(MASTERS, [golfer('sep-m1', 4), golfer('sep-m2', -1)]);

    await w.service.settleCompletedSportEvent(MASTERS, { completedAt: T });

    expect(eventRows(w.eventStandings, MASTERS)).toEqual([['entry-a', -6, 1], ['entry-b', -1, 2]]);
    expect(w.contest().status).toBe(ContestStatus.ACTIVE);
  });

  it('settles nothing for an event that has not completed', async () => {
    const w = world();

    const summary = await w.service.settleCompletedSportEvent(MASTERS, { completedAt: T });

    expect(summary).toMatchObject({ contestsSettled: 0, contestsCompleted: 0 });
    expect(w.eventStandings).toEqual([]);
  });

  it('leaves an entry that submitted only the second event out of the first event\'s standings, and totals it on that one event', async () => {
    const w = world();
    w.entries[1] = entry('entry-b', 2, [PGA]);
    w.complete(MASTERS);
    await w.service.settleCompletedSportEvent(MASTERS, { completedAt: T });
    w.complete(PGA);

    await w.service.settleCompletedSportEvent(PGA, { completedAt: T });

    expect(eventRows(w.eventStandings, MASTERS)).toEqual([['entry-a', -6, 1]]);
    expect(w.standings.map((row) => [row.contestEntryId, row.totalScore, row.position]))
      .toEqual([['entry-b', -8, 1], ['entry-a', -4, 2]]);
  });
});

describe('ContestSettlementService — a contest it cannot score', () => {
  // Settling under a guessed rule would pay the wrong entries, so each case skips the contest:
  // no standings, and the contest stays live to be settled again once its configuration is fixed.
  it.each([
    ['no counting rule (countedScores missing)', { configJson: { selectionType: 'TIERED', picksPerTier: 1 } }],
    ['no participant scoring rule', { scoringRules: [] }],
    ['a scoring rule whose settings are invalid for its definition', { scoringRules: [parseContestScoringSettings('KNOCKOUT_ROUND_POINTS', { roundValues: 'not a table' })] }],
  ])('skips a contest with %s: no event or contest standings are written and it stays ACTIVE', async (_case, options) => {
    const subject = world(options);
    subject.complete(MASTERS);
    subject.complete(PGA);

    const summary = await subject.service.settleCompletedSportEvent(PGA);

    expect(summary).toEqual({ sportEventId: PGA, contestsSettled: 0, contestsCompleted: 0, standingsUpserted: 0 });
    expect([subject.eventStandings, subject.standings]).toEqual([[], []]);
    expect(subject.contest().status).toBe(ContestStatus.ACTIVE);
  });
});
