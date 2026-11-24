import { enumLabel } from '@poolmaster/shared/display-strings';
import { createColumnHelper } from '@tanstack/react-table';
import { ProviderHealthStatusOrder, type ProviderHealthStatus } from '@poolmaster/shared/domain';
import type { ProviderSummaryDto } from '@/lib/api';
import { errorRatePercent, errorRateText, requestsPerMinuteText } from './provider-facts';
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
      info: 'Up, Slow or Down, from its sync runs of the last hour: Up when none failed, Down when all did, Slow when some did. No runs when none finished in the hour.',
      type: { kind: 'enum', order: ProviderHealthStatusOrder, label: (status) => enumLabel('ProviderHealthStatus', status as ProviderHealthStatus) },
    },
    cell: ({ getValue }) => <ProviderStatusChip status={getValue()} />,
  }),
  columnHelper.accessor('requestsPerMinute', {
    header: 'Requests a minute',
    meta: { info: 'The rate limit we hold our calls to, its plan\'s, set in its settings. Not paced: the provider sets no limit.', type: { kind: 'number' } },
    cell: ({ row }) => requestsPerMinuteText(row.original),
  }),
  columnHelper.accessor('syncedSportLeagueCount', {
    header: 'Sport leagues',
    meta: { info: 'Active sport leagues mapped to one of this provider\'s leagues, whose events its sync creates.', type: { kind: 'number' } },
  }),
  columnHelper.accessor(errorRatePercent, {
    id: 'errorRate',
    header: 'Error rate (1 h)',
    meta: { info: 'Share of its sync runs that failed in the last hour.', type: { kind: 'number' } },
    cell: ({ row }) => errorRateText(row.original),
  }),
  columnHelper.accessor('rateLimitedJobsLast24h', {
    header: 'Rate limited (24 h)',
    meta: { info: 'Jobs for this provider that hit its rate limit in the last 24 hours.', type: { kind: 'number' } },
  }),
];
