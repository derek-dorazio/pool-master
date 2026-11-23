import { displayString, enumLabel } from '@poolmaster/shared/display-strings';
import { createColumnHelper } from '@tanstack/react-table';
import { RoundStatus, RoundStatusOrder } from '@poolmaster/shared/domain';
import { StatusBadge, Text, type StatusBadgeProps } from '@/features/shared/ui';
import type { SportEventRoundDto } from '@/lib/api';

/** A round's row: the round as read, with its name in the sport's words. */
export type EventRoundRow = SportEventRoundDto & { label: string };

const columnHelper = createColumnHelper<EventRoundRow>();

const ROUND_STATUS_TONES: Record<RoundStatus, NonNullable<StatusBadgeProps['tone']>> = {
  [RoundStatus.SCHEDULED]: 'neutral',
  [RoundStatus.IN_PROGRESS]: 'live',
  [RoundStatus.COMPLETED]: 'completed',
};

/**
 * The Event page's Rounds grid columns (the Event page spec): each round's start, where it is,
 * how many results it holds and when it was settled, every column typed and explained.
 */
export function eventRoundColumns() {
  return [
    columnHelper.accessor('label', {
      header: displayString('word.roundHeading'),
      meta: { info: 'The round, in the sport\'s words.', type: { kind: 'text' } },
      cell: ({ getValue }) => <Text variant="strong">{getValue()}</Text>,
    }),
    columnHelper.accessor('scheduledDate', {
      header: 'Starts',
      meta: { info: 'When the round starts, in your time zone.', type: { kind: 'datetime', direction: 'both' } },
    }),
    columnHelper.accessor('status', {
      header: 'Status',
      meta: {
        info: 'Scheduled: nothing in it has started. In progress: some of it is under way or finished. Completed: all of it finished.',
        type: { kind: 'enum', order: RoundStatusOrder, label: (status) => enumLabel('RoundStatus', status as RoundStatus) },
      },
      cell: ({ getValue }) => <StatusBadge tone={ROUND_STATUS_TONES[getValue()]}>{enumLabel('RoundStatus', getValue())}</StatusBadge>,
    }),
    columnHelper.accessor('resultCount', {
      header: 'Results',
      meta: { info: 'Results recorded in it: finished matches, or participants\' finished rounds.', type: { kind: 'number' } },
    }),
    columnHelper.accessor('completedAt', {
      header: 'Settled',
      meta: { info: 'When its last result came in. Blank until it completes.', type: { kind: 'datetime', direction: 'past' } },
    }),
  ];
}
