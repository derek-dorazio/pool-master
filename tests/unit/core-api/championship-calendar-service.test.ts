/**
 * The championship calendar service (#2021): reads the league's calendar input once, with the
 * service's own now deciding only which drafts can never open, and answers the calendar the
 * shared rule builds from it.
 */
import { LeaguePhase, SlotKind } from '@poolmaster/shared/domain';
import { toChampionshipCalendarResponse } from '../../../packages/core-api/src/mappers/championship.mapper';
import { ChampionshipCalendarService } from '../../../packages/core-api/src/modules/championship/calendar-service';

describe('championship calendar service', () => {
  it('reads the league\'s calendar input at its now and answers the earliest open contest year as the current one', async () => {
    const now = new Date('2027-01-01T05:00:00.000Z');
    const readCalendarInput = jest.fn().mockResolvedValue({
      contestYears: [{ championshipYear: 2026, hasLiveContest: false, unfinishedContests: [{ id: 'nba', name: 'NBA pool' }] }],
      closedYears: [2025],
      unfinishedSlots: [],
      currentSeasonYears: [2027],
    });
    const service = new ChampionshipCalendarService({ years: { readCalendarInput }, now: () => now });

    const calendar = await service.getCalendar('league-1');

    expect(readCalendarInput).toHaveBeenCalledWith('league-1', now);
    expect(calendar.currentYear).toBe(2026);
    expect(calendar.years.map((year) => [year.championshipYear, year.isClosed])).toEqual([[2026, false], [2025, true]]);
  });
});

describe('championship calendar response', () => {
  it('names a test slot by its label, gives each slot its dates as ISO strings or null, and names each unfinished contest by its id', () => {
    const slot = {
      championshipYear: 2025, sportLeagueId: 'nfl', sportLeagueName: 'NFL', phase: LeaguePhase.POSTSEASON, competitionOrderIndex: 1,
      key: 'FINAL', slotKind: SlotKind.FINAL, weekNumber: null, isTestData: false, label: null,
    };
    const response = toChampionshipCalendarResponse({
      currentYear: 2025,
      years: [{
        championshipYear: 2025,
        isClosed: false,
        closesAfter: [
          { ...slot, name: 'Super Bowl', startsAt: new Date('2026-02-08T23:30:00.000Z'), endsAt: new Date('2026-02-09T03:30:00.000Z') },
          { ...slot, sportLeagueId: 'qa', name: null, isTestData: true, label: 'QA final', startsAt: null, endsAt: null },
        ],
        unfinishedContests: [{ id: 'pool', name: 'Super Bowl pool' }],
      }],
    });

    expect(response).toEqual({
      currentYear: 2025,
      years: [{
        championshipYear: 2025,
        isClosed: false,
        closesAfter: [
          { sportLeagueId: 'nfl', sportLeagueName: 'NFL', key: 'FINAL', name: 'Super Bowl', slotKind: SlotKind.FINAL, weekNumber: null, startsAt: '2026-02-08T23:30:00.000Z', endsAt: '2026-02-09T03:30:00.000Z' },
          { sportLeagueId: 'qa', sportLeagueName: 'NFL', key: 'FINAL', name: 'QA final', slotKind: SlotKind.FINAL, weekNumber: null, startsAt: null, endsAt: null },
        ],
        unfinishedContests: [{ contestId: 'pool', name: 'Super Bowl pool' }],
      }],
    });
  });
});

describe('championship calendar service defaults', () => {
  it('reads at the current instant and logs the calendar it answers when given no clock', async () => {
    const before = Date.now();
    const readCalendarInput = jest.fn().mockResolvedValue({ contestYears: [], closedYears: [], unfinishedSlots: [], currentSeasonYears: [] });
    const debug = jest.fn();

    await expect(new ChampionshipCalendarService({ years: { readCalendarInput }, logger: { debug } }).getCalendar('league-1')).resolves.toEqual({ currentYear: null, years: [] });
    const [, at] = readCalendarInput.mock.calls[0] as [string, Date];
    expect(at.getTime()).toBeGreaterThanOrEqual(before);
    expect(debug).toHaveBeenCalledWith(expect.objectContaining({ action: 'championship.calendar', data: { leagueId: 'league-1', currentYear: null, yearCount: 0 } }), expect.any(String));
  });
});
