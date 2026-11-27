/**
 * The sync tick's scores pace for providers that send webhook notifications (#1499), from their
 * Provider rows (#1997): a provider counts as sending them while its webhooks are on (switched on
 * and its signing secret set). Before then nothing arrives, so its events keep polling at the
 * admin's interval. Each poll interval and each league's quiet window is a row value, edited on
 * the Providers page.
 */

import { ProviderCode } from '@poolmaster/shared/domain';
import type { NotifiedProviderCadence } from './sync-tick';
import type { ProviderSettingsStore } from './provider-settings-store';
import type { ProviderWebhookSwitch } from './provider-webhook-switch';

/**
 * The cadence for the providers whose webhooks are on, or undefined when none is. Only
 * BALLDONTLIE sends webhooks, so its row sets the pace.
 */
export function notifiedProviderCadenceOf(
  store: Pick<ProviderSettingsStore, 'byCode'>,
  webhooks: Pick<ProviderWebhookSwitch, 'onProviderIds'>,
): NotifiedProviderCadence | undefined {
  const providerIds = webhooks.onProviderIds();
  const provider = store.byCode(ProviderCode.BALLDONTLIE);
  if (providerIds.length === 0 || provider === undefined) return undefined;
  return {
    providerIds,
    pollIntervalMs: provider.webhookPollMinutes * 60_000,
    roundPollIntervalMs: provider.webhookRoundPollMinutes * 60_000,
  };
}

/**
 * Each provider league's quiet window (`quietAfterMinutes`), by its row's id: how long one of its
 * events may be in play with nothing from its provider. Each league has its own, not one window:
 * a quarter of football and a golf round's wait for its first finisher differ by hours. A league
 * no Provider row has gives zero, which says never.
 */
export function providerLeagueQuietAfterMs(store: Pick<ProviderSettingsStore, 'findLeague'>): (providerLeagueId: string) => number {
  return (providerLeagueId) => (store.findLeague(providerLeagueId)?.league.quietAfterMinutes ?? 0) * 60_000;
}
