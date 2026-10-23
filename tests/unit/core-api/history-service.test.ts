/**
 * League history (#837): a championship year's final contests, and the squad and matrix-cell
 * filters that must list exactly what the finish matrix counts.
 */
import type { FinalContest } from '@poolmaster/shared/db';
import {
  ContestResultCount,
  CupWeight,
  SelectionType,
  TeamIconKey,
  type LeagueYearFinish,
  type Squad,
} from '@poolmaster/shared/domain';
import {
  HistoryService,
  HistorySquadNotFoundError,
  HistorySquadRequiredError,
} from '../../../packages/core-api/src/modules/history/service';
import { InMemoryChampionship } from '../../support/in-memory-championship';
import { fakeSquadRepo } from '../../support/repo-fakes';

const LEAGUE = 'league-1';

function squad(id: string, name: string, leagueId = LEAGUE): Squad {
  return {
    id,
    leagueId,
    createdBy: 'user-1',
    name,
    iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

const EAGLES = squad('eagles', 'Eagles');
const BIRDIES = squad('birdies', 'Birdies');
const BOGEYS = squad('bogeys', 'Bogeys');
const SQUADS = [EAGLES, BIRDIES, BOGEYS];

function build() {
  const finishes = new InMemoryChampionship();
  const service = new HistoryService({
    finishes,
    squads: fakeSquadRepo({
      findById: jest.fn((id: string) => Promise.resolve([...SQUADS, squad('elsewhere', 'Elsewhere', 'league-2')].find((row) => row.id === id) ?? null)),
      findByLeague: jest.fn().mockResolvedValue(SQUADS),
    }),
  });
  const contest = (id: string, completedAt: string | null, overrides: Partial<FinalContest> = {}) => {
    finishes.finalContests.push({
      leagueId: LEAGUE,
      contest: {
        id,
        name: id,
        selectionType: SelectionType.TIERED,
        sportLeagueName: 'PGA Tour',
        completedAt: completedAt === null ? null : new Date(completedAt),
        ...overrides,
      },
    });
  };
  /** One squad's stored finish: [squadId, place, tiedCount]. */
  const finish = (contestId: string, year: number, rows: Array<[string, number, number]>, weight: CupWeight = CupWeight.NORMAL, settledAt = new Date(`${year}-06-01T00:00:00.000Z`)) => {
    finishes.finishes.push(...rows.map(([squadId, place, tiedCount]): LeagueYearFinish => ({
      leagueId: LEAGUE,
      year,
      squadId,
      contestId,
      place,
      tiedCount,
      rankedEntryCount: 6,
      eventSeriesId: null,
      selectionType: SelectionType.TIERED,
      weight,
      points: weight === CupWeight.NOT_COUNTED ? 0 : 1000 - place * 100,
      settledAt,
    })));
  };
  return { contest, finish, service };
}

describe('HistoryService (#837)', () => {
  it('lists every contest that went final in the year newest first, counted, not counted or without a result, with co-winners in name order and the entries ranked', async () => {
    const { contest, finish, service } = build();
    contest('masters', '2026-04-13T22:00:00.000Z');
    finish('masters', 2026, [['eagles', 1, 2], ['birdies', 1, 2], ['bogeys', 3, 1]]);
    contest('open', '2026-07-20T22:00:00.000Z');
    finish('open', 2026, [['bogeys', 1, 1]], CupWeight.NOT_COUNTED);
    contest('rained-out', '2026-08-02T22:00:00.000Z');
    contest('last-year', '2025-11-01T22:00:00.000Z');

    const contests = await service.listYearContests(LEAGUE, 2026);

    expect(contests.map((row) => [row.contestId, row.count, row.winners.map((winner) => winner.name), row.rankedEntryCount, row.squadFinish])).toEqual([
      ['rained-out', ContestResultCount.NO_RESULT, [], 0, null],
      ['open', ContestResultCount.NOT_COUNTED, ['Bogeys'], 6, null],
      ['masters', ContestResultCount.COUNTED, ['Birdies', 'Eagles'], 6, null],
    ]);
  });

  it('keeps a contest in the year its finishes were written for when its end time was never kept, dated by its settlement', async () => {
    const { contest, finish, service } = build();
    contest('old-pool', null);
    finish('old-pool', 2026, [['eagles', 1, 1]], CupWeight.NORMAL, new Date('2026-03-01T00:00:00.000Z'));

    const contests = await service.listYearContests(LEAGUE, 2026);

    expect(contests.map((row) => [row.contestId, row.completedAt.toISOString()])).toEqual([['old-pool', '2026-03-01T00:00:00.000Z']]);
  });

  it('narrows to a squad\'s counted contests, its Played count, leaving out a not-counted contest it placed in and one it missed, with its own finish on each', async () => {
    const { contest, finish, service } = build();
    contest('masters', '2026-04-13T22:00:00.000Z');
    finish('masters', 2026, [['eagles', 1, 1], ['bogeys', 2, 2], ['birdies', 2, 2]]);
    contest('open', '2026-07-20T22:00:00.000Z');
    finish('open', 2026, [['bogeys', 1, 1]], CupWeight.NOT_COUNTED);
    contest('pga', '2026-05-20T22:00:00.000Z');
    finish('pga', 2026, [['eagles', 1, 1]]);

    const contests = await service.listYearContests(LEAGUE, 2026, { squadId: 'bogeys' });

    expect(contests.map((row) => [row.contestId, row.squadFinish])).toEqual([
      ['masters', { place: 2, tiedCount: 2, points: 800 }],
    ]);
  });

  it('narrows to one cell of a squad\'s matrix row: only the counted contests it finished in that place', async () => {
    const { contest, finish, service } = build();
    contest('masters', '2026-04-13T22:00:00.000Z');
    finish('masters', 2026, [['eagles', 1, 1]]);
    contest('pga', '2026-05-20T22:00:00.000Z');
    finish('pga', 2026, [['eagles', 2, 1]]);
    contest('us-open', '2026-06-20T22:00:00.000Z');
    finish('us-open', 2026, [['eagles', 1, 1]]);

    const contests = await service.listYearContests(LEAGUE, 2026, { squadId: 'eagles', place: 1 });

    expect(contests.map((row) => row.contestId)).toEqual(['us-open', 'masters']);
  });

  it('refuses a place without a squad, since a cell belongs to one squad\'s row', async () => {
    const { service } = build();

    await expect(service.listYearContests(LEAGUE, 2026, { place: 1 })).rejects.toBeInstanceOf(HistorySquadRequiredError);
  });

  it('refuses a squad of another league as not found, so a league never lists another\'s squad', async () => {
    const { service } = build();

    await expect(service.listYearContests(LEAGUE, 2026, { squadId: 'elsewhere' })).rejects.toBeInstanceOf(HistorySquadNotFoundError);
  });
});
