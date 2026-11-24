import type { ChipProps } from '@/features/shared/ui';
import type { ProviderSummaryDto } from '@/lib/api';
import { plural } from '@/lib/plural';

export type ProviderStatus = NonNullable<ProviderSummaryDto['status']>;

export const PROVIDER_STATUS_TONES: Record<ProviderStatus, ChipProps['tone']> = {
  HEALTHY: 'success',
  DEGRADED: 'warning',
  DOWN: 'danger',
};

/** The share of calls that failed in the last hour, as a percent to one place; null when the provider is not running. */
export function errorRatePercent(provider: Pick<ProviderSummaryDto, 'errorRate'>): number | null {
  return provider.errorRate === null ? null : Math.round(provider.errorRate * 1000) / 10;
}

/** The error rate as the page shows it. */
export function errorRateText(provider: Pick<ProviderSummaryDto, 'errorRate'>): string {
  const percent = errorRatePercent(provider);
  return percent === null ? 'Not running' : `${String(percent)}%`;
}

/** The p95 latency as the page shows it. */
export function latencyText(provider: Pick<ProviderSummaryDto, 'latencyMs'>): string {
  return provider.latencyMs === null ? 'Not running' : `${String(provider.latencyMs)} ms`;
}

/** A request rate a minute, or "Not paced" for a provider that does not pace its calls. */
export function requestsPerMinuteText(provider: Pick<ProviderSummaryDto, 'requestsPerMinute'>): string {
  return provider.requestsPerMinute === null ? 'Not paced' : String(provider.requestsPerMinute);
}

/** Whether a provider's webhooks are on, or why they are off. */
export function webhooksText(provider: Pick<ProviderSummaryDto, 'webhooksEnabled' | 'settings'>): string {
  if (provider.webhooksEnabled) return 'On';
  if (provider.settings?.webhooksEnabled === true && !provider.settings.webhookSecretSet) return 'Off: switched on, but its signing secret is not set';
  return 'Off';
}

/** The header's count line: how many providers, and how many of them are up. */
export function providersCountLine(providers: readonly ProviderSummaryDto[]): string {
  const up = providers.filter((provider) => provider.status === 'HEALTHY').length;
  return `${plural(providers.length, 'provider')} · ${String(up)} up`;
}
