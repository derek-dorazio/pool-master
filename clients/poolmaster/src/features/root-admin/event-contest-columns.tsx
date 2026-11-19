import { createColumnHelper } from '@tanstack/react-table';
import { ContestStatusOrder, type ContestStatus } from '@poolmaster/shared/domain';
import { StatusBadge, Text } from '@/features/shared/ui';
import type { SportEventContestDto } from '@/lib/api';
import { CONTEST_STATUS_LABELS, CONTEST_STATUS_TONES } from '@/features/contests/contest-status';

const columnHelper = createColumnHelper<SportEventContestDto>();

/** A contest set up without a template, in the Contest template column. */
export const NO_TEMPLATE = 'None';

/** A contest's own page, in its league. */
export function contestPagePath(contest: Pick<SportEventContestDto, 'id' | 'leagueCode'>): string {
  return `/league/${encodeURIComponent(contest.leagueCode)}/contests/${contest.id}`;
}

/**
 * The Event page's Contests grid columns (the Event page spec): every customer contest on the
 * event, read-only, each column typed so it sorts and filters from its header.
 */
export function eventContestColumns() {
  return [
    columnHelper.accessor('name', {
      header: 'Contest',
      meta: { info: 'The contest, as its league named it. ⤢ opens its details.', type: { kind: 'text' } },
      cell: ({ getValue }) => <Text variant="strong">{getValue()}</Text>,
    }),
    columnHelper.accessor('leagueName', {
      header: 'League',
      meta: { info: 'The customer league that runs it.', type: { kind: 'enum' } },
    }),
    columnHelper.accessor((contest) => contest.contestTemplateName ?? NO_TEMPLATE, {
      id: 'contestTemplate',
      header: 'Contest template',
      meta: { info: 'The contest template it was set up from. None when set up without one.', type: { kind: 'enum' } },
    }),
    columnHelper.accessor('status', {
      header: 'Status',
      meta: {
        info: 'Set up, Open (taking entries), Live or Final.',
        type: { kind: 'enum', order: ContestStatusOrder, label: (status) => CONTEST_STATUS_LABELS[status as ContestStatus] },
      },
      cell: ({ getValue }) => <StatusBadge tone={CONTEST_STATUS_TONES[getValue()]}>{CONTEST_STATUS_LABELS[getValue()]}</StatusBadge>,
    }),
    columnHelper.accessor('entryCount', {
      header: 'Entries',
      meta: { info: 'Entries in the contest, across every team.', type: { kind: 'number' } },
    }),
    columnHelper.accessor('createdAt', {
      header: 'Created',
      meta: { info: 'When the commissioner set it up. Listed newest first.', type: { kind: 'date', direction: 'past' } },
    }),
  ];
}
