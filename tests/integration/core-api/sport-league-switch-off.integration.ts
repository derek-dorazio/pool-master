/**
 * The sport leagues no data provider syncs yet are switched off by migration (#1812): the rows,
 * their contest setups and copy stay, inactive, so a reset database and a new environment keep
 * them off. Read back from real Postgres after every migration has run. No mocks.
 */
import { Sport } from '@poolmaster/shared/domain';
import { getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';

beforeAll(() => setupIntegrationTests());
afterAll(() => teardownIntegrationTests());

/** Every league the migrations switch off, as `SPORT/name`: a name alone repeats across sports. */
const SWITCHED_OFF = [
  'AUTO_RACING/IndyCar',
  'AUTO_RACING/NASCAR Cup Series',
  'CYCLING/UCI WorldTour',
  "CYCLING/UCI Women's WorldTour",
  'HOCKEY/NCAA Division I Men',
  'HOCKEY/NCAA Division I Women',
  'HOCKEY/PWHL',
  'HORSE_RACING/US Thoroughbred',
  'RUNNING/World Marathon Majors (men)',
  'RUNNING/World Marathon Majors (women)',
  'SOCCER/Copa América',
  "SOCCER/FIFA Women's World Cup",
  'SOCCER/NCAA Division I Men',
  'SOCCER/NCAA Division I Women',
  'SOCCER/NWSL',
  'SOCCER/UEFA European Championship',
  'TENNIS/NCAA Division I Men',
  'TENNIS/NCAA Division I Women',
].sort((left, right) => left.localeCompare(right));

describe('Sport leagues with no data provider', () => {
  it('switches off every league no provider syncs, each matched by its sport and name', async () => {
    const leagues = await getPrisma().sportLeague.findMany({ select: { name: true, isActive: true, sport: { select: { sport: true } } } });
    const key = (league: (typeof leagues)[number]) => `${league.sport.sport}/${league.name}`;
    const inactive = leagues.filter((league) => !league.isActive).map(key);

    expect(SWITCHED_OFF.filter((name) => !inactive.includes(name))).toEqual([]);
  });

  it('keeps Formula 1 and every NCAA basketball league on, though NCAA leagues of other sports share their names', async () => {
    const kept = await getPrisma().sportLeague.findMany({
      where: {
        OR: [
          { name: 'Formula 1', sport: { sport: Sport.AUTO_RACING } },
          { name: { in: ['NCAA Division I Men', 'NCAA Division I Women'] }, sport: { sport: Sport.BASKETBALL } },
        ],
      },
      select: { name: true, isActive: true },
    });

    expect(kept.map(({ name, isActive }) => [name, isActive]).sort(([left], [right]) => String(left).localeCompare(String(right)))).toEqual([
      ['Formula 1', true],
      ['NCAA Division I Men', true],
      ['NCAA Division I Women', true],
    ]);
  });

  it('keeps every switched-off league\'s contest setups, so turning it back on is one flip', async () => {
    const setups = await getPrisma().contestConfigTemplate.count({
      where: { sportLeague: { isActive: false, sport: { sport: { in: [Sport.CYCLING, Sport.RUNNING] } } } },
    });

    expect(setups).toBeGreaterThan(0);
  });
});

/**
 * The active leagues no provider feeds, switched off by id (#2072). The names are for the reader;
 * the rows are found by the ids the baseline reference data gave them.
 */
const FEEDLESS_SWITCHED_OFF: Record<string, string> = {
  'c4d2cda5-f6df-4156-8fc2-26bfb5b3352d': 'LPGA Tour',
  '1d4245e7-27e5-4386-bb2f-fad87ef7b8e5': 'MLS',
  '6fa88e2c-e828-40f4-9ba1-be3302e54d18': 'ATP',
  '89753830-f4b5-4c3e-8f30-8dac2465061b': 'WTA',
  '5e1930aa-989b-4b92-85f0-a3d604f4a546': 'UEFA Champions League',
};
/**
 * Formula 1, active with no feed yet only because slice 10d (#2045) builds its feed. If 10d has not
 * landed before QA is rebuilt (slice 29), Formula 1 is switched off too and this exception goes.
 */
const FORMULA_1_ID = '7ec9d58e-cfa0-4f8e-b7b5-1986cce18d37';

describe('Active sport leagues with no feed', () => {
  it('switches off the LPGA Tour, MLS, the ATP, the WTA and the Champions League, which no provider league maps', async () => {
    const leagues = await getPrisma().sportLeague.findMany({
      where: { id: { in: Object.keys(FEEDLESS_SWITCHED_OFF) } },
      select: { id: true, isActive: true },
    });

    expect(Object.fromEntries(leagues.map(({ id, isActive }) => [FEEDLESS_SWITCHED_OFF[id], isActive]))).toEqual(
      Object.fromEntries(Object.values(FEEDLESS_SWITCHED_OFF).map((name) => [name, false])),
    );
  });

  it('leaves no league active without a provider mapping but Formula 1, whose feed is still to come', async () => {
    const unfed = await getPrisma().sportLeague.findMany({
      where: { isActive: true, sportLeagueProviderMappings: { none: {} } },
      select: { id: true },
    });

    expect(unfed.map(({ id }) => id)).toEqual([FORMULA_1_ID]);
  });

  it('keeps the switched-off leagues\' contest setups, so a feed brings each back with one flip', async () => {
    const setups = await getPrisma().contestConfigTemplate.groupBy({
      by: ['sportLeagueId'],
      where: { sportLeagueId: { in: Object.keys(FEEDLESS_SWITCHED_OFF) } },
      _count: { _all: true },
    });

    expect(setups.map(({ sportLeagueId }) => FEEDLESS_SWITCHED_OFF[sportLeagueId]).sort()).toEqual(
      Object.values(FEEDLESS_SWITCHED_OFF).sort(),
    );
  });
});
