/**
 * The championship, cup and league history response mappers: what each read shows a member, built
 * from the service views. Squads are named and iconed the same everywhere; places on a tie read
 * "T<n>"; a value not there yet reads null.
 */
import {
  ContestResultCount,
  CupContestCount,
  CupStatus,
  CupTrophy,
  CupWeight,
  RecordType,
  SelectionType,
  SummaryTile,
  TeamIconKey,
  TrophyKind,
  YearReviewStatus,
  type Squad,
} from '@poolmaster/shared/domain';
import {
  toChampionshipDto,
  toChampionshipYearDto,
} from '../../../packages/core-api/src/mappers/championship.mapper';
import {
  toCupDto,
  toCupProjectionDto,
  toCupSquadPointsDto,
} from '../../../packages/core-api/src/mappers/cups.mapper';
import {
  toContestResultSummaryDto,
  toHistorySummaryDto,
  toPerpetualTrophyDto,
  toRecordDto,
  toSquadHistoryDto,
  toSquadYearDto,
  toYearReviewDto,
} from '../../../packages/core-api/src/mappers/history.mapper';
import type { ChampionshipStandingView, ChampionshipYearView } from '../../../packages/core-api/src/modules/championship/service';
import type { CupProjectionView, CupSquadPointsView, CupStandingView, CupView } from '../../../packages/core-api/src/modules/cups/service';
import type { ContestResultView, SquadHistoryView, SquadYearView } from '../../../packages/core-api/src/modules/history/service';
import type { YearReviewView } from '../../../packages/core-api/src/modules/history/year-review-service';

function squad(id: string, name: string): Squad {
  return { id, name, iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD, isActive: true, leagueId: 'league-1', createdBy: 'user-1', createdAt: new Date(0), updatedAt: new Date(0) };
}

const eagles = squad('squad-eagles', 'Eagles');
const birdies = squad('squad-birdies', 'Birdies');

const crownedAt = new Date('2026-09-01T00:00:00.000Z');
const pgaCup = { id: 'cup-pga', leagueId: 'league-1', seasonYear: 2026, sportLeagueId: 'pga', status: CupStatus.CROWNED, crownedAt, crownedPointsTable: null, createdAt: new Date(0) };

const eaglesCupRow: CupStandingView = {
  squad: eagles,
  position: 1,
  displayPosition: '1',
  points: 250,
  wins: 2,
  podiums: 3,
  contestsCounted: 4,
  movement: 1,
  pointsAfter: [100, 250],
  trophy: CupTrophy.CHAMPION,
};

const pgaCupView = {
  cup: pgaCup,
  sportLeagueName: 'PGA Tour',
  standings: [eaglesCupRow],
  contests: [
    {
      contest: { id: 'masters', name: 'Masters Pool', status: 'COMPLETED', selectionType: SelectionType.TIERED, firstEventStartsAt: new Date('2026-04-09T12:00:00.000Z'), completedAt: new Date('2026-04-12T23:00:00.000Z') },
      weight: CupWeight.DOUBLE,
      count: CupContestCount.COUNTED,
      winners: [eagles],
    },
    {
      contest: { id: 'open', name: 'Open Pool', status: 'OPEN', selectionType: SelectionType.TIERED, firstEventStartsAt: new Date('2026-07-16T06:00:00.000Z'), completedAt: null },
      weight: CupWeight.NORMAL,
      count: CupContestCount.NOT_FINAL,
      winners: [],
    },
  ],
} as unknown as CupView;

const eaglesChampionshipRow: ChampionshipStandingView = {
  squad: eagles,
  position: 1,
  displayPosition: 'T1',
  points: 900,
  finishes: [2, 1, 0],
  podiums: 3,
  topTens: 5,
  played: 6,
  movement: null,
};

describe('championship mappers', () => {
  it('names the championship by year and cup name, and lists its standings and tiles with each squad named and iconed', () => {
    const view = {
      leagueId: 'league-1',
      year: 2026,
      cupName: "Derek's Pool Cup",
      isOver: false,
      contestsCounted: 6,
      contestsToGo: 2,
      standings: [eaglesChampionshipRow],
      tiles: [{ tile: 'MOST_WINS', count: 2, squads: [eagles] }],
    } as unknown as ChampionshipYearView;

    expect(toChampionshipDto(view)).toEqual({
      leagueId: 'league-1',
      year: 2026,
      cupName: "Derek's Pool Cup",
      name: "2026 Derek's Pool Cup",
      isOver: false,
      contestsCounted: 6,
      contestsToGo: 2,
      standings: [{
        squadId: 'squad-eagles',
        squadName: 'Eagles',
        squadIconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
        squadIsActive: true,
        position: 1,
        displayPosition: 'T1',
        points: 900,
        finishes: [2, 1, 0],
        podiums: 3,
        topTens: 5,
        played: 6,
        movement: null,
      }],
      tiles: [{ tile: 'MOST_WINS', count: 2, squads: [{ squadId: 'squad-eagles', squadName: 'Eagles', squadIconKey: TeamIconKey.CAPTAIN_SMILE_FIELD }] }],
    });
  });

  it('lists a year with whether it is over and its leaders', () => {
    expect(toChampionshipYearDto({ year: 2025, isOver: true, leaders: [birdies] })).toEqual({
      year: 2025,
      isOver: true,
      leaders: [{ squadId: 'squad-birdies', squadName: 'Birdies', squadIconKey: TeamIconKey.CAPTAIN_SMILE_FIELD }],
    });
  });
});

