import type { ChipProps } from '@/features/shared/ui';
import type { ProviderSummaryDto } from '@/lib/api';
import { plural } from '@/lib/plural';

export type ProviderStatus = ProviderSummaryDto['status'];

export const PROVIDER_STATUS_TONES: Record<ProviderStatus, ChipProps['tone']> = {
  HEALTHY: 'success',
  DEGRADED: 'warning',
  DOWN: 'danger',
};

/** The share of calls that failed in the last hour, as a percent to one place. */
export function errorRatePercent(provider: Pick<ProviderSummaryDto, 'errorRate'>): number {
  return Math.round(provider.errorRate * 1000) / 10;
}

/** A request rate a minute, or "Not paced" for a provider that does not pace its calls. */
export function requestsPerMinuteText(provider: Pick<ProviderSummaryDto, 'requestsPerMinute'>): string {
  return provider.requestsPerMinute === null ? 'Not paced' : String(provider.requestsPerMinute);
}

/** The header's count line: how many providers, and how many of them are up. */
export function providersCountLine(providers: readonly ProviderSummaryDto[]): string {
  const up = providers.filter((provider) => provider.status === 'HEALTHY').length;
  return `${plural(providers.length, 'provider')} · ${String(up)} up`;
}
