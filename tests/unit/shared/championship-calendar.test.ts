/**
 * A league's championship calendar (#2021): which year the league is in now, read from its contests
 * and Seasons and never from the clock, and what still holds each open year open.
 */
import { LeaguePhase, SlotKind, championshipCalendar, type UnfinishedYearSlot } from '@poolmaster/shared/domain';

const slot = (overrides: Partial<UnfinishedYearSlot>): UnfinishedYearSlot => ({
  championshipYear: 2025,
  sportLeagueId: 'nfl',
  sportLeagueName: 'NFL',
  phase: LeaguePhase.REGULAR,
  competitionOrderIndex: 1,
  key: 'WEEK_18',
  slotKind: SlotKind.WEEK,
  weekNumber: 18,
  name: null,
  startsAt: null,
  endsAt: null,
  isTestData: false,
  label: null,
  ...overrides,
});

const superBowl = slot({
  phase: LeaguePhase.POSTSEASON,
  key: 'FINAL',
  slotKind: SlotKind.FINAL,
  weekNumber: null,
  name: 'Super Bowl',
  startsAt: new Date('2026-02-08T23:30:00.000Z'),
});

describe('championship calendar', () => {
  it('opens on the earliest open year with a live contest, passing over an earlier open year whose contests have not started', () => {
    const calendar = championshipCalendar({
      contestYears: [
        { championshipYear: 2024, hasLiveContest: false, unfinishedContests: [{ id: 'draft', name: 'Old draft' }] },
        { championshipYear: 2025, hasLiveContest: true, unfinishedContests: [{ id: 'playoffs', name: 'Playoff pool' }] },
        { championshipYear: 2026, hasLiveContest: true, unfinishedContests: [{ id: 'nba', name: 'NBA survivor' }] },
      ],
      closedYears: [],
      unfinishedSlots: [],
      currentSeasonYears: [2026],
    });

    expect(calendar.currentYear).toBe(2025);
  });

  it('opens on the earliest open year when no contest is live, and leaves a closed year out of the choice', () => {
    const calendar = championshipCalendar({
      contestYears: [
        { championshipYear: 2024, hasLiveContest: false, unfinishedContests: [] },
        { championshipYear: 2026, hasLiveContest: false, unfinishedContests: [] },
        { championshipYear: 2027, hasLiveContest: false, unfinishedContests: [] },
      ],
      closedYears: [2024],
      unfinishedSlots: [],
      currentSeasonYears: [2025],
    });

    expect(calendar.currentYear).toBe(2026);
  });

  it('opens a league with no contests on the earliest current Season year it has not closed, and on no year when there is none', () => {
    expect(championshipCalendar({ contestYears: [], closedYears: [2025], unfinishedSlots: [], currentSeasonYears: [2027, 2025, 2026] }).currentYear).toBe(2026);
    expect(championshipCalendar({ contestYears: [], closedYears: [2025], unfinishedSlots: [], currentSeasonYears: [2025] })).toEqual({ currentYear: null, years: [{ championshipYear: 2025, isClosed: true, closesAfter: [], unfinishedContests: [] }] });
  });

  it('lists every contest year, closed year and the current year once, newest first, each marked closed or open', () => {
    const calendar = championshipCalendar({
      contestYears: [{ championshipYear: 2025, hasLiveContest: false, unfinishedContests: [] }],
      closedYears: [2023, 2025],
      unfinishedSlots: [],
      currentSeasonYears: [2026],
    });

    expect(calendar.years.map((year) => [year.championshipYear, year.isClosed])).toEqual([[2026, false], [2025, true], [2023, true]]);
    expect(calendar.currentYear).toBe(2026);
  });

  it('names each sport league\'s last slot still to finish in play order, the Super Bowl after the last week however the dates fall, earliest date first and an undated one last', () => {
    const nbaFinals = slot({
      sportLeagueId: 'nba', sportLeagueName: 'NBA', phase: LeaguePhase.POSTSEASON, key: 'FINAL', slotKind: SlotKind.FINAL, weekNumber: null, name: 'NBA Finals',
    });
    const calendar = championshipCalendar({
      contestYears: [{ championshipYear: 2025, hasLiveContest: true, unfinishedContests: [] }],
      closedYears: [],
      unfinishedSlots: [
        nbaFinals,
        slot({ startsAt: new Date('2026-01-04T18:00:00.000Z') }),
        superBowl,
        slot({ phase: LeaguePhase.POSTSEASON, key: 'WILD_CARD', slotKind: SlotKind.ROUND_OF_16, weekNumber: null, startsAt: new Date('2026-01-10T18:00:00.000Z') }),
        slot({ championshipYear: 2024, key: 'FINAL', slotKind: SlotKind.FINAL, phase: LeaguePhase.POSTSEASON, name: 'Other year' }),
      ],
      currentSeasonYears: [],
    });

    const year = calendar.years.find((row) => row.championshipYear === 2025);
    expect(year?.closesAfter.map((row) => row.name)).toEqual(['Super Bowl', 'NBA Finals']);
  });

  it('holds a closed year open by nothing, whatever slots are passed for it', () => {
    const calendar = championshipCalendar({
      contestYears: [{ championshipYear: 2025, hasLiveContest: false, unfinishedContests: [{ id: 'late', name: 'Late pool' }] }],
      closedYears: [2025],
      unfinishedSlots: [superBowl],
      currentSeasonYears: [],
    });

    expect(calendar.years).toEqual([{ championshipYear: 2025, isClosed: true, closesAfter: [], unfinishedContests: [] }]);
  });
});
