import { Sport } from '@poolmaster/shared/domain';
import { BalldontlieWebhookNotificationSchema } from '@poolmaster/shared/dto';
import {
  BALLDONTLIE_WEBHOOK_EVENT_TYPES,
  BALLDONTLIE_WEBHOOK_GAME_LEAGUES,
  checkBalldontlieSignature,
  readBalldontlieNotification,
} from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-webhooks';
import { parseEplScope } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/epl-mapping';
import { parseWorldCupScope } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/fifa-world-cup-mapping';
import { parseNcaaTournamentScope } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/ncaa-tournament-mapping';
import { parseNflScope } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/nfl-mapping';
import {
  BALLDONTLIE_WEBHOOK_PAYLOADS as PAYLOADS,
  TEST_BALLDONTLIE_WEBHOOK_SECRET as SECRET,
  balldontlieSignature,
} from '../../../support/balldontlie-webhooks';

const read = (body: object) => readBalldontlieNotification(BalldontlieWebhookNotificationSchema.parse(body));

describe('reading BALLDONTLIE webhook notifications (#1498)', () => {
  it('reads a subscribed NFL game event as that game\'s notification, for the NFL\'s scopes', () => {
    expect(read(PAYLOADS.nflGameEnded)).toEqual({
      providerId: 'balldontlie',
      sport: Sport.AMERICAN_FOOTBALL,
      notificationType: 'nfl.game.ended',
      subject: 'GAME',
      gameId: '424095',
      eventIdPrefix: 'nfl-',
    });
    expect(read(PAYLOADS.nflGameStarted)).toMatchObject({ subject: 'GAME', gameId: '424095' });
    expect(read(PAYLOADS.nflGamePeriodEnded)).toMatchObject({ subject: 'GAME', gameId: '424095' });
  });

  it('reads each NCAA tournament\'s, the Premier League\'s and the World Cup\'s game events with their own league\'s event prefix', () => {
    expect(read(PAYLOADS.ncaabGameEnded)).toMatchObject({ sport: Sport.BASKETBALL, eventIdPrefix: 'ncaab-', gameId: '2798627' });
    expect(read(PAYLOADS.ncaawGameEnded)).toMatchObject({ sport: Sport.BASKETBALL, eventIdPrefix: 'ncaaw-', gameId: '6100' });
    expect(read(PAYLOADS.eplGameHalftime)).toMatchObject({ sport: Sport.SOCCER, eventIdPrefix: 'epl-', gameId: '1922' });
    expect(read(PAYLOADS.worldCupGameEnded)).toMatchObject({ sport: Sport.SOCCER, eventIdPrefix: 'fifa-wc-', gameId: '999' });
  });

  it('reads golf\'s tournament and round events as the tournament\'s own event, named by its tournament id', () => {
    for (const payload of [PAYLOADS.pgaTournamentStarted, PAYLOADS.pgaRoundStarted, PAYLOADS.pgaTournamentEnded]) {
      expect(read(payload)).toMatchObject({ sport: Sport.GOLF, subject: 'EVENT', eventId: String(payload.tournament.id) });
    }
    expect(read(PAYLOADS.pgaPlayerRoundCompleted)).toEqual({
      providerId: 'balldontlie',
      sport: Sport.GOLF,
      notificationType: 'pga.player.round_completed',
      subject: 'EVENT',
      eventId: '24',
    });
  });

  it('acts on no per-play event, no golf hole, no league without a reader, and no event type it cannot split', () => {
    expect(read(PAYLOADS.nflTouchdown)).toBeNull();
    expect(read(PAYLOADS.pgaHoleCompleted)).toBeNull();
    expect(read(PAYLOADS.nbaGameEnded)).toBeNull();
    expect(read({ event_type: 'test' })).toBeNull();
    expect(read({ type: 'test', sport: 'test' })).toBeNull();
    expect(read({ event_type: 'toString.game.ended', game: { id: 1 } })).toBeNull();
  });

  it('acts on no subscribed event that is missing the game or tournament it should name', () => {
    expect(read({ event_type: 'nfl.game.ended' })).toBeNull();
    expect(read({ event_type: 'pga.tournament.started' })).toBeNull();
  });

  it('subscribes to the coarse game events of every league with a reader and golf\'s four tournament events, never a hole', () => {
    expect(BALLDONTLIE_WEBHOOK_EVENT_TYPES).toEqual(expect.arrayContaining([
      'nfl.game.started', 'nfl.game.period_ended', 'nfl.game.ended',
      'ncaab.game.ended', 'ncaaw.game.ended',
      'epl.game.started', 'epl.game.halftime', 'epl.game.ended',
      'worldcup.game.ended',
      'pga.tournament.started', 'pga.tournament.round_started', 'pga.player.round_completed', 'pga.tournament.ended',
    ]));
    expect(BALLDONTLIE_WEBHOOK_EVENT_TYPES).not.toContain('pga.player.hole_completed');
    expect(BALLDONTLIE_WEBHOOK_EVENT_TYPES.every((type) => read({ event_type: type, game: { id: 1 }, tournament: { id: 1 } }) !== null))
      .toBe(true);
  });

  it('names each league\'s events by the prefix its reader\'s event ids really start with', () => {
    const { nfl, ncaab, ncaaw, epl, worldcup } = BALLDONTLIE_WEBHOOK_GAME_LEAGUES;
    expect(parseNflScope(`${nfl.eventIdPrefix}2026-week-11`)).not.toBeNull();
    expect(parseNcaaTournamentScope(`${ncaab.eventIdPrefix}2025-tournament`)?.league.key).toBe('ncaab');
    expect(parseNcaaTournamentScope(`${ncaaw.eventIdPrefix}2025-tournament`)?.league.key).toBe('ncaaw');
    expect(parseEplScope(`${epl.eventIdPrefix}2026-matchweek-11`)).not.toBeNull();
    expect(parseWorldCupScope(`${worldcup.eventIdPrefix}2026-knockout`)).not.toBeNull();
  });
});

