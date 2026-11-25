/**
 * A sport league's Seasons (#2003): the one current-Season rule every reader goes through, the
 * Seasons the events sync reads, the Seasons' one order with their phases and slots, the daily
 * recompute that writes the current Season, and the DTO the API sends.
 */
import { expect, jest } from '@jest/globals';
import {
  currentSeasonOf,
  eventDatesFromSlots,
  testEventSlotRefusal,
  LeaguePhase,
  orderSportLeagueSeasons,
  SeasonSlotStatus,
  seasonsToSync,
  SeriesFormat,
  SlotKind,
  SlotPairing,
  slotNeedsDates,
  SlotWindowStatus,
  type CurrentSeasonCandidate,
  type SportLeagueSeasonDetail,
  type SportLeagueSeasonPhaseSlot,
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

function slot(key: string, overrides: Partial<SportLeagueSeasonPhaseSlot> = {}): SportLeagueSeasonPhaseSlot {
  return {
    id: `slot-${key}`, slotDefinitionId: `def-${key}`, key, slotKind: SlotKind.WEEK, weekNumber: null, name: null,
    startsAt: null, endsAt: null, status: SeasonSlotStatus.SCHEDULED, seriesFormat: SeriesFormat.SINGLE_GAME, seriesGames: 1,
    pairing: SlotPairing.FIXED, isTestData: false, label: null, window: null, sportEventId: null, placedByWindow: false, ...overrides,
  };
}

function season(id: string, year: number, overrides: Partial<SportLeagueSeasonDetail> = {}): SportLeagueSeasonDetail {
  return {
    id, sportLeagueId: 'league', name: String(year), championshipYear: year,
    startsAt: at(`${year}-01-01T00:00:00Z`), endsAt: at(`${year}-12-31T00:00:00Z`),
    isCurrent: false, readBySync: false, providerMappings: [], phases: [], ...overrides,
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

describe('the slots that still need dates (#2012, #1924)', () => {
  const window = (status: SlotWindowStatus) => ({ startsAt: at('2026-12-30T10:00:00Z'), endsAt: at('2027-01-02T12:00:00Z'), status });

  it('needs dates for a slot placed by date window with no window, or only a tentative one, and none once its window is confirmed', () => {
    expect(slotNeedsDates({ placedByWindow: true, window: null })).toBe(true);
    expect(slotNeedsDates({ placedByWindow: true, window: window(SlotWindowStatus.TENTATIVE) })).toBe(true);
    expect(slotNeedsDates({ placedByWindow: true, window: window(SlotWindowStatus.CONFIRMED) })).toBe(false);
  });

  it('never needs dates for a slot its provider places by code, window or none', () => {
    expect(slotNeedsDates({ placedByWindow: false, window: null })).toBe(false);
  });

  it('flags each needing slot of a Season the sync reads, with counts per phase and Season, sends its window, and flags none in a Season the sync no longer reads', () => {
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const playoff = (readBySync: boolean) => season(id(1), 2026, {
      readBySync,
      phases: [{
        id: id(2), phase: LeaguePhase.POSTSEASON, isSynced: true, slots: [
          { ...slot('ROUND_OF_16', { placedByWindow: true, window: window(SlotWindowStatus.TENTATIVE) }), id: id(3), slotDefinitionId: id(4) },
          { ...slot('QUARTERFINAL', { placedByWindow: true, window: window(SlotWindowStatus.CONFIRMED) }), id: id(5), slotDefinitionId: id(6) },
          { ...slot('FINAL', { placedByWindow: true }), id: id(7), slotDefinitionId: id(8) },
        ],
      }],
    });

    const open = mapSportLeagueSeasonToDto(playoff(true));
    expect(SportLeagueSeasonListResponseSchema.parse({ seasons: [open] })).toEqual({ seasons: [open] });
    expect(open.slotsNeedingDates).toBe(2);
    expect(open.phases[0].slotsNeedingDates).toBe(2);
    expect(open.phases[0].slots.map((each) => [each.key, each.needsDates])).toEqual([['ROUND_OF_16', true], ['QUARTERFINAL', false], ['FINAL', true]]);
    expect(open.phases[0].slots[0].window).toEqual({ startsAt: '2026-12-30T10:00:00.000Z', endsAt: '2027-01-02T12:00:00.000Z', status: SlotWindowStatus.TENTATIVE });

    const ended = mapSportLeagueSeasonToDto(playoff(false));
    expect(ended.slotsNeedingDates).toBe(0);
    expect(ended.phases[0].slots.some((each) => each.needsDates)).toBe(false);
  });
});

describe('eventDatesFromSlots', () => {
  const span = (startsAt: string | null, endsAt: string | null) => ({ startsAt: startsAt === null ? null : at(startsAt), endsAt: endsAt === null ? null : at(endsAt) });

  it('takes the earliest start and the latest end of several slots, whatever their order', () => {
    expect(eventDatesFromSlots([
      span('2026-03-20T00:00:00Z', '2026-03-22T00:00:00Z'),
      span('2026-03-13T00:00:00Z', '2026-03-15T00:00:00Z'),
      span('2026-03-27T00:00:00Z', '2026-03-29T00:00:00Z'),
    ])).toEqual({ startDate: at('2026-03-13T00:00:00Z'), endDate: at('2026-03-29T00:00:00Z') });
  });

  it('leaves the end null while any slot has no end, keeping the earliest start', () => {
    expect(eventDatesFromSlots([span('2026-03-13T00:00:00Z', '2026-03-15T00:00:00Z'), span('2026-03-20T00:00:00Z', null)]))
      .toEqual({ startDate: at('2026-03-13T00:00:00Z'), endDate: null });
  });

  it('starts from the slots that have a start, and is null when none has one yet', () => {
    expect(eventDatesFromSlots([span(null, null), span('2026-03-20T00:00:00Z', '2026-03-22T00:00:00Z')]))
      .toEqual({ startDate: at('2026-03-20T00:00:00Z'), endDate: null });
    expect(eventDatesFromSlots([span(null, null), span(null, null)])).toBeNull();
  });

  it('is null for an event with no slots, which keeps the feed\'s dates', () => {
    expect(eventDatesFromSlots([])).toBeNull();
  });
});

describe('testEventSlotRefusal', () => {
  it('lets a free test slot of the current Season take a test event', () => {
    expect(testEventSlotRefusal({ isTestData: true, sportEventId: null }, true)).toBeNull();
  });

  it('refuses a slot the sync keeps first, then a test slot outside the current Season, then one already taken', () => {
    expect(testEventSlotRefusal({ isTestData: false, sportEventId: 'event-1' }, false)).toBe('SEASON_SLOT_NOT_TEST');
    expect(testEventSlotRefusal({ isTestData: true, sportEventId: 'event-1' }, false)).toBe('SEASON_SLOT_NOT_CURRENT');
    expect(testEventSlotRefusal({ isTestData: true, sportEventId: 'event-1' }, true)).toBe('SEASON_SLOT_TAKEN');
  });
});

describe('mapSportLeagueSeasonToDto: which slots take a test event', () => {
  it('says a free test slot of the current Season takes one, and a taken, synced or past-Season slot does not', () => {
    const phaseOf = (slots: SportLeagueSeasonPhaseSlot[]) => [{ id: 'p', phase: LeaguePhase.REGULAR, isSynced: true, slots }];
    const current = mapSportLeagueSeasonToDto(season('s-now', 2026, {
      isCurrent: true,
      phases: phaseOf([
        slot('free', { isTestData: true, label: 'QA 1' }),
        slot('taken', { isTestData: true, label: 'QA 2', sportEventId: 'event-1' }),
        slot('synced'),
      ]),
    }));
    const past = mapSportLeagueSeasonToDto(season('s-past', 2025, { phases: phaseOf([slot('old', { isTestData: true, label: 'QA 3' })]) }));

    expect(current.phases.flatMap((phase) => phase.slots).map((each) => [each.key, each.takesTestEvent])).toEqual([
      ['free', true], ['taken', false], ['synced', false],
    ]);
    expect(past.phases.flatMap((phase) => phase.slots).map((each) => each.takesTestEvent)).toEqual([false]);
  });
});
