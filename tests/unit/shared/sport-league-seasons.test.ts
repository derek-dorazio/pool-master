/**
 * A sport league's Seasons (#2003): the one current-Season rule every reader goes through, the
 * Seasons the events sync reads, the Seasons' one order with their phases and slots, the daily
 * recompute that writes the current Season, and the DTO the API sends.
 */
import { expect, jest } from '@jest/globals';
import {
  currentSeasonOf,
  LeaguePhase,
  orderSportLeagueSeasons,
  SeasonSlotStatus,
  seasonsToSync,
  SeriesFormat,
  SlotKind,
  SlotPairing,
  type CurrentSeasonCandidate,
  type SportLeagueSeasonDetail,
  type SportLeagueSeasonSlot,
} from '@poolmaster/shared/domain';
import type { SportLeagueCurrentSeasonFacts } from '@poolmaster/shared/db';
import { SportLeagueSeasonListResponseSchema } from '@poolmaster/shared/dto/sport-catalog.dto';
import { mapSportLeagueSeasonToDto } from '../../../packages/core-api/src/mappers';
import { CurrentSeasonRecompute } from '../../../packages/core-api/src/modules/sport-catalog/current-season-recompute';

const at = (iso: string) => new Date(iso);

/** The NFL's 2025 and 2026 Seasons, each from September to the Super Bowl in February. */
function nfl(overrides: { s2026HasSyncedEvent?: boolean } = {}): CurrentSeasonCandidate[] {
  return [
    { id: 'nfl-2026', startsAt: at('2026-09-01T00:00:00Z'), endsAt: at('2027-02-28T00:00:00Z'), hasSyncedEvent: overrides.s2026HasSyncedEvent ?? false },
    { id: 'nfl-2025', startsAt: at('2025-09-01T00:00:00Z'), endsAt: at('2026-02-28T00:00:00Z'), hasSyncedEvent: true },
  ];
}

describe('currentSeasonOf', () => {
  it('is the Season whose span holds now, so in January the NFL Season that began the autumn before is still current', () => {
    expect(currentSeasonOf(nfl(), at('2026-01-20T00:00:00Z'))).toBe('nfl-2025');
  });

  it('stays the Season that ended last between Seasons while the next has no synced event', () => {
    expect(currentSeasonOf(nfl(), at('2026-06-01T00:00:00Z'))).toBe('nfl-2025');
  });

  it('moves to the next Season between Seasons once the sync has made an event in it, its schedule being published', () => {
    expect(currentSeasonOf(nfl({ s2026HasSyncedEvent: true }), at('2026-06-01T00:00:00Z'))).toBe('nfl-2026');
  });

  it('is the first Season of a league whose Seasons all lie ahead, and null for a league with none', () => {
    expect(currentSeasonOf(nfl(), at('2025-01-01T00:00:00Z'))).toBe('nfl-2025');
    expect(currentSeasonOf([], at('2026-01-01T00:00:00Z'))).toBeNull();
  });

  it('is the last Season once every one has ended', () => {
    expect(currentSeasonOf(nfl(), at('2028-01-01T00:00:00Z'))).toBe('nfl-2026');
  });
});

describe('seasonsToSync', () => {
  const seasons = [
    { id: 's2027', startsAt: at('2027-01-01T00:00:00Z') },
    { id: 's2025', startsAt: at('2025-01-01T00:00:00Z') },
    { id: 's2026', startsAt: at('2026-01-01T00:00:00Z') },
  ];

  it('reads the current Season and every later one in date order, never an earlier one', () => {
    expect(seasonsToSync(seasons, 's2026').map((season) => season.id)).toEqual(['s2026', 's2027']);
  });

  it('reads nothing for a league with no current Season, or one naming a Season it does not have', () => {
    expect(seasonsToSync(seasons, null)).toEqual([]);
    expect(seasonsToSync(seasons, 'gone')).toEqual([]);
  });
});

