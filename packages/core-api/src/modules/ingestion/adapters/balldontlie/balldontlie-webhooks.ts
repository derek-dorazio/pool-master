/**
 * BALLDONTLIE webhooks (#1498): which notifications PoolMaster subscribes to, how one is read
 * into a `ProviderNotification`, and how its signature is checked. The vendor's webhook API and
 * delivery headers are documented at www.balldontlie.io/webhooks and in its
 * `webhooks-openapi.yml`.
 *
 * Coarse events only (plan Q4): a game starting, a period ending and the game ending; a soccer
 * match's halftime stands for its period. Golf takes a tournament starting, a round starting, a
 * player's round completing and the tournament ending (Derek, 2026-11-11), not each hole: golf
 * polls every 2 minutes during a round instead. Per-play events are never subscribed, since each
 * notification only triggers a REST read of the whole game.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { ProviderWebhookEventSet, type ProviderLeagueSettings } from '@poolmaster/shared/domain';
import type { BalldontlieWebhookNotification } from '@poolmaster/shared/dto';
import type { ProviderNotification, ProviderNotificationPhase } from '../../provider-notifications';
import { BALLDONTLIE_PROVIDER_ID } from './pga-mapping';

/** The provider leagues a notification is read against: BALLDONTLIE's enabled league rows (#1997). */
export type BalldontlieWebhookLeague = Pick<ProviderLeagueSettings, 'code' | 'sport' | 'webhookEventSet' | 'quietAfterMinutes'>;

/** The vendor's game event names for each event set, without the league key. */
const GAME_EVENTS_BY_SET: Readonly<Record<ProviderWebhookEventSet, readonly string[]>> = {
  [ProviderWebhookEventSet.GAME_PERIODS]: ['game.started', 'game.period_ended', 'game.ended'],
  [ProviderWebhookEventSet.GAME_HALVES]: ['game.started', 'game.halftime', 'game.ended'],
  // Golf's events name a tournament, not a league's game.
  [ProviderWebhookEventSet.GOLF_ROUNDS]: [],
  // A league with no notifications subscribes to none.
  [ProviderWebhookEventSet.NONE]: [],
};

/** Where in play each subscribed game event falls (#1499). */
const GAME_EVENT_PHASES: Readonly<Record<string, ProviderNotificationPhase>> = {
  'game.started': 'START',
  'game.period_ended': 'PROGRESS',
  'game.halftime': 'PROGRESS',
  'game.ended': 'END',
};

/**
 * Golf's subscribed events, each about a PGA TOUR tournament, whose id is the event's id, with
 * where in play each falls.
 */
const GOLF_EVENT_PHASES: Readonly<Record<string, ProviderNotificationPhase>> = {
  'pga.tournament.started': 'START',
  'pga.tournament.round_started': 'START',
  'pga.player.round_completed': 'PROGRESS',
  'pga.tournament.ended': 'END',
};

/**
 * What a notification is about, or null for one PoolMaster does not act on: a league with no
 * enabled row, an event type not subscribed to, or one without the game or tournament it names.
 */
export function readBalldontlieNotification(body: BalldontlieWebhookNotification, leagues: readonly BalldontlieWebhookLeague[]): ProviderNotification | null {
  const notificationType = body.event_type;
  if (notificationType === undefined) return null;
  const golfPhase = Object.hasOwn(GOLF_EVENT_PHASES, notificationType) ? GOLF_EVENT_PHASES[notificationType] : undefined;
  if (golfPhase !== undefined) {
    const golf = leagues.find((league) => league.webhookEventSet === ProviderWebhookEventSet.GOLF_ROUNDS);
    return body.tournament && golf
      ? {
          providerId: BALLDONTLIE_PROVIDER_ID,
          sport: golf.sport,
          notificationType,
          phase: golfPhase,
          subject: 'EVENT',
          eventId: String(body.tournament.id),
        }
      : null;
  }
  const separator = notificationType.indexOf('.');
  const code = notificationType.slice(0, separator);
  const league = leagues.find((candidate) => candidate.code === code);
  const gameEvent = notificationType.slice(separator + 1);
  if (league === undefined || !GAME_EVENTS_BY_SET[league.webhookEventSet].includes(gameEvent) || !body.game) {
    return null;
  }
  return {
    providerId: BALLDONTLIE_PROVIDER_ID,
    sport: league.sport,
    notificationType,
    // Every set's game events have a phase in GAME_EVENT_PHASES.
    phase: GAME_EVENT_PHASES[gameEvent],
    subject: 'GAME',
    gameId: String(body.game.id),
    providerLeagueCode: league.code,
  };
}

/** How far a delivery's timestamp may stray from now: the vendor signs each attempt afresh. */
export const BALLDONTLIE_SIGNATURE_TOLERANCE_SECONDS = 300;

const SIGNATURE_PATTERN = /^v1=([0-9a-f]{64})$/;
/** How the signatures in one header are separated: the vendor sends one per active secret while a secret rotates. */
const SIGNATURE_SEPARATOR = /[\s,]+/;
const TIMESTAMP_PATTERN = /^\d{1,12}$/;

export interface BalldontlieSignedDelivery {
  /** The `X-BDL-Webhook-Timestamp` header: Unix seconds. */
  timestamp: string | undefined;
  /**
   * The `X-BDL-Webhook-Signature` header: one or more `v1=<hex HMAC-SHA256>`, separated by commas
   * or spaces (more than one while the endpoint's secret is being rotated).
   */
  signature: string | undefined;
  /** The body's bytes exactly as posted, so re-encoding can never change what was signed. */
  rawBody: Buffer;
}

export type BalldontlieSignatureCheck = 'VALID' | 'MISSING' | 'MALFORMED' | 'STALE' | 'MISMATCH';

/**
 * Whether the delivery was signed with the endpoint's secret: HMAC-SHA256 of
 * `{timestamp}.{body}` over the raw bytes, compared in constant time, with a timestamp within the
 * tolerance of now so a captured delivery cannot be replayed later. The delivery is valid when any
 * of its `v1=` signatures matches; tokens of another scheme are ignored.
 */
export function checkBalldontlieSignature(
  delivery: BalldontlieSignedDelivery,
  secret: string,
  now: Date,
): BalldontlieSignatureCheck {
  if (delivery.timestamp === undefined || delivery.signature === undefined) return 'MISSING';
  const signatures = delivery.signature
    .split(SIGNATURE_SEPARATOR)
    .map((token) => SIGNATURE_PATTERN.exec(token)?.[1])
    .filter((hex): hex is string => hex !== undefined);
  if (signatures.length === 0 || !TIMESTAMP_PATTERN.test(delivery.timestamp)) return 'MALFORMED';
  if (Math.abs(now.getTime() / 1000 - Number(delivery.timestamp)) > BALLDONTLIE_SIGNATURE_TOLERANCE_SECONDS) return 'STALE';
  const expected = createHmac('sha256', secret).update(`${delivery.timestamp}.`).update(delivery.rawBody).digest();
  const matches = signatures.filter((hex) => timingSafeEqual(expected, Buffer.from(hex, 'hex')));
  return matches.length > 0 ? 'VALID' : 'MISMATCH';
}
