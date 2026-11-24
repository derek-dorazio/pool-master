import { enumLabel } from '@poolmaster/shared/display-strings';
import { createColumnHelper } from '@tanstack/react-table';
import {
  ProviderSyncFindingKindOrder,
  ProviderSyncFindingSeverityOrder,
  ProviderSyncFindingStatus,
  ProviderSyncFindingStatusOrder,
  type ProviderSyncFindingKind,
  type ProviderSyncFindingSeverity,
} from '@poolmaster/shared/domain';
import { StatusBadge } from '@/features/shared/ui';
import type { ProviderSyncFindingDto } from '@/lib/api';
import { SYNC_FINDING_SEVERITY_TONES, SYNC_FINDING_STATUS_TONES, syncFindingSubject } from './sync-finding-labels';

const columnHelper = createColumnHelper<ProviderSyncFindingDto>();

/** The grid's id for the Sport league column, which the Sports page's Findings links filter on. */
export const SYNC_FINDING_LEAGUE_COLUMN = 'sportLeague';

/** The Findings grid's columns (#1999), each explained behind its (i). */
export const syncFindingColumns = [
  columnHelper.accessor('severity', {
    header: 'Severity',
    meta: {
      info: 'Error: synced data is wrong or missing until someone acts, and it raises the alarm. Warning: something the sync skipped. Info: something it left alone on purpose.',
      type: { kind: 'enum', order: ProviderSyncFindingSeverityOrder, label: (severity) => enumLabel('ProviderSyncFindingSeverity', severity as ProviderSyncFindingSeverity) },
    },
    cell: ({ getValue }) => (
      <StatusBadge tone={SYNC_FINDING_SEVERITY_TONES[getValue()]}>{enumLabel('ProviderSyncFindingSeverity', getValue())}</StatusBadge>
    ),
  }),
  columnHelper.accessor('kind', {
    header: 'Kind',
    meta: {
      info: 'What the sync found.',
      type: { kind: 'enum', order: ProviderSyncFindingKindOrder, label: (kind) => enumLabel('ProviderSyncFindingKind', kind as ProviderSyncFindingKind) },
    },
    cell: ({ getValue }) => enumLabel('ProviderSyncFindingKind', getValue()),
  }),
  columnHelper.accessor((finding) => finding.sportLeague.name, {
    id: SYNC_FINDING_LEAGUE_COLUMN,
    header: 'Sport league',
    meta: { info: 'The sport league it is about. Every finding has one.', type: { kind: 'enum' } },
  }),
  columnHelper.accessor((finding) => syncFindingSubject(finding), {
    id: 'subject',
    header: 'About',
    meta: { info: 'What the feed sent that nothing maps, with the feed\'s name for it; or the event or provider it is about.', type: { kind: 'text' } },
  }),
  columnHelper.accessor((finding) => finding.provider?.name ?? null, {
    id: 'provider',
    header: 'Provider',
    meta: { info: 'The provider it is about, when it is about one.', type: { kind: 'enum' } },
  }),
  columnHelper.accessor('status', {
    header: 'Status',
    meta: {
      info: 'Open until resolved (the sync stopped seeing it, or it was fixed) or waived (accepted, with a note). A waived finding stays waived when the sync sees it again.',
      type: {
        kind: 'enum',
        order: ProviderSyncFindingStatusOrder,
        label: (status) => enumLabel('ProviderSyncFindingStatus', status as ProviderSyncFindingStatus),
        initial: [ProviderSyncFindingStatus.OPEN],
      },
    },
    cell: ({ getValue }) => (
      <StatusBadge tone={SYNC_FINDING_STATUS_TONES[getValue()]}>{enumLabel('ProviderSyncFindingStatus', getValue())}</StatusBadge>
    ),
  }),
  columnHelper.accessor('lastSeenAt', {
    header: 'Last seen',
    meta: { info: 'When the sync last raised it, in your time zone.', type: { kind: 'datetime', direction: 'past' } },
  }),
  columnHelper.accessor('seenCount', {
    header: 'Times seen',
    meta: { info: 'How many sync passes have raised it.', type: { kind: 'number' } },
  }),
];