function slot(key: string, overrides: Partial<SportLeagueSeasonSlot> = {}): SportLeagueSeasonSlot {
  return {
    id: `slot-${key}`, slotDefinitionId: `def-${key}`, key, slotKind: SlotKind.WEEK, weekNumber: null, name: null,
    startsAt: null, endsAt: null, status: SeasonSlotStatus.SCHEDULED, seriesFormat: SeriesFormat.SINGLE_GAME, seriesGames: 1,
    pairing: SlotPairing.FIXED, isTestData: false, label: null, ...overrides,
  };
}

function season(id: string, year: number, overrides: Partial<SportLeagueSeasonDetail> = {}): SportLeagueSeasonDetail {
  return {
    id, sportLeagueId: 'league', name: String(year), championshipYear: year,
    startsAt: at(`${year}-01-01T00:00:00Z`), endsAt: at(`${year}-12-31T00:00:00Z`),
    isCurrent: false, providerMappings: [], phases: [], ...overrides,
  };
}

describe('orderSportLeagueSeasons', () => {
  it('lists Seasons latest first, with each Season\'s provider ids by provider name and its phases in play order', () => {
    const mapping = (providerName: string) => ({
      id: `m-${providerName}`, sportLeagueProviderMappingId: 'lm', providerId: `p-${providerName}`, providerName, providerLeagueCode: 'nfl', providerSeasonId: '2026',
    });
    const ordered = orderSportLeagueSeasons([
      season('s2025', 2025),
      season('s2026', 2026, {
        providerMappings: [mapping('Zeta'), mapping('Alpha')],
        phases: [
          { id: 'post', phase: LeaguePhase.POSTSEASON, isSynced: true, slots: [] },
          { id: 'reg', phase: LeaguePhase.REGULAR, isSynced: true, slots: [] },
        ],
      }),
    ]);

    expect(ordered.map((each) => each.id)).toEqual(['s2026', 's2025']);
    expect(ordered[0]?.providerMappings.map((each) => each.providerName)).toEqual(['Alpha', 'Zeta']);
    expect(ordered[0]?.phases.map((each) => each.phase)).toEqual([LeaguePhase.REGULAR, LeaguePhase.POSTSEASON]);
  });

  it('puts weeks in number order, knockout rounds after them, tournaments by start with undated ones last, and each test slot after its synced slot by label', () => {
    const [ordered] = orderSportLeagueSeasons([season('s', 2026, {
      phases: [{
        id: 'p', phase: LeaguePhase.REGULAR, isSynced: true, slots: [
          slot('final', { slotKind: SlotKind.FINAL }),
          slot('week-2', { id: 'week-2-test-b', weekNumber: 2, isTestData: true, label: 'B' }),
          slot('week-2', { id: 'week-2', weekNumber: 2 }),
          slot('week-2', { id: 'week-2-test-a', weekNumber: 2, isTestData: true, label: 'A' }),
          slot('week-1', { weekNumber: 1 }),
        ],
      }, {
        id: 't', phase: LeaguePhase.POSTSEASON, isSynced: true, slots: [
          slot('undated', { slotKind: SlotKind.TOURNAMENT }),
          slot('june', { slotKind: SlotKind.TOURNAMENT, startsAt: at('2026-06-01T00:00:00Z') }),
          slot('april', { slotKind: SlotKind.TOURNAMENT, startsAt: at('2026-04-01T00:00:00Z') }),
        ],
      }],
    })]);

    expect(ordered.phases[0]?.slots.map((each) => each.id)).toEqual(['slot-week-1', 'week-2', 'week-2-test-a', 'week-2-test-b', 'slot-final']);
    expect(ordered.phases[1]?.slots.map((each) => each.key)).toEqual(['april', 'june', 'undated']);
  });

  it('orders two undated tournaments by key, and puts an unlabelled test slot before a labelled one', () => {
    const [ordered] = orderSportLeagueSeasons([season('s', 2026, {
      phases: [{
        id: 'p', phase: LeaguePhase.REGULAR, isSynced: true, slots: [
          slot('zurich', { slotKind: SlotKind.TOURNAMENT }),
          slot('dated', { slotKind: SlotKind.TOURNAMENT, startsAt: at('2026-05-01T00:00:00Z') }),
          slot('augusta', { slotKind: SlotKind.TOURNAMENT }),
          slot('week-3', { id: 'week-3-test-a', weekNumber: 3, isTestData: true, label: 'A' }),
          slot('week-3', { id: 'week-3-test', weekNumber: 3, isTestData: true }),
        ],
      }],
    })]);

    expect(ordered.phases[0]?.slots.map((each) => each.id)).toEqual(['week-3-test', 'week-3-test-a', 'slot-dated', 'slot-augusta', 'slot-zurich']);
  });
});

