/**
 * Where a game is played lives on the Game (#2047), in real Postgres: each Game of a match has its
 * own venue and location, empty until a feed sends one, and the match repository reads them with
 * the Game. A golf course stays on its event. No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { HomeAway, Sport } from '@poolmaster/shared/domain';
import type { MatchSideWrite } from '@poolmaster/shared/db';
import {
  PrismaSportEventRepository,
  PrismaSportEventRoundMatchRepository,
  PrismaSportEventRoundRepository,
} from '../../../packages/core-api/src/adapters';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { createRoundRows, createSportEventRow } from '../../support/sport-event-rows';
import { fixtureSeasonId } from '../../support/event-edition';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { sportPlay } from '../../support/sport-play';
import { sportRowKeys } from '../../support/sport-rows';

beforeAll(async () => {
  await setupIntegrationTests();
  await cleanupTestData();
});
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

const sides = (): MatchSideWrite[] => [
  { sideNumber: 1, sportEventParticipantId: null, homeAway: HomeAway.AWAY },
  { sideNumber: 2, sportEventParticipantId: null, homeAway: HomeAway.HOME },
];

/** A one-match basketball event, its match's Game 1 as the bracket write makes it. */
async function oneMatchEvent() {
  const prisma = getPrisma();
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.BASKETBALL },
    create: { sport: Sport.BASKETBALL, ...sportRowKeys(Sport.BASKETBALL) },
    update: {},
  });
  const sportLeague = await prisma.sportLeague.upsert({
    where: { sportId_name: { sportId: sport.id, name: 'NBA' } },
    create: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: 'NBA' },
    update: {},
  });
  const event = await createSportEventRow(new PrismaSportEventRepository(getAppPrisma()), {
    sportLeagueId: sportLeague.id,
    sportLeagueSeasonId: await fixtureSeasonId(prisma, sportLeague.id, 2027),
    name: `Game Venue ${randomUUID().slice(0, 8)}`,
    startDate: new Date('2027-04-18T16:00:00.000Z'),
    status: 'SCHEDULED',
    autoLifecycleEnabled: false,
  });
  await createRoundRows(prisma, new PrismaSportEventRoundRepository(getAppPrisma()), event, [{ roundNumber: 1, scheduledDate: new Date('2027-04-18T16:00:00.000Z') }]);
  const matchId = randomUUID();
  const matches = new PrismaSportEventRoundMatchRepository(getAppPrisma());
  await matches.replaceBracket(event.id, [
    { id: matchId, roundNumber: 1, matchNumber: 1, sides: sides(), isNeutralSite: false, scheduledDate: null, advancesToMatchId: null, advancesToSideNumber: null, regionLabel: null },
  ]);
  return { event, matchId, matches };
}

describe('a Game\'s venue and location', () => {
  it('leaves a new Game with no venue or location, since no feed has sent one', async () => {
    const { event, matches } = await oneMatchEvent();

    const [match] = await matches.findBySportEvent(event.id);

    expect(match.games.map(({ venue, location }) => ({ venue, location }))).toEqual([{ venue: null, location: null }]);
  });

  it('reads back the venue and location stored on the Game with the match', async () => {
    const { event, matchId, matches } = await oneMatchEvent();
    await getPrisma().sportEventRoundMatchGame.updateMany({
      where: { sportEventRoundMatchId: matchId },
      data: { venue: 'Madison Square Garden', location: 'New York, NY' },
    });

    const [match] = await matches.findBySportEvent(event.id);

    expect(match.games.map(({ venue, location }) => ({ venue, location }))).toEqual([{ venue: 'Madison Square Garden', location: 'New York, NY' }]);
  });
});
