/**
 * The championship year close (#2021): a league's year closes once nothing in it is unfinished,
 * is stored once, and never reopens. The repository is an in-memory stand-in for its port; what
 * the year state counts is tested against Postgres.
 */
import type { ChampionshipYearState, ClosedChampionshipYear, LeagueChampionshipYearKey, LeagueChampionshipYearRepository } from '@poolmaster/shared/db';
import { ChampionshipYearCloseService } from '../../../packages/core-api/src/modules/championship/year-close-service';

const NOW = new Date('2026-02-10T12:00:00.000Z');
const LATER = new Date('2026-03-01T12:00:00.000Z');
const NFL_2025: LeagueChampionshipYearKey = { leagueId: 'league-1', championshipYear: 2025 };

const OPEN_STATE: ChampionshipYearState = { contestCount: 2, unfinishedContestCount: 0, unfinishedSeasonSlotCount: 0 };

/** The port over a few rows: closed years, each year's state, and which contests and slots reach which years. */
class InMemoryChampionshipYears implements LeagueChampionshipYearRepository {
  closed = new Map<string, ClosedChampionshipYear>();
  states = new Map<string, ChampionshipYearState>();
  contestYears = new Map<string, LeagueChampionshipYearKey>();
  slotYears = new Map<string, LeagueChampionshipYearKey[]>();

  private keyOf({ leagueId, championshipYear }: LeagueChampionshipYearKey): string {
    return `${leagueId}:${String(championshipYear)}`;
  }

  setState(key: LeagueChampionshipYearKey, state: Partial<ChampionshipYearState>): void {
    this.states.set(this.keyOf(key), { ...OPEN_STATE, ...state });
  }

  async findClosedYears(leagueId: string): Promise<ClosedChampionshipYear[]> {
    return [...this.closed].filter(([key]) => key.startsWith(`${leagueId}:`)).map(([, row]) => row);
  }

  async isClosed(key: LeagueChampionshipYearKey): Promise<boolean> {
    return this.closed.has(this.keyOf(key));
  }

  async readYearState(key: LeagueChampionshipYearKey): Promise<ChampionshipYearState> {
    return this.states.get(this.keyOf(key)) ?? { contestCount: 0, unfinishedContestCount: 0, unfinishedSeasonSlotCount: 0 };
  }

  async close(key: LeagueChampionshipYearKey, closedAt: Date): Promise<boolean> {
    if (this.closed.has(this.keyOf(key))) return false;
    this.closed.set(this.keyOf(key), { championshipYear: key.championshipYear, closedAt });
    return true;
  }

  async findContestYear(contestId: string): Promise<LeagueChampionshipYearKey | null> {
    return this.contestYears.get(contestId) ?? null;
  }

  async findLeagueYearsOfSeasonSlot(seasonSlotId: string): Promise<LeagueChampionshipYearKey[]> {
    return this.slotYears.get(seasonSlotId) ?? [];
  }
}

function build(now = NOW) {
  const years = new InMemoryChampionshipYears();
  return { years, service: new ChampionshipYearCloseService({ years, now: () => now }) };
}

describe('ChampionshipYearCloseService (#2021)', () => {
  it('closes a year once every contest in it is final and every Season slot of it has finished, stamped with when it closed', async () => {
    const { years, service } = build();
    years.setState(NFL_2025, {});

    await expect(service.closeYear(NFL_2025)).resolves.toBe(true);
    expect(await years.findClosedYears('league-1')).toEqual([{ championshipYear: 2025, closedAt: NOW }]);
  });

  it('keeps a year open while a contest in it is not final, or a Season slot of it is still to play', async () => {
    const { years, service } = build();
    years.setState(NFL_2025, { unfinishedContestCount: 1 });
    await expect(service.closeYear(NFL_2025)).resolves.toBe(false);

    years.setState(NFL_2025, { unfinishedSeasonSlotCount: 1 });
    await expect(service.closeYear(NFL_2025)).resolves.toBe(false);

    expect(await years.findClosedYears('league-1')).toEqual([]);
  });

  it('never closes a year the league ran no contest in', async () => {
    const { years, service } = build();
    years.setState(NFL_2025, { contestCount: 0 });

    await expect(service.closeYear(NFL_2025)).resolves.toBe(false);
  });

  it('never reopens or moves a closed year: a later state that would hold it open changes nothing', async () => {
    const { years, service } = build();
    years.setState(NFL_2025, {});
    await service.closeYear(NFL_2025);

    years.setState(NFL_2025, { unfinishedContestCount: 1 });
    const later = new ChampionshipYearCloseService({ years, now: () => LATER });

    await expect(later.closeYear(NFL_2025)).resolves.toBe(false);
    expect(await years.findClosedYears('league-1')).toEqual([{ championshipYear: 2025, closedAt: NOW }]);
  });

  it('closes the year of a contest gone final, and answers nothing changed for a contest that is gone', async () => {
    const { years, service } = build();
    years.setState(NFL_2025, {});
    years.contestYears.set('super-bowl-pool', NFL_2025);

    await expect(service.closeContestYear('super-bowl-pool')).resolves.toEqual({ changedCount: 1 });
    await expect(service.closeContestYear('gone')).resolves.toEqual({ changedCount: 0 });
  });

  it('closes the year of each league its Season slot reaches that nothing holds open, leaving the others open', async () => {
    const { years, service } = build();
    const otherLeague = { leagueId: 'league-2', championshipYear: 2025 };
    years.setState(NFL_2025, {});
    years.setState(otherLeague, { unfinishedContestCount: 1 });
    years.slotYears.set('super-bowl-slot', [NFL_2025, otherLeague]);

    await expect(service.closeSeasonYears('super-bowl-slot')).resolves.toEqual({ changedCount: 1 });
    expect(await years.isClosed(NFL_2025)).toBe(true);
    expect(await years.isClosed(otherLeague)).toBe(false);
  });
});