describe('CurrentSeasonRecompute', () => {
  function recompute(facts: SportLeagueCurrentSeasonFacts[]) {
    const seasons = {
      findCurrentSeasonFacts: jest.fn(async () => facts),
      setCurrentSeasons: jest.fn(async (_changes: ReadonlyArray<{ sportLeagueId: string; currentSeasonId: string | null }>) => undefined),
    };
    const logger = { info: jest.fn() };
    return { step: new CurrentSeasonRecompute(seasons, logger as never), seasons, logger };
  }

  it('writes only the leagues whose current Season moved by the one rule, logging each move, and reports how many moved', async () => {
    const { step, seasons, logger } = recompute([
      { sportLeagueId: 'nfl', currentSeasonId: 'nfl-2025', seasons: nfl({ s2026HasSyncedEvent: true }) },
      { sportLeagueId: 'steady', currentSeasonId: 'nfl-2025', seasons: nfl() },
    ]);

    await expect(step.purge(at('2026-06-01T00:00:00Z'))).resolves.toBe(1);

    expect(seasons.setCurrentSeasons).toHaveBeenCalledWith([{ sportLeagueId: 'nfl', currentSeasonId: 'nfl-2026' }]);
    expect(logger.info).toHaveBeenCalledWith(
      { action: 'sportLeague.currentSeason.moved', data: { sportLeagueId: 'nfl', currentSeasonId: 'nfl-2026', previousSeasonId: 'nfl-2025' } },
      expect.any(String),
    );
  });

  it('writes nothing and reports none when every league\'s current Season is already right', async () => {
    const { step, seasons } = recompute([{ sportLeagueId: 'nfl', currentSeasonId: 'nfl-2025', seasons: nfl() }]);

    await expect(step.purge(at('2026-01-20T00:00:00Z'))).resolves.toBe(0);
    expect(seasons.setCurrentSeasons).toHaveBeenCalledWith([]);
  });
});

describe('mapSportLeagueSeasonToDto', () => {
  it('sends dates as ISO strings, an undated slot\'s dates as null, and every field the contract declares', () => {
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const dto = mapSportLeagueSeasonToDto(season(id(1), 2026, {
      isCurrent: true,
      providerMappings: [{ id: id(2), sportLeagueProviderMappingId: id(3), providerId: id(4), providerName: 'BALLDONTLIE', providerLeagueCode: 'nfl', providerSeasonId: '2026' }],
      phases: [{
        id: id(5), phase: LeaguePhase.REGULAR, isSynced: true, slots: [
          { ...slot('week-1', { weekNumber: 1, startsAt: at('2026-09-10T00:00:00Z'), endsAt: at('2026-09-15T00:00:00Z') }), id: id(6), slotDefinitionId: id(7) },
          { ...slot('week-2', { id: 'week-2', weekNumber: 2 }), id: id(8), slotDefinitionId: id(9) },
        ],
      }],
    }));

    expect(SportLeagueSeasonListResponseSchema.parse({ seasons: [dto] })).toEqual({ seasons: [dto] });
    expect(dto).toMatchObject({
      name: '2026', championshipYear: 2026, startsAt: '2026-01-01T00:00:00.000Z', isCurrent: true,
      providerMappings: [{ providerSeasonId: '2026', providerLeagueCode: 'nfl' }],
      phases: [{ slots: [{ startsAt: '2026-09-10T00:00:00.000Z', endsAt: '2026-09-15T00:00:00.000Z' }, { startsAt: null, endsAt: null }] }],
    });
  });
});
