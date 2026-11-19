import { ParticipantInactiveReason } from '@poolmaster/shared/domain';
import { createColumnHelper } from '@tanstack/react-table';
import { StatusBadge, Text } from '@/features/shared/ui';
import {
  FIELD_VALUE_SET_BY_LABELS,
  FieldValueSetByOrder,
  type EventFieldColumnsShown,
  type EventFieldRow,
  type FieldValueSetBy,
} from './event-field-rows';

const columnHelper = createColumnHelper<EventFieldRow>();

/** Why a participant left the field, in domain words; a row with no reason recorded is just out. */
export const FIELD_OUT_LABELS: Record<ParticipantInactiveReason, string> = {
  [ParticipantInactiveReason.WITHDRAWN]: 'Withdrawn',
  [ParticipantInactiveReason.ELIMINATED]: 'Eliminated',
};

export function fieldOutLabel(entry: EventFieldRow['entry']): string {
  return entry.inactiveReason === null ? 'Out' : FIELD_OUT_LABELS[entry.inactiveReason];
}

/**
 * The Event page's Field grid columns (the Event page spec): each participant with the values it
 * is ordered by, its tier and price, who set them and when its feed last listed it. A column the
 * field has no values for is left off. Read-only: ⤢ opens the participant to correct it.
 */
export function eventFieldColumns(shown: EventFieldColumnsShown) {
  return [
    columnHelper.accessor('name', {
      header: 'Participant',
      meta: { info: 'The participant. Guest marks one from outside the sport league; a participant out of the field says why. ⤢ opens its details.', type: { kind: 'text' } },
      cell: ({ row }) => (
        <span className="flex flex-wrap items-center gap-2">
          <Text variant="strong">{row.original.name}</Text>
          {row.original.entry.affiliatedWithSportLeague ? null : <StatusBadge tone="warning">Guest</StatusBadge>}
          {row.original.entry.isActive ? null : <StatusBadge tone="neutral">{fieldOutLabel(row.original.entry)}</StatusBadge>}
        </span>
      ),
    }),
    ...(shown.team ? [columnHelper.accessor('teamAffiliation', {
      header: 'Team',
      meta: { info: 'The team the participant plays or races for.', type: { kind: 'text' } },
    })] : []),
    ...(shown.country ? [columnHelper.accessor('nationality', {
      header: 'Country',
      meta: { info: 'The country the participant represents.', type: { kind: 'text' } },
    })] : []),
    ...(shown.seed ? [columnHelper.accessor('seedNumber', {
      header: 'Seed',
      meta: { info: 'Its seed in the event, 1 first.', type: { kind: 'number' } },
    })] : []),
    columnHelper.accessor('ranking', {
      header: 'Rank',
      meta: { info: 'Its rank coming into the event, 1 best.', type: { kind: 'number' } },
    }),
    columnHelper.accessor('oddsToWin', {
      header: 'Odds',
      meta: { info: 'Its odds to win the event.', type: { kind: 'number' } },
    }),
    columnHelper.accessor('tierNumber', {
      header: 'Tier',
      meta: { info: 'The pick tier it is in. Blank while untiered.', type: { kind: 'number' } },
      cell: ({ row }) => row.original.tierLabel ?? '',
    }),
    columnHelper.accessor('price', {
      header: 'Price',
      meta: { info: 'What it costs in a budget contest. Blank while unpriced.', type: { kind: 'number' } },
    }),
    columnHelper.accessor('setBy', {
      header: 'Set by',
      meta: {
        info: 'Auto: tiering and pricing set its tier and price. Manual: a root admin corrected one, which stops that kind following automatic tiering or pricing for this event.',
        type: { kind: 'enum', order: FieldValueSetByOrder, label: (value) => FIELD_VALUE_SET_BY_LABELS[value as FieldValueSetBy] },
      },
      cell: ({ getValue }) => {
        const setBy = getValue();
        return setBy === null ? '' : FIELD_VALUE_SET_BY_LABELS[setBy];
      },
    }),
    ...(shown.lastInFeed ? [columnHelper.accessor('lastInFeedAt', {
      header: 'Last in feed',
      meta: { info: 'When a sync last saw it in its provider\'s feed. Blank if none has.', type: { kind: 'datetime', direction: 'past' } },
    })] : []),
  ];
}