describe('cup mappers', () => {
  it('names a cup by season and sports league, dates its crowning and each contest, and gives an unfinished contest a null completion', () => {
    const dto = toCupDto(pgaCupView);

    expect(dto).toMatchObject({
      id: 'cup-pga',
      name: '2026 PGA Tour Cup',
      status: CupStatus.CROWNED,
      crownedAt: '2026-09-01T00:00:00.000Z',
      standings: [{ squadId: 'squad-eagles', pointsAfter: [100, 250], trophy: CupTrophy.CHAMPION, movement: 1 }],
    });
    expect(dto.contests).toEqual([
      {
        contestId: 'masters',
        name: 'Masters Pool',
        status: 'COMPLETED',
        selectionType: SelectionType.TIERED,
        cupWeight: CupWeight.DOUBLE,
        count: CupContestCount.COUNTED,
        firstEventStartsAt: '2026-04-09T12:00:00.000Z',
        completedAt: '2026-04-12T23:00:00.000Z',
        winners: [{ squadId: 'squad-eagles', squadName: 'Eagles' }],
      },
      expect.objectContaining({ contestId: 'open', completedAt: null, winners: [] }),
    ]);
  });

  it('gives an open cup a null crowning time', () => {
    const open = { ...pgaCupView, cup: { ...pgaCup, status: CupStatus.OPEN, crownedAt: null } } as CupView;

    expect(toCupDto(open)).toMatchObject({ status: CupStatus.OPEN, crownedAt: null });
  });

  it('shows a squad\'s cup points per contest: its place, "T" on a tie, and null place, null completion and no ranked entries where it had no finish', () => {
    const view = {
      cup: pgaCup,
      sportLeagueName: 'PGA Tour',
      squad: eagles,
      points: 250,
      contests: [
        { contest: { id: 'masters', name: 'Masters Pool', completedAt: new Date('2026-04-12T23:00:00.000Z') }, weight: CupWeight.DOUBLE, finish: { place: 1, tiedCount: 1, rankedEntryCount: 12 }, points: 200 },
        { contest: { id: 'pga', name: 'PGA Pool', completedAt: new Date('2026-05-17T23:00:00.000Z') }, weight: CupWeight.NORMAL, finish: { place: 3, tiedCount: 2, rankedEntryCount: 10 }, points: 50 },
        { contest: { id: 'open', name: 'Open Pool', completedAt: null }, weight: CupWeight.NORMAL, finish: null, points: 0 },
      ],
    } as unknown as CupSquadPointsView;

    expect(toCupSquadPointsDto(view)).toEqual({
      cupId: 'cup-pga',
      cupName: '2026 PGA Tour Cup',
      squadId: 'squad-eagles',
      squadName: 'Eagles',
      points: 250,
      contests: [
        { contestId: 'masters', name: 'Masters Pool', cupWeight: CupWeight.DOUBLE, completedAt: '2026-04-12T23:00:00.000Z', place: 1, displayPlace: '1', rankedEntryCount: 12, points: 200 },
        { contestId: 'pga', name: 'PGA Pool', cupWeight: CupWeight.NORMAL, completedAt: '2026-05-17T23:00:00.000Z', place: 3, displayPlace: 'T3', rankedEntryCount: 10, points: 50 },
        { contestId: 'open', name: 'Open Pool', cupWeight: CupWeight.NORMAL, completedAt: null, place: null, displayPlace: null, rankedEntryCount: 0, points: 0 },
      ],
    });
  });

  it('projects a cup with the live contests it counts and each squad\'s projected place, points gained and movement', () => {
    const view = {
      cup: pgaCup,
      contests: [{ id: 'open', name: 'Open Pool', cupWeight: CupWeight.BONUS }],
      standings: [{ squad: birdies, position: 1, displayPosition: '1', points: 300, gained: 120, movement: 2 }],
    } as unknown as CupProjectionView;

    expect(toCupProjectionDto(view)).toEqual({
      cupId: 'cup-pga',
      contests: [{ contestId: 'open', name: 'Open Pool', cupWeight: CupWeight.BONUS }],
      standings: [{ squadId: 'squad-birdies', position: 1, displayPosition: '1', points: 300, gained: 120, movement: 2 }],
    });
  });
});

