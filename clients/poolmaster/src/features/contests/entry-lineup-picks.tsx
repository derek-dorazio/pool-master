import { formatDollars, type SportNoun } from '@poolmaster/shared/domain';
import type { ContestEntryParticipantDetailDto } from '@/lib/api';
import { Text } from '@/features/shared/ui';
import { upperFirst } from '@/lib/upper-first';
import type { LineupPickValues } from './use-lineup-pick-values';

/** The name track takes the slack; the value track is the leaderboard's total track. */
const GRID_COLUMNS = 'minmax(6rem,1fr) minmax(48px,auto)';

function valueHeading(values: LineupPickValues | undefined) {
  switch (values?.kind) {
    case 'tier':
      return 'Tier';
    case 'price':
      return 'Price';
    case 'none':
    case undefined:
      return null;
  }
}

function pickValue(pick: ContestEntryParticipantDetailDto, values: LineupPickValues | undefined): number | undefined {
  switch (values?.kind) {
    case 'tier':
      return values.tierNumberByFieldRowId.get(pick.sportEventParticipantId);
    case 'price':
      return values.priceByFieldRowId.get(pick.sportEventParticipantId);
    case 'none':
    case undefined:
      return undefined;
  }
}

/** Tier 1 first, the dearest pick first, else by name: the order the pick screen lays them out. */
function orderPicks(picks: readonly ContestEntryParticipantDetailDto[], values: LineupPickValues | undefined) {
  return [...picks].sort((left, right) => {
    const leftValue = pickValue(left, values);
    const rightValue = pickValue(right, values);
    if (leftValue !== undefined && rightValue !== undefined && leftValue !== rightValue) {
      return values?.kind === 'price' ? rightValue - leftValue : leftValue - rightValue;
    }
    if ((leftValue === undefined) !== (rightValue === undefined)) {
      return leftValue === undefined ? 1 : -1;
    }
    return left.participantName.localeCompare(right.participantName);
  });
}

/**
 * A lineup entry's picks, opened under the viewer's own row on the contest page before it goes
 * live (#1740): one row per pick on the leaderboard's pick-row grid, with its tier in a tiered
 * contest, its price in a budget one, and nothing beside it in a random draw. No scores yet.
 */
export function EntryLineupPicks({
  entryId,
  noun,
  picks,
  values,
}: {
  entryId: string;
  noun: SportNoun;
  /** The entry's picks in the event shown. */
  picks: readonly ContestEntryParticipantDetailDto[];
  /** Undefined while the event's values load: the picks show by name meanwhile. */
  values: LineupPickValues | undefined;
}) {
  if (picks.length === 0) {
    return <Text as="p" className="px-4 py-3" tone="muted" variant="meta">No picks yet.</Text>;
  }
  const heading = valueHeading(values);
  return (
    <div className="divide-y divide-border" data-testid={`contest-entry-picks-${entryId}`}>
      <div
        className="grid gap-2 px-4 py-2"
        data-testid={`contest-entry-picks-head-${entryId}`}
        style={{ gridTemplateColumns: GRID_COLUMNS }}
      >
        <Text variant="label">{upperFirst(noun.one)}</Text>
        <Text className="text-right" variant="label">{heading}</Text>
      </div>
      {orderPicks(picks, values).map((pick) => {
        const value = pickValue(pick, values);
        return (
          <div
            className="grid items-baseline gap-2 px-4 py-2"
            data-testid={`contest-entry-pick-${entryId}-${pick.participantId}`}
            key={pick.pickId}
            style={{ gridTemplateColumns: GRID_COLUMNS }}
          >
            <Text className="min-w-0 truncate" size="sm" tone="default" variant="body">
              {pick.participantName}
            </Text>
            <Text className="text-right" data-testid={`contest-entry-pick-value-${entryId}-${pick.participantId}`} size="sm" tone="default" variant="value">
              {value === undefined ? null : values?.kind === 'price' ? formatDollars(value) : String(value)}
            </Text>
          </div>
        );
      })}
    </div>
  );
}
