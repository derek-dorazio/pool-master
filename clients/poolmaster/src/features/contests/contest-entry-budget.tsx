import { useState } from 'react';
import type { SelectionStateResponse } from '@/lib/api';
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  cn,
  FormField,
  formatDollars,
  Input,
  ListStack,
  ProgressIndicator,
  StatusBadge,
  Tile,
} from '@/features/shared/ui';
import type { SelectionGroup, SelectionParticipant } from './contest-entry-selection';

type BudgetLineupSummary = NonNullable<SelectionStateResponse['lineupSummary']>;

function pluralizePlaces(count: number) {
  return `${count} ${count === 1 ? 'place' : 'places'}`;
}

/**
 * The spend against the cap, kept in view while the list scrolls: spent of cap, what is left,
 * and what that leaves per open place. Over the cap it turns red and says what to do; when the
 * cheapest golfers left cannot fill the open places it warns, without blocking anything.
 */
export function BudgetSpendBar({ summary }: { summary: BudgetLineupSummary }) {
  const { cheapestFill, isOverBudget, openSlots, remaining, salaryCap, spent } = summary;
  const perOpenPlace = openSlots > 0 && remaining > 0 ? remaining / openSlots : null;
  const cannotFill = openSlots > 0 && !isOverBudget && (cheapestFill === null || cheapestFill > remaining);

  return (
    <Tile
      className={cn('sticky top-0 z-10 space-y-3', isOverBudget ? 'border-destructive' : null)}
      data-testid="contest-entry-spend-bar"
      padding="sm"
      radius="lg"
    >
      <ProgressIndicator
        label={`Spent ${formatDollars(spent)} of ${formatDollars(salaryCap)}`}
        max={salaryCap}
        tone={isOverBudget ? 'danger' : 'default'}
        value={spent}
      />
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span
          className={isOverBudget ? 'font-semibold text-destructive' : 'font-semibold text-foreground'}
          data-testid="contest-entry-budget-remaining"
        >
          {isOverBudget ? `${formatDollars(-remaining)} over the cap` : `${formatDollars(remaining)} left`}
        </span>
        <span className="text-muted-foreground">
          {openSlots === 0 ? 'Every place filled' : `${pluralizePlaces(openSlots)} to fill`}
        </span>
        {perOpenPlace !== null ? (
          <span className="text-muted-foreground" data-testid="contest-entry-budget-per-place">
            {`About ${formatDollars(Math.floor(perOpenPlace))} per place`}
          </span>
        ) : null}
      </div>
      {isOverBudget ? (
        <p className="text-sm text-destructive" data-testid="contest-entry-over-budget">
          Your golfers cost more than the salary cap. Tap a picked golfer to remove them.
        </p>
      ) : cannotFill ? (
        <p className="text-sm text-muted-foreground" data-testid="contest-entry-budget-unfillable">
          {cheapestFill === null
            ? `There aren't enough golfers left to fill your ${pluralizePlaces(openSlots)}.`
            : `The cheapest golfers left for your ${pluralizePlaces(openSlots)} cost ${formatDollars(cheapestFill)}, more than you have left.`}
        </p>
      ) : null}
    </Tile>
  );
}

function BudgetParticipantRow({
  canSelect,
  isBusy,
  isRosterFull,
  onSelect,
  participant,
}: {
  canSelect: boolean;
  isBusy: boolean;
  isRosterFull: boolean;
  onSelect: (participant: SelectionParticipant) => void;
  participant: SelectionParticipant;
}) {
  const isSelected = Boolean(participant.isSelected);
  const hasPrice = participant.price !== undefined && participant.price !== null;
  // A held golfer stays tappable even after withdrawing: tapping again removes them.
  const isDisabled = isBusy
    || !canSelect
    || (!isSelected && (!participant.isAvailable || !hasPrice || isRosterFull));

  let actionLabel = 'Add golfer';
  if (isSelected) {
    actionLabel = 'Picked';
  } else if (!participant.isAvailable) {
    actionLabel = participant.unavailableReason ?? 'Unavailable';
  } else if (!hasPrice) {
    actionLabel = 'No price';
  } else if (isRosterFull) {
    actionLabel = 'Roster full';
  }

  return (
    <Button
      className={cn(
        'h-auto w-full items-center justify-start gap-3 px-4 py-3 text-left whitespace-normal',
        isSelected ? 'border-primary bg-primary/5 hover:bg-primary/5' : 'hover:border-foreground/30',
      )}
      data-testid={`contest-entry-participant-${participant.sportEventParticipantId}`}
      disabled={isDisabled}
      onClick={() => onSelect(participant)}
      variant="secondary"
    >
      <Checkbox aria-label={actionLabel} checked={isSelected} readOnly tabIndex={-1} />
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-foreground">{participant.participantName}</span>
        <span className="block text-xs text-muted-foreground">{actionLabel}</span>
      </span>
      <span className="font-semibold tabular-nums text-foreground">
        {hasPrice ? formatDollars(participant.price ?? 0) : '—'}
      </span>
    </Button>
  );
}

