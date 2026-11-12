import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { BackgroundJobType, Sport, SportEventStatus } from '@poolmaster/shared/domain';
import { ErrorEnvelopeSchema, SuccessResponseSchema } from '@poolmaster/shared/dto';
import { PrismaSportEventRepository, PrismaSportEventRoundRepository } from '../../../packages/core-api/src/adapters';
import { expectMatchesSchema } from '../../support/expect-matches-schema';
import { createRoundRows, createSportEventRow } from '../../support/sport-event-rows';
import { BALLDONTLIE_WEBHOOK_PAYLOADS as PAYLOADS, signedBalldontlieDelivery } from '../../support/balldontlie-webhooks';
import { cleanupTestData, getApp, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';

// BALLDONTLIE's webhook notifications reach POST /api/v1/provider-webhooks/balldontlie (#1498),
// signed with the endpoint secret. A verified notification about a linked, in-progress event
// queues one live-score sync of it, a minute out, which a burst of notifications shares.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const PROVIDER = 'balldontlie';
const URL = '/api/v1/provider-webhooks/balldontlie';

function post(delivery: { headers: Record<string, string>; payload: string }) {
  return getApp().inject({ method: 'POST', url: URL, headers: delivery.headers, payload: delivery.payload });
}

/** A BALLDONTLIE-linked event, one match of it linked to `gameId` when one is named. */
async function linkedEvent(input: {
  sport: Sport;
  externalId: string;
  status?: SportEventStatus;
  gameId?: string;
  startDate?: Date;
  autoLifecycleEnabled?: boolean;
}) {
  const prisma = getPrisma();
  const sport = await prisma.sport.upsert({
    where: { sport: input.sport },
    create: { sport: input.sport, participantType: input.sport === Sport.GOLF ? 'INDIVIDUAL' : 'TEAM', tournamentFormat: input.sport === Sport.GOLF ? 'STROKE_PLAY_TOURNAMENT' : 'MATCHES' },
    update: {},
  });
  const sportLeague = await prisma.sportLeague.create({ data: { sportId: sport.id, name: `League ${randomUUID()}` } });
  const eventSeries = await prisma.eventSeries.create({ data: { sportLeagueId: sportLeague.id, name: `Series ${randomUUID()}` } });
  const event = await createSportEventRow(new PrismaSportEventRepository(getAppPrisma()), {
    eventSeriesId: eventSeries.id,
    eventYear: 2026,
    externalId: input.externalId,
    providerId: PROVIDER,
    sport: input.sport,
    name: input.externalId,
    startDate: input.startDate ?? new Date('2026-11-12T18:00:00.000Z'),
    status: input.status ?? SportEventStatus.IN_PROGRESS,
    rounds: 1,
    syncScope: 'SCORES_ONLY',
    autoLifecycleEnabled: input.autoLifecycleEnabled ?? false,
  });
  if (input.gameId !== undefined) {
    await createRoundRows(new PrismaSportEventRoundRepository(getAppPrisma()), event.id, [{ roundNumber: 1, scheduledDate: event.startDate }]);
    const round = await prisma.sportEventRound.findFirstOrThrow({ where: { sportEventId: event.id } });
    await prisma.sportEventMatch.create({
      data: { sportEventId: event.id, sportEventRoundId: round.id, matchNumber: 1, isNeutralSite: false, externalGameId: input.gameId },
    });
  }
  return event;
}

async function queuedSyncs() {
  const jobs = await getPrisma().backgroundJob.findMany({ where: { type: BackgroundJobType.PROVIDER_EVENT_SYNC }, orderBy: [{ runAt: 'asc' }, { createdAt: 'asc' }] });
  return jobs.map((job) => ({ payload: job.payload, dedupeKey: job.dedupeKey, runAt: job.runAt, createdAt: job.createdAt }));
}

describe('BALLDONTLIE webhook receiver', () => {
  it('queues one live-score sync, a minute out, of the in-progress event whose match is linked to the ended game, and a reconciling one ten minutes out', async () => {
    await linkedEvent({ sport: Sport.AMERICAN_FOOTBALL, externalId: 'nfl-2026-week-11', gameId: '424095' });
    await linkedEvent({ sport: Sport.AMERICAN_FOOTBALL, externalId: 'nfl-2026-postseason' });

    const response = await post(signedBalldontlieDelivery(PAYLOADS.nflGameEnded));

    expect(response.statusCode).toBe(200);
    expectMatchesSchema(SuccessResponseSchema, response.json());
    const syncs = await queuedSyncs();
    const payload = { sport: Sport.AMERICAN_FOOTBALL, providerId: PROVIDER, eventId: 'nfl-2026-week-11' };
    expect(syncs).toEqual([
      expect.objectContaining({ payload, dedupeKey: 'provider-event-sync:balldontlie:nfl-2026-week-11' }),
      expect.objectContaining({ payload, dedupeKey: 'provider-event-reconcile:balldontlie:nfl-2026-week-11' }),
    ]);
    const delaysMs = syncs.map((sync) => sync.runAt.getTime() - sync.createdAt.getTime());
    expect(delaysMs[0]).toBeGreaterThanOrEqual(55_000);
    expect(delaysMs[0]).toBeLessThanOrEqual(65_000);
    expect(delaysMs[1]).toBeGreaterThanOrEqual(595_000);
    expect(delaysMs[1]).toBeLessThanOrEqual(605_000);
  });

  it('syncs every in-progress event of the league while no match is linked to the game yet', async () => {
    await linkedEvent({ sport: Sport.AMERICAN_FOOTBALL, externalId: 'nfl-2026-week-11' });
    await linkedEvent({ sport: Sport.AMERICAN_FOOTBALL, externalId: 'nfl-2026-postseason' });
    // Another league's live event, and the league's own event not yet started, are not the game's.
    await linkedEvent({ sport: Sport.SOCCER, externalId: 'epl-2026-matchweek-11' });
    await linkedEvent({
      sport: Sport.AMERICAN_FOOTBALL,
      externalId: 'nfl-2026-week-12',
      status: SportEventStatus.SCHEDULED,
      startDate: new Date(Date.now() + 24 * 60 * 60_000),
      autoLifecycleEnabled: true,
    });

    expect((await post(signedBalldontlieDelivery(PAYLOADS.nflGameStarted))).statusCode).toBe(200);

    expect((await queuedSyncs()).map((sync) => sync.dedupeKey ?? '').sort((a, b) => a.localeCompare(b))).toEqual([
      'provider-event-sync:balldontlie:nfl-2026-postseason',
      'provider-event-sync:balldontlie:nfl-2026-week-11',
    ]);
  });

  it('queues a golf tournament\'s sync when its round starts', async () => {
    await linkedEvent({ sport: Sport.GOLF, externalId: '1133' });

    expect((await post(signedBalldontlieDelivery(PAYLOADS.pgaRoundStarted))).statusCode).toBe(200);

    expect(await queuedSyncs()).toEqual([expect.objectContaining({
      payload: { sport: Sport.GOLF, providerId: PROVIDER, eventId: '1133' },
    })]);
  });

  it('accepts a delivery with non-ASCII text, signed over its bytes, whose header also carries a retiring secret\'s signature', async () => {
    await linkedEvent({ sport: Sport.SOCCER, externalId: 'epl-2026-matchweek-11' });
    const body = { ...PAYLOADS.eplGameHalftime, game: { ...PAYLOADS.eplGameHalftime.game, home_team: { id: 13, name: 'Atlético São Paulo ⚽' } } };
    const at = new Date();
    const current = signedBalldontlieDelivery(body, { at });
    const retiring = signedBalldontlieDelivery(body, { at, secret: 'whsec_retiring' });

    const response = await post({
      ...current,
      headers: { ...current.headers, 'x-bdl-webhook-signature': `${retiring.headers['x-bdl-webhook-signature']},${current.headers['x-bdl-webhook-signature']}` },
    });

    expect(response.statusCode).toBe(200);
    expect((await queuedSyncs()).map((sync) => sync.dedupeKey)).toEqual(['provider-event-sync:balldontlie:epl-2026-matchweek-11']);
  });

  it('shares one waiting sync among a burst of notifications and a duplicate delivery of the same one, the game\'s end adding its one reconciling sync', async () => {
    await linkedEvent({ sport: Sport.AMERICAN_FOOTBALL, externalId: 'nfl-2026-week-11', gameId: '424095' });
    const delivery = signedBalldontlieDelivery(PAYLOADS.nflGamePeriodEnded);

    const answers = [
      await post(delivery),
      await post(delivery),
      await post(signedBalldontlieDelivery(PAYLOADS.nflGameEnded)),
    ];

    expect(answers.map((answer) => answer.statusCode)).toEqual([200, 200, 200]);
    expect((await queuedSyncs()).map((sync) => sync.dedupeKey)).toEqual([
      'provider-event-sync:balldontlie:nfl-2026-week-11',
      'provider-event-reconcile:balldontlie:nfl-2026-week-11',
    ]);
  });

  it('syncs an event still SCHEDULED past its start when its game starts, six minutes out once the lifecycle sweep has moved it, and records the notification on it', async () => {
    const started = new Date(Date.now() - 2 * 60_000);
    await linkedEvent({
      sport: Sport.AMERICAN_FOOTBALL,
      externalId: 'nfl-2026-week-11',
      status: SportEventStatus.SCHEDULED,
      startDate: started,
      autoLifecycleEnabled: true,
      gameId: '424095',
    });
    // Its admin holds this one's status by hand, so the lifecycle never moves it.
    await linkedEvent({ sport: Sport.AMERICAN_FOOTBALL, externalId: 'nfl-2026-week-11-held', status: SportEventStatus.SCHEDULED, startDate: started });

    const before = Date.now();
    expect((await post(signedBalldontlieDelivery(PAYLOADS.nflGameStarted))).statusCode).toBe(200);

    const syncs = await queuedSyncs();
    expect(syncs.map((sync) => sync.dedupeKey)).toEqual(['provider-event-sync:balldontlie:nfl-2026-week-11']);
    const delayMs = (syncs[0]?.runAt.getTime() ?? 0) - (syncs[0]?.createdAt.getTime() ?? 0);
    expect(delayMs).toBeGreaterThanOrEqual(355_000);
    expect(delayMs).toBeLessThanOrEqual(365_000);
    const events = await getPrisma().sportEvent.findMany({
      where: { providerId: PROVIDER },
      select: { externalId: true, lastProviderNotificationAt: true },
      orderBy: { externalId: 'asc' },
    });
    expect(events[0]?.lastProviderNotificationAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(events[1]).toEqual({ externalId: 'nfl-2026-week-11-held', lastProviderNotificationAt: null });
  });

  it('syncs the NBA playoffs\' in-progress events when an NBA game ends, as for every league with a reader', async () => {
    await linkedEvent({ sport: Sport.BASKETBALL, externalId: 'nba-2025-postseason-round-1' });
    await linkedEvent({ sport: Sport.BASKETBALL, externalId: 'ncaab-2025-tournament' });

    expect((await post(signedBalldontlieDelivery(PAYLOADS.nbaGameEnded))).statusCode).toBe(200);

    expect((await queuedSyncs()).map((sync) => sync.dedupeKey)).toEqual([
      'provider-event-sync:balldontlie:nba-2025-postseason-round-1',
      'provider-event-reconcile:balldontlie:nba-2025-postseason-round-1',
    ]);
  });

  it('acknowledges a notification about nothing linked, or of a kind it does not act on, and queues nothing', async () => {
    await linkedEvent({ sport: Sport.AMERICAN_FOOTBALL, externalId: 'nfl-2026-week-11', gameId: '424095' });

    const answers = [
      await post(signedBalldontlieDelivery(PAYLOADS.pgaTournamentStarted)),
      await post(signedBalldontlieDelivery(PAYLOADS.nbaGameEnded)),
      await post(signedBalldontlieDelivery({ event_type: 'mls.game.ended', game: { id: 7 } })),
      await post(signedBalldontlieDelivery(PAYLOADS.nflTouchdown)),
      // The vendor dashboard's test event.
      await post(signedBalldontlieDelivery({ type: 'test', sport: 'test' })),
    ];

    expect(answers.map((answer) => answer.statusCode)).toEqual([200, 200, 200, 200, 200]);
    expect(await queuedSyncs()).toHaveLength(0);
  });

  it('refuses with 403, queueing nothing, a delivery signed with another secret, one signed too long ago, and one with no signature', async () => {
    await linkedEvent({ sport: Sport.AMERICAN_FOOTBALL, externalId: 'nfl-2026-week-11', gameId: '424095' });
    const unsigned = signedBalldontlieDelivery(PAYLOADS.nflGameEnded);
    const headersWithoutSignature = Object.fromEntries(Object.entries(unsigned.headers)
      .filter(([name]) => name !== 'x-bdl-webhook-signature'));

    const answers = [
      await post(signedBalldontlieDelivery(PAYLOADS.nflGameEnded, { secret: 'whsec_someone_else' })),
      await post(signedBalldontlieDelivery(PAYLOADS.nflGameEnded, { at: new Date(Date.now() - 10 * 60_000) })),
      await post({ headers: headersWithoutSignature, payload: unsigned.payload }),
    ];

    for (const answer of answers) {
      expect(answer.statusCode).toBe(403);
      expect(expectMatchesSchema(ErrorEnvelopeSchema, answer.json()).error.code).toBe('PROVIDER_WEBHOOK_UNVERIFIED');
    }
    expect(await queuedSyncs()).toHaveLength(0);
  });

  it('refuses with 400 a correctly signed body that is not a notification', async () => {
    const response = await post(signedBalldontlieDelivery({ event_type: 'nfl.game.ended', game: { id: 'not-a-game-id' } }));

    expect(response.statusCode).toBe(400);
    expectMatchesSchema(ErrorEnvelopeSchema, response.json());
  });
});