describe('history mappers', () => {
  const result: ContestResultView = {
    contestId: 'masters',
    name: 'Masters Pool',
    sportLeagueName: 'PGA Tour',
    selectionType: SelectionType.TIERED,
    completedAt: new Date('2026-04-12T23:00:00.000Z'),
    rankedEntryCount: 12,
    count: ContestResultCount.COUNTED,
    winners: [eagles],
    squadFinish: { place: 2, tiedCount: 1, points: 80 },
  };

  it('summarises a contest result with its winners and the squad\'s place, "T" on a tie', () => {
    expect(toContestResultSummaryDto(result)).toEqual({
      contestId: 'masters',
      name: 'Masters Pool',
      sportLeagueName: 'PGA Tour',
      selectionType: SelectionType.TIERED,
      completedAt: '2026-04-12T23:00:00.000Z',
      rankedEntryCount: 12,
      count: ContestResultCount.COUNTED,
      winners: [{ squadId: 'squad-eagles', squadName: 'Eagles', squadIconKey: TeamIconKey.CAPTAIN_SMILE_FIELD }],
      squadFinish: { place: 2, displayPlace: '2', points: 80 },
    });
    expect(toContestResultSummaryDto({ ...result, squadFinish: { place: 2, tiedCount: 3, points: 60 } }).squadFinish?.displayPlace).toBe('T2');
  });

  it('gives a contest result with no finish for the squad a null finish', () => {
    expect(toContestResultSummaryDto({ ...result, squadFinish: null }).squadFinish).toBeNull();
  });

  it('summarises the league history: its tiles, and each year\'s champions and cups by name', () => {
    const dto = toHistorySummaryDto({
      tiles: [{ tile: SummaryTile.MOST_CUPS, count: 2, squads: [eagles] }],
      years: [{ year: 2026, isOver: true, champions: [birdies], cups: [{ view: pgaCupView, contestsCounted: 4, winners: [eagles] }] }],
    });

    expect(dto).toEqual({
      tiles: [{ tile: SummaryTile.MOST_CUPS, count: 2, squads: [{ squadId: 'squad-eagles', squadName: 'Eagles', squadIconKey: TeamIconKey.CAPTAIN_SMILE_FIELD }] }],
      years: [{
        year: 2026,
        isOver: true,
        champions: [{ squadId: 'squad-birdies', squadName: 'Birdies', squadIconKey: TeamIconKey.CAPTAIN_SMILE_FIELD }],
        cups: [{
          cupId: 'cup-pga',
          sportLeagueId: 'pga',
          name: '2026 PGA Tour Cup',
          status: CupStatus.CROWNED,
          contestsCounted: 4,
          winners: [{ squadId: 'squad-eagles', squadName: 'Eagles', squadIconKey: TeamIconKey.CAPTAIN_SMILE_FIELD }],
        }],
      }],
    });
  });

  const yearWithChampionship: SquadYearView = {
    squad: eagles,
    year: 2026,
    championship: {
      cupName: "Derek's Pool Cup",
      isOver: false,
      standing: eaglesChampionshipRow,
      squadCount: 8,
      pointsBehindLeader: 0,
      contestsCounted: 6,
      contestsToGo: 2,
    },
    cups: [{ view: pgaCupView, contestsCounted: 4, standing: eaglesCupRow }],
  };

  it('shows a squad\'s year: its championship row with how far behind 1st it is, and each cup\'s row with the field size', () => {
    expect(toSquadYearDto(yearWithChampionship)).toMatchObject({
      squadId: 'squad-eagles',
      year: 2026,
      championship: {
        name: "2026 Derek's Pool Cup",
        isOver: false,
        squadCount: 8,
        pointsBehindLeader: 0,
        contestsCounted: 6,
        contestsToGo: 2,
        standing: { squadId: 'squad-eagles', displayPosition: 'T1' },
      },
      cups: [{
        cupId: 'cup-pga',
        sportLeagueId: 'pga',
        name: '2026 PGA Tour Cup',
        status: CupStatus.CROWNED,
        contestsCounted: 4,
        squadCount: 1,
        standing: { squadId: 'squad-eagles', trophy: CupTrophy.CHAMPION },
      }],
    });
  });

  it('gives a squad\'s year with no championship season a null championship', () => {
    expect(toSquadYearDto({ ...yearWithChampionship, championship: null, cups: [] })).toMatchObject({ championship: null, cups: [] });
  });

  it('shelves a championship trophy by its championship name with no cup, and a cup trophy by its cup name and ids', () => {
    const view: SquadHistoryView = {
      squad: eagles,
      medals: { firsts: 3, seconds: 1, thirds: 0 },
      trophies: [
        { kind: TrophyKind.CHAMPIONSHIP, year: 2025, trophy: CupTrophy.RUNNER_UP, cupName: "Derek's Pool Cup" },
        { kind: TrophyKind.CUP, year: 2026, trophy: CupTrophy.CHAMPION, cup: pgaCupView },
      ],
      years: [],
    };

    expect(toSquadHistoryDto(view)).toEqual({
      squadId: 'squad-eagles',
      medals: { firsts: 3, seconds: 1, thirds: 0 },
      trophies: [
        { kind: TrophyKind.CHAMPIONSHIP, year: 2025, trophy: CupTrophy.RUNNER_UP, name: "2025 Derek's Pool Cup", cupId: null, sportLeagueId: null },
        { kind: TrophyKind.CUP, year: 2026, trophy: CupTrophy.CHAMPION, name: '2026 PGA Tour Cup', cupId: 'cup-pga', sportLeagueId: 'pga' },
      ],
      years: [],
    });
  });

  it('shows a sent year in review with when and by whom, and an unsent one with nulls', () => {
    const sent: YearReviewView = {
      year: 2025,
      status: YearReviewStatus.SENT,
      sentAt: new Date('2026-01-02T08:00:00.000Z'),
      sentBy: { firstName: 'Riley', lastName: 'Quinn', username: 'riley', email: 'riley@example.test' } as YearReviewView['sentBy'],
    };

    expect(toYearReviewDto(sent)).toEqual({ year: 2025, status: YearReviewStatus.SENT, sentAt: '2026-01-02T08:00:00.000Z', sentByName: 'Riley Quinn' });
    expect(toYearReviewDto({ year: 2026, status: YearReviewStatus.READY, sentAt: null, sentBy: null })).toEqual({ year: 2026, status: YearReviewStatus.READY, sentAt: null, sentByName: null });
  });

  it('shows a record\'s holders with the year and contest it was set in, or nulls when it names none, and a null next best when there is none', () => {
    const record = toRecordDto({
      type: RecordType.MOST_CHAMPIONSHIPS,
      best: {
        value: 3,
        holders: [
          { squad: eagles, year: 2025, contest: { id: 'masters', name: 'Masters Pool' } as never },
          { squad: birdies, year: null, contest: null },
        ],
      },
      nextBest: null,
    });

    expect(record).toEqual({
      type: RecordType.MOST_CHAMPIONSHIPS,
      best: {
        value: 3,
        holders: [
          { squad: { squadId: 'squad-eagles', squadName: 'Eagles', squadIconKey: TeamIconKey.CAPTAIN_SMILE_FIELD }, year: 2025, contestId: 'masters', contestName: 'Masters Pool' },
          { squad: { squadId: 'squad-birdies', squadName: 'Birdies', squadIconKey: TeamIconKey.CAPTAIN_SMILE_FIELD }, year: null, contestId: null, contestName: null },
        ],
      },
      nextBest: null,
    });
  });

  it('shows a record\'s next best when there is one', () => {
    const record = toRecordDto({
      type: RecordType.MOST_CHAMPIONSHIPS,
      best: { value: 3, holders: [] },
      nextBest: { value: 2, holders: [{ squad: birdies, year: 2024, contest: null }] },
    });

    expect(record.nextBest).toEqual({ value: 2, holders: [{ squad: { squadId: 'squad-birdies', squadName: 'Birdies', squadIconKey: TeamIconKey.CAPTAIN_SMILE_FIELD }, year: 2024, contestId: null, contestName: null }] });
  });

  it('shows a perpetual trophy with a plate per year and each plate\'s winners', () => {
    expect(toPerpetualTrophyDto({
      eventSeriesId: 'masters',
      seriesName: 'Masters Tournament',
      sportLeagueName: 'PGA Tour',
      selectionType: SelectionType.TIERED,
      plates: [{ year: 2026, contestId: 'masters-2026', winners: [eagles] }, { year: 2025, contestId: 'masters-2025', winners: [] }],
    })).toEqual({
      eventSeriesId: 'masters',
      seriesName: 'Masters Tournament',
      sportLeagueName: 'PGA Tour',
      selectionType: SelectionType.TIERED,
      plates: [
        { year: 2026, contestId: 'masters-2026', winners: [{ squadId: 'squad-eagles', squadName: 'Eagles', squadIconKey: TeamIconKey.CAPTAIN_SMILE_FIELD }] },
        { year: 2025, contestId: 'masters-2025', winners: [] },
      ],
    });
  });
});
