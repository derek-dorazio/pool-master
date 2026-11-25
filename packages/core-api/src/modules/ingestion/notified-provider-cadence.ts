/**
 * The live-score sweep's pace for providers that send webhook notifications (#1499), from their
 * Provider rows (#1997): a provider counts as sending them while its webhooks are on (switched on
 * and its signing secret set). Before then nothing arrives, so its events keep polling at the
 * admin's interval. Each poll interval and each league's quiet window is a row value, edited on
 * the Providers page.
 */

import { ProviderCode } from '@poolmaster/shared/domain';
import type { NotifiedProviderCadence } from './core/ingestion-scheduler';
import { balldontlieQuietAfterMs } from './adapters/balldontlie/balldontlie-webhooks';
import type { ProviderSettingsStore } from './provider-settings-store';
import type { ProviderWebhookSwitch } from './provider-webhook-switch';

/**
 * The cadence for the providers whose webhooks are on, or undefined when none is. Only
 * BALLDONTLIE sends webhooks, so its row sets the pace.
 */
export function notifiedProviderCadenceOf(
  store: Pick<ProviderSettingsStore, 'byCode' | 'enabledLeagues'>,
  webhooks: Pick<ProviderWebhookSwitch, 'onProviderIds'>,
): NotifiedProviderCadence | undefined {
  const providerIds = webhooks.onProviderIds();
  const provider = store.byCode(ProviderCode.BALLDONTLIE);
  if (providerIds.length === 0 || provider === undefined) return undefined;
  const leagues = store.enabledLeagues(ProviderCode.BALLDONTLIE);
  return {
    providerIds,
    pollIntervalMs: provider.webhookPollMinutes * 60_000,
    roundPollIntervalMs: provider.webhookRoundPollMinutes * 60_000,
    // Each league's own gap between notifications, not one window: a quarter of football
    // and a golf round's wait for its first finisher differ by hours.
    quietAfterMs: (_sport, event) => balldontlieQuietAfterMs(leagues, event.providerLeagueCode),
  };
}
