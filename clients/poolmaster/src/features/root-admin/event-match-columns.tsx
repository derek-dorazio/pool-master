import { displayString } from '@poolmaster/shared/display-strings';
import { createColumnHelper } from '@tanstack/react-table';
import { type MatchStatus, MatchStatusOrder } from '@poolmaster/shared/domain';
import { StatusBadge, Text } from '@/features/shared/ui';
import type { EventMatchRow } from './event-match-rows';
import { MATCH_STATUS_LABEL, MATCH_STATUS_TONE } from './match-status';

const columnHelper = createColumnHelper<EventMatchRow>();

/**
 * The Event page's Matches grid columns (the Event page spec): each match's round, its two
 * sides, start, status, score and when it was settled, every column typed and explained.
 */
export function eventMatchColumns() {
  return [
    columnHelper.accessor('roundNumber', {
      header: displayString('word.roundHeading'),
      meta: { info: 'The round the match is played in, first round first.', type: { kind: 'number' } },
      cell: ({ row }) => row.original.roundLabel,
    }),
    columnHelper.accessor('pairing', {
      header: 'Match',
      meta: { info: 'Its two sides: "vs" on a neutral site, otherwise away @ home. TBD until a side is decided. ⤢ opens its details.', type: { kind: 'text' } },
      cell: ({ getValue }) => <Text variant="strong">{getValue()}</Text>,
    }),
    columnHelper.accessor('scheduledDate', {
      header: 'Starts',
      meta: { info: 'When the match starts, in your time zone. Blank until it is announced.', type: { kind: 'datetime', direction: 'both' } },
    }),
    columnHelper.accessor('status', {
      header: 'Status',
      meta: {
        info: 'Scheduled, Postponed, In progress, Final or Cancelled.',
        type: { kind: 'enum', order: MatchStatusOrder, label: (status) => MATCH_STATUS_LABEL[status as MatchStatus] },
      },
      cell: ({ getValue }) => <StatusBadge tone={MATCH_STATUS_TONE[getValue()]}>{MATCH_STATUS_LABEL[getValue()]}</StatusBadge>,
    }),
    columnHelper.accessor('score', {
      header: 'Score',
      meta: { info: 'Home first, then away; in a series, games won. Blank until either side scores.', type: { kind: 'text' } },
    }),
    columnHelper.accessor('completedAt', {
      header: 'Settled',
      meta: { info: 'When its result was last recorded, a correction included. Blank until it is final.', type: { kind: 'datetime', direction: 'past' } },
    }),
  ];
}