describe('checking a BALLDONTLIE delivery\'s signature (#1498)', () => {
  const now = new Date('2026-11-15T18:00:00.000Z');
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const rawBody = JSON.stringify(PAYLOADS.nflGameEnded);
  const signed = { timestamp, signature: balldontlieSignature(timestamp, rawBody), rawBody };

  it('accepts a delivery signed with the endpoint secret over its timestamp and exact body', () => {
    expect(checkBalldontlieSignature(signed, SECRET, now)).toBe('VALID');
  });

  it('accepts a delivery signed up to five minutes either side of now, since each retry is signed afresh', () => {
    expect(checkBalldontlieSignature(signed, SECRET, new Date(now.getTime() + 300_000))).toBe('VALID');
    expect(checkBalldontlieSignature(signed, SECRET, new Date(now.getTime() - 300_000))).toBe('VALID');
  });

  it('refuses a replay signed more than five minutes ago, or a timestamp from the future', () => {
    expect(checkBalldontlieSignature(signed, SECRET, new Date(now.getTime() + 301_000))).toBe('STALE');
    expect(checkBalldontlieSignature(signed, SECRET, new Date(now.getTime() - 301_000))).toBe('STALE');
  });

  it('refuses a body changed after signing, a different secret, and a signature moved to another timestamp', () => {
    expect(checkBalldontlieSignature({ ...signed, rawBody: rawBody.replace('424095', '424096') }, SECRET, now)).toBe('MISMATCH');
    expect(checkBalldontlieSignature(signed, 'whsec_other', now)).toBe('MISMATCH');
    expect(checkBalldontlieSignature({ ...signed, timestamp: String(Number(timestamp) - 1) }, SECRET, now)).toBe('MISMATCH');
  });

  it('refuses a delivery without both headers, and one whose headers are not the documented format', () => {
    expect(checkBalldontlieSignature({ ...signed, signature: undefined }, SECRET, now)).toBe('MISSING');
    expect(checkBalldontlieSignature({ ...signed, timestamp: undefined }, SECRET, now)).toBe('MISSING');
    expect(checkBalldontlieSignature({ ...signed, signature: signed.signature.replace('v1=', 'v2=') }, SECRET, now)).toBe('MALFORMED');
    expect(checkBalldontlieSignature({ ...signed, signature: 'v1=abc' }, SECRET, now)).toBe('MALFORMED');
    expect(checkBalldontlieSignature({ ...signed, timestamp: '2026-11-15T18:00:00Z' }, SECRET, now)).toBe('MALFORMED');
  });
});
