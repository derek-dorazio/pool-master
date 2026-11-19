import { createColumnHelper } from '@tanstack/react-table';
import { ProviderHealthStatusOrder, type ProviderHealthStatus } from '@poolmaster/shared/domain';
import type { ProviderSummaryDto } from '@/lib/api';
import { errorRatePercent, PROVIDER_STATUS_LABELS, requestsPerMinuteText } from './provider-facts';
import { ProviderStatusChip } from './provider-status-chip';

const columnHelper = createColumnHelper<ProviderSummaryDto>();

/** The Providers grid's columns (#1873), each explained behind its (i). */
export const providerColumns = [
  columnHelper.accessor('providerName', {
    header: 'Provider',
    meta: { info: 'The sports data provider.', type: { kind: 'text' } },
  }),
  columnHelper.accessor('status', {
    header: 'Status',
    meta: {
      info: 'Up, Slow or Down, from a live check made as the page loads and the last hour of calls.',
      type: { kind: 'enum', order: ProviderHealthStatusOrder, label: (status) => PROVIDER_STATUS_LABELS[status as ProviderHealthStatus] },
    },
    cell: ({ getValue }) => <ProviderStatusChip status={getValue()} />,
  }),
  columnHelper.accessor('requestsPerMinute', {
    header: 'Requests a minute',
    meta: { info: 'The rate limit we hold our calls to, set in Terraform. Not paced: the provider sets no limit.', type: { kind: 'number' } },
    cell: ({ row }) => requestsPerMinuteText(row.original),
  }),
  columnHelper.accessor('syncedSportLeagueCount', {
    header: 'Sport leagues',
    meta: { info: 'Active sport leagues whose events this provider\'s sync creates.', type: { kind: 'number' } },
  }),
  columnHelper.accessor(errorRatePercent, {
    id: 'errorRate',
    header: 'Error rate (1 h)',
    meta: { info: 'Share of calls that failed in the last hour, from the live check.', type: { kind: 'number' } },
    cell: ({ getValue }) => `${String(getValue())}%`,
  }),
  columnHelper.accessor('rateLimitedJobsLast24h', {
    header: 'Rate limited (24 h)',
    meta: { info: 'Jobs for this provider that hit its rate limit in the last 24 hours.', type: { kind: 'number' } },
  }),
  columnHelper.accessor('latencyMs', {
    header: 'Latency p95 (ms)',
    meta: { info: 'How long the slowest 5% of calls took, from the live check.', type: { kind: 'number' } },
  }),
];
