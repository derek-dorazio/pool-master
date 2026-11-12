/**
 * BALLDONTLIE webhook deliveries (#1498), signed the way the vendor signs them: the hex
 * HMAC-SHA256 of `{timestamp}.{body}` under the endpoint secret, sent as `v1=<hex>`. The payloads
 * are the vendor's published examples (www.balldontlie.io/webhooks, "observed" deliveries), so the
 * receiver is tested against the shapes it will really be sent.
 */

import { createHmac, randomUUID } from 'node:crypto';

export const TEST_BALLDONTLIE_WEBHOOK_SECRET = 'whsec_test_0123456789abcdef0123456789abcdef';

/** Recorded notification bodies, by event type. */
export const BALLDONTLIE_WEBHOOK_PAYLOADS = {
  nflGameStarted: { event_type: 'nfl.game.started', game: { id: 424095 } },
  nflGamePeriodEnded: { ended_period: 1, event_type: 'nfl.game.period_ended', game: { id: 424095 } },
  nflGameEnded: { event_type: 'nfl.game.ended', game: { id: 424095 } },
  nflTouchdown: {
    event_type: 'nfl.player.touchdown',
    game: { id: 424095 },
    play: { type: 'passing-touchdown', score_value: 7, period: 3, clock: '11:24', home_score: 6, away_score: 13 },
    player: { id: 102, first_name: 'Deebo', last_name: 'Samuel', position: 'Wide Receiver' },
  },
  ncaabGameEnded: { game: { id: 2798627 }, event_type: 'ncaab.game.ended' },
  ncaawGameEnded: { game: { id: 6100 }, event_type: 'ncaaw.game.ended' },
  nbaGameEnded: { game: { id: 21707974 }, event_type: 'nba.game.ended' },
  eplGameHalftime: {
    game: {
      id: 1922,
      date: '2026-05-09T16:30:00Z',
      season: 2025,
      status: 'STATUS_HALFTIME',
      away_team: { id: 4, name: 'Brentford' },
      home_team: { id: 13, name: 'Manchester City' },
      away_score: 0,
      home_score: 0,
    },
    event_type: 'epl.game.halftime',
  },
  worldCupGameEnded: {
    event_type: 'worldcup.game.ended',
    game: {
      away_score: 3,
      away_team: { id: 33, name: 'France' },
      date: '2022-12-18T15:00:00Z',
      home_score: 3,
      home_team: { id: 37, name: 'Argentina' },
      id: 999,
      season: 2022,
      status: 'STATUS_FINAL_PEN',
    },
  },
  pgaTournamentStarted: {
    event_type: 'pga.tournament.started',
    tournament: { id: 1133, name: 'Insperity Invitational', season: 2026, status: 'IN_PROGRESS' },
  },
  pgaRoundStarted: {
    round: 2,
    event_type: 'pga.tournament.round_started',
    tournament: { id: 1133, name: 'Insperity Invitational', season: 2026, status: 'IN_PROGRESS' },
  },
  pgaPlayerRoundCompleted: {
    round: 3,
    score: 69,
    player: { id: 128, country: 'Scotland', last_name: 'MacIntyre', first_name: 'Robert' },
    event_type: 'pga.player.round_completed',
    tournament: { id: 24, name: 'Truist Championship', season: 2026, status: 'IN_PROGRESS' },
    par_relative_score: -2,
  },
  pgaTournamentEnded: {
    event_type: 'pga.tournament.ended',
    tournament: { id: 1132, name: 'Regions Tradition', season: 2026, status: 'COMPLETED' },
  },
  pgaHoleCompleted: {
    player: { id: 14, country: 'United States', last_name: 'Burns', first_name: 'Sam' },
    scorecard: { par: 5, hole: 15, round: 3, score: 4, result: 'birdie', score_to_par: -1 },
    event_type: 'pga.player.hole_completed',
    tournament: { id: 24, name: 'Truist Championship', season: 2026, status: 'IN_PROGRESS' },
  },
} as const;

export interface SignedBalldontlieDelivery {
  headers: Record<string, string>;
  /** The body exactly as signed. */
  payload: string;
}

/** The hex signature the vendor sends for this timestamp and body under `secret`. */
export function balldontlieSignature(timestamp: string, body: string, secret: string = TEST_BALLDONTLIE_WEBHOOK_SECRET): string {
  return `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

/** A delivery of `body` as BALLDONTLIE posts it, signed at `at` (now by default). */
export function signedBalldontlieDelivery(
  body: object,
  options: { at?: Date; secret?: string; deliveryId?: string } = {},
): SignedBalldontlieDelivery {
  const payload = JSON.stringify(body);
  const timestamp = String(Math.floor((options.at ?? new Date()).getTime() / 1000));
  return {
    payload,
    headers: {
      'content-type': 'application/json',
      'user-agent': 'BDL-Webhook/1.0',
      'x-bdl-webhook-id': options.deliveryId ?? `evt_${randomUUID()}`,
      'x-bdl-webhook-timestamp': timestamp,
      'x-bdl-webhook-signature': balldontlieSignature(timestamp, payload, options.secret),
    },
  };
}