/**
 * A budget entry's lineup: the spend bar, the picked golfers (tap one to remove them), and the
 * field as one price list, dearest first, that a name search narrows.
 */
export function BudgetLineupBuilder({
  canSelect,
  group,
  isBusy,
  onParticipantSelect,
  summary,
}: {
  canSelect: boolean;
  group: SelectionGroup;
  isBusy: boolean;
  onParticipantSelect: (participant: SelectionParticipant) => void;
  summary: BudgetLineupSummary | null;
}) {
  const [search, setSearch] = useState('');
  const picked = group.participants.filter((participant) => participant.isSelected);
  const isRosterFull = picked.length >= group.picksFromGroup;
  const query = search.trim().toLowerCase();
  const listed = query
    ? group.participants.filter((participant) => participant.participantName.toLowerCase().includes(query))
    : group.participants;

  return (
    <div className="space-y-4" data-testid="contest-entry-budget-builder">
      {summary ? <BudgetSpendBar summary={summary} /> : null}
      <div>
        <h4 className="text-lg font-semibold text-foreground">
          {`Your golfers (${picked.length}/${group.picksFromGroup})`}
        </h4>
        {picked.length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {picked.map((participant) => (
              <Button
                aria-label={`Remove ${participant.participantName}`}
                data-testid={`contest-entry-selected-${participant.sportEventParticipantId}`}
                disabled={isBusy || !canSelect}
                key={participant.sportEventParticipantId}
                onClick={() => onParticipantSelect(participant)}
                size="sm"
                variant="secondary"
              >
                {`${participant.participantName} · ${formatDollars(participant.price ?? 0)} ×`}
              </Button>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            {`Pick ${group.picksFromGroup} golfers whose prices fit under the cap.`}
          </p>
        )}
      </div>
      <FormField label="Find a golfer">
        <Input
          data-testid="contest-entry-budget-search"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name"
          type="search"
          value={search}
        />
      </FormField>
      <ListStack>
        {listed.map((participant) => (
          <BudgetParticipantRow
            canSelect={canSelect}
            isBusy={isBusy}
            isRosterFull={isRosterFull}
            key={participant.sportEventParticipantId}
            onSelect={onParticipantSelect}
            participant={participant}
          />
        ))}
        {!listed.length ? <Alert>{`No golfer matches “${search.trim()}”.`}</Alert> : null}
      </ListStack>
    </div>
  );
}

/** A budget entry once entries close: its golfers with their prices, and the spend. */
export function LockedBudgetLineup({
  group,
  summary,
}: {
  group: SelectionGroup;
  summary: BudgetLineupSummary | null;
}) {
  const picked = group.participants.filter((participant) => participant.isSelected);

  return (
    <Tile data-testid="contest-entry-budget-locked" padding="sm" radius="lg" variant="subtle">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h4 className="text-lg font-semibold text-foreground">Your golfers</h4>
        <StatusBadge tone="locked">Locked</StatusBadge>
      </div>
      {picked.length ? (
        <div className="mt-3 divide-y divide-border">
          {picked.map((participant) => (
            <div
              className="flex items-center justify-between gap-3 py-2 text-sm"
              data-testid={`contest-entry-locked-participant-${participant.sportEventParticipantId}`}
              key={participant.sportEventParticipantId}
            >
              <span className="font-medium text-foreground">{participant.participantName}</span>
              <Chip>{formatDollars(participant.price ?? 0)}</Chip>
            </div>
          ))}
        </div>
      ) : (
        <Alert className="mt-3">No golfer was saved on this entry.</Alert>
      )}
      {summary ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {`Spent ${formatDollars(summary.spent)} of the ${formatDollars(summary.salaryCap)} salary cap.`}
        </p>
      ) : null}
    </Tile>
  );
}
