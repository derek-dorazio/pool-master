/**
 * The live-score sweep's pace for providers that send webhook notifications (#1499), read from
 * the environment at startup. A provider counts as sending them once its webhook signing secret
 * is set: before then nothing arrives, so its events keep polling at the admin's interval.
 *
 * Each value may be overridden in seconds; one that is not a whole number of seconds of at least
 * one stops startup, rather than quietly polling at a pace nobody chose.
 */

import { z } from 'zod';
import type { NotifiedProviderCadence } from './core/ingestion-scheduler';
import { BALLDONTLIE_PROVIDER_ID } from './adapters/balldontlie/pga-mapping';
import { readBalldontlieWebhookSecret } from './provider-webhook-routes';

/** Each notified event's safety-net poll: 15 minutes (Derek, 2026-11-12). */
export const DEFAULT_NOTIFIED_POLL_SECONDS = 15 * 60;
/** A golf event's poll while a round is under way, since golf is not notified hole by hole. */
export const DEFAULT_NOTIFIED_ROUND_POLL_SECONDS = 2 * 60;
/** How long play may go on with no notification before the sweep warns. */
export const DEFAULT_NOTIFIED_QUIET_AFTER_SECONDS = 20 * 60;

const SecondsSchema = z.coerce.number().int().min(1);

function seconds(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const parsed = SecondsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${name} must be a whole number of seconds, at least 1; it is "${raw}".`);
  }
  return parsed.data;
}

/** The cadence for the providers whose webhook secret is set, or undefined when none is. */
export function readNotifiedProviderCadence(env: NodeJS.ProcessEnv): NotifiedProviderCadence | undefined {
  const providerIds = readBalldontlieWebhookSecret(env) === undefined ? [] : [BALLDONTLIE_PROVIDER_ID];
  if (providerIds.length === 0) return undefined;
  return {
    providerIds,
    pollIntervalMs: seconds(env, 'PROVIDER_WEBHOOK_POLL_SECONDS', DEFAULT_NOTIFIED_POLL_SECONDS) * 1000,
    roundPollIntervalMs: seconds(env, 'PROVIDER_WEBHOOK_ROUND_POLL_SECONDS', DEFAULT_NOTIFIED_ROUND_POLL_SECONDS) * 1000,
    quietAfterMs: seconds(env, 'PROVIDER_WEBHOOK_QUIET_AFTER_SECONDS', DEFAULT_NOTIFIED_QUIET_AFTER_SECONDS) * 1000,
  };
}
