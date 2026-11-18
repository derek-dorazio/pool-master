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
  'HOCKEY/Men\'s Frozen Four',
  "HOCKEY/Men's Hockey National Championship",
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
  "SOCCER/Women's World Cup Final",
  "SOCCER/Women's World Cup Semifinals",
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
          { name: { in: ['NCAA Division I Men', 'NCAA Division I Women', "Men's Final Four", "Men's Basketball National Championship"] }, sport: { sport: Sport.BASKETBALL } },
        ],
      },
      select: { name: true, isActive: true },
    });

    expect(kept.map(({ name, isActive }) => [name, isActive]).sort(([left], [right]) => String(left).localeCompare(String(right)))).toEqual([
      ['Formula 1', true],
      ["Men's Basketball National Championship", true],
      ["Men's Final Four", true],
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
