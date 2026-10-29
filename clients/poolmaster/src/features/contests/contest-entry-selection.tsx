import { formatParticipantStatusLabel, type Sport, type SportNoun } from "@poolmaster/shared/domain";
import { participantAffiliation, selectionParticipantLabel, unavailableParticipantLabel } from "./contest-sport";
import type { EntryTiebreakerUi } from "./scoring-family-ui/types";
import type { SelectionStateResponse } from "@/lib/api";
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  FormField,
  ListStack,
  Select,
  StatusBadge,
  Tile,
  cn,
} from "@/features/shared/ui";

type SelectionState = SelectionStateResponse;
export type SelectionGroup = NonNullable<SelectionState["selectionGroups"]>[number];
export type SelectionParticipant = SelectionGroup["participants"][number];

function getSelectedParticipants(group: SelectionGroup) {
  const selectedIds = new Set(group.selectedParticipantIds);
  return group.participants.filter((participant) =>
    selectedIds.has(participant.sportEventParticipantId),
  );
}

function getGroupStatusLabel(group: SelectionGroup) {
  if (group.selectedParticipantIds.length >= group.picksFromGroup) {
    return "Complete";
  }

  if (group.selectedParticipantIds.length > 0) {
    return "In progress";
  }

  return "Next up";
}

function getParticipantMetaSummary(participant: SelectionParticipant, sport: Sport | null) {
  const parts: string[] = [];

  if (participant.orderIndex) {
    parts.push(`Contest rank #${participant.orderIndex}`);
  }
  if (participant.ranking !== undefined && participant.ranking !== null) {
    parts.push(`Ranking #${participant.ranking}`);
  }
  if (participant.price !== undefined && participant.price !== null) {
    parts.push(`${participant.price} salary`);
  }
  if (participant.status) {
    parts.push(`Status: ${formatParticipantStatusLabel(participant.status, sport)}`);
  }

  return parts;
}

export function SelectionParticipantCard({
  canSelect,
  group,
  isBusy,
  noun,
  onSelect,
  participant,
  sport,
}: {
  canSelect: boolean;
  group: SelectionGroup;
  isBusy: boolean;
  /** What the event's sport calls a participant: "golfer", "horse". */
  noun: SportNoun;
  onSelect: (participant: SelectionParticipant) => void;
  participant: SelectionParticipant;
  /** The contest's sport, whose words name a participant's status. */
  sport: Sport | null;
}) {
  const selectedCount = group.selectedParticipantIds.length;
  const groupIsFull = selectedCount >= group.picksFromGroup;
  const isSelected = group.selectedParticipantIds.includes(
    participant.sportEventParticipantId,
  );
  const canReplace = groupIsFull && !isSelected;
  // A held participant stays clickable even after withdrawing: picking them again unselects them,
  // which the server allows, and otherwise the entry would be stuck holding them.
  const isDisabled =
    isBusy ||
    !canSelect ||
    (!participant.isAvailable && !isSelected);

  let actionLabel = `Select ${noun.one}`;
  if (isSelected) {
    actionLabel = "Selected";
  } else if (!participant.isAvailable) {
    actionLabel = unavailableParticipantLabel(participant, sport);
  } else if (canReplace) {
    actionLabel = "Replace selection";
  } else if (groupIsFull) {
    actionLabel = "Tier filled";
  }

  return (
    <Button
      className={cn(
        "items-start gap-3 px-4 py-3",
        isSelected
          ? "border-primary bg-primary/5 hover:bg-primary/5"
          : "hover:border-foreground/30",
      )}
      data-testid={`contest-entry-participant-${participant.sportEventParticipantId}`}
      disabled={isDisabled}
      layout="row"
      onClick={() => onSelect(participant)}
      variant="secondary"
    >
      <Checkbox
        aria-label={actionLabel}
        checked={isSelected}
        className="mt-1"
        readOnly
        tabIndex={-1}
      />
      <div className="min-w-0 flex-1">
        {/* Wraps so that on a phone the badge drops under the name instead of squeezing it. */}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <div className="font-medium text-foreground">
              {selectionParticipantLabel(participant)}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {participantAffiliation(participant) ?? participant.role ?? "In the field"}
            </div>
          </div>
          <StatusBadge tone={isSelected ? "success" : "neutral"}>
            {actionLabel}
          </StatusBadge>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          {getParticipantMetaSummary(participant, sport).map((part) => (
            <span key={`${participant.sportEventParticipantId}-${part}`}>
              {part}
            </span>
          ))}
        </div>
      </div>
    </Button>
  );
}

function SelectedParticipantChips({ group }: { group: SelectionGroup }) {
  const selectedParticipants = getSelectedParticipants(group);

  if (!selectedParticipants.length) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
      {selectedParticipants.map((participant) => (
        <Chip
          data-testid={`contest-entry-selected-${participant.sportEventParticipantId}`}
          key={participant.sportEventParticipantId}
        >
          {selectionParticipantLabel(participant)}
        </Chip>
      ))}
    </div>
  );
}

export function EditableSelectionGroup({
  canSelect,
  group,
  isBusy,
  isExpanded,
  noun,
  onParticipantSelect,
  onToggle,
  setToggleRef,
  sport,
}: {
  canSelect: boolean;
  group: SelectionGroup;
  isBusy: boolean;
  isExpanded: boolean;
  noun: SportNoun;
  onParticipantSelect: (participant: SelectionParticipant) => void;
  onToggle: () => void;
  setToggleRef: (element: HTMLButtonElement | null) => void;
  sport: Sport | null;
}) {
  const isComplete = group.selectedParticipantIds.length >= group.picksFromGroup;
  const statusLabel = getGroupStatusLabel(group);

  return (
    <Tile
      className={cn(!isComplete ? "bg-muted/30" : null)}
      data-testid={`contest-entry-group-${group.groupId}`}
      padding="sm"
      radius="lg"
      variant="subtle"
    >
      <Button
        className="h-auto min-h-0 flex-wrap items-start justify-between gap-3 p-0 hover:bg-transparent"
        data-testid={`contest-entry-group-toggle-${group.groupId}`}
        layout="row"
        onClick={onToggle}
        ref={setToggleRef}
        variant="ghost"
      >
        <div>
          <h4 className="text-lg font-semibold text-foreground">
            {group.groupName}
          </h4>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose {group.picksFromGroup} {group.picksFromGroup === 1 ? noun.one : noun.many} from this tier.
          </p>
          <SelectedParticipantChips group={group} />
        </div>
        <div className="flex flex-col items-end gap-2">
          <StatusBadge tone={isComplete ? "neutral" : "warning"}>
            {statusLabel}
          </StatusBadge>
          <span className="text-sm text-muted-foreground">
            {group.selectedParticipantIds.length}/{group.picksFromGroup} saved
          </span>
          <span className="text-xs uppercase text-muted-foreground">
            {isExpanded ? "Hide tier" : isComplete ? "Review tier" : "Open tier"}
          </span>
        </div>
      </Button>

      {isExpanded ? (
        <ListStack className="mt-4">
          {group.participants.map((participant) => (
            <SelectionParticipantCard
              canSelect={canSelect}
              group={group}
              isBusy={isBusy}
              key={participant.sportEventParticipantId}
              noun={noun}
              onSelect={onParticipantSelect}
              participant={participant}
              sport={sport}
            />
          ))}
        </ListStack>
      ) : null}
    </Tile>
  );
}

export function LockedSelectionGroup({
  group,
  noun,
  sport,
}: {
  group: SelectionGroup;
  noun: SportNoun;
  sport: Sport | null;
}) {
  const selectedParticipants = getSelectedParticipants(group);

  return (
    <Tile
      data-testid={`contest-entry-group-${group.groupId}`}
      padding="sm"
      radius="lg"
      variant="subtle"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-lg font-semibold text-foreground">
            {group.groupName}
          </h4>
          <p className="mt-1 text-sm text-muted-foreground">
            Frozen lineup from Tier {group.groupNumber}.
          </p>
        </div>
        <StatusBadge tone="locked">Locked</StatusBadge>
      </div>

      <Tile className="mt-4 overflow-x-auto" padding="none" radius="lg">
        <div className="grid grid-cols-[minmax(0,1.6fr)_100px_110px_90px] gap-2 border-b border-border px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
          <span className="capitalize">{noun.one}</span>
          <span className="text-right">Contest rank</span>
          <span className="text-right">Ranking</span>
          <span className="text-right">Status</span>
        </div>
        <div className="divide-y divide-border">
          {selectedParticipants.length ? (
            selectedParticipants.map((participant) => (
              <div
                className="grid grid-cols-[minmax(0,1.6fr)_100px_110px_90px] gap-2 px-4 py-3 text-sm"
                data-testid={`contest-entry-locked-participant-${group.groupId}-${participant.sportEventParticipantId}`}
                key={participant.sportEventParticipantId}
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-foreground">
                    {selectionParticipantLabel(participant)}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {participantAffiliation(participant) ?? participant.role ?? "In the field"}
                  </div>
                </div>
                <span className="text-right text-foreground">
                  {participant.orderIndex ? `#${participant.orderIndex}` : "-"}
                </span>
                <span className="text-right text-muted-foreground">
                  {participant.ranking !== undefined && participant.ranking !== null
                    ? `#${participant.ranking}`
                    : "-"}
                </span>
                <span className="text-right text-muted-foreground">
                  {formatParticipantStatusLabel(participant.status ?? "ACTIVE", sport)}
                </span>
              </div>
            ))
          ) : (
            <Alert className="m-4">
              No {noun.one} was saved from this tier.
            </Alert>
          )}
        </div>
      </Tile>
    </Tile>
  );
}

/** The entry's tiebreaker prediction, for a scoring family that asks for one. */
export function TiebreakerField({
  disabled,
  onChange,
  tiebreaker,
  value,
}: {
  disabled: boolean;
  onChange: (value: string) => void;
  tiebreaker: EntryTiebreakerUi;
  value: string;
}) {
  return (
    <FormField label={tiebreaker.label}>
      <Select
        data-testid="contest-entry-tiebreaker-select"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option value="">{tiebreaker.placeholder}</option>
        {tiebreaker.options.map((option) => (
          <option key={option} value={option}>
            {tiebreaker.format(option)}
          </option>
        ))}
      </Select>
    </FormField>
  );
}
