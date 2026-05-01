import type { GetDraftStateResponses } from "@/lib/api";
import {
  Button,
  Chip,
  FormField,
  ListStack,
  Select,
  StatusBadge,
  Tile,
  cn,
} from "@/features/shared/ui";

type DraftState = GetDraftStateResponses[200];
export type SelectionGroup = NonNullable<DraftState["selectionGroups"]>[number];
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

function getParticipantMetaSummary(participant: SelectionParticipant) {
  const parts: string[] = [];

  if (participant.orderIndex) {
    parts.push(`Contest rank #${participant.orderIndex}`);
  }
  if (participant.ranking !== undefined && participant.ranking !== null) {
    parts.push(`World rank #${participant.ranking}`);
  }
  if (participant.price !== undefined && participant.price !== null) {
    parts.push(`${participant.price} salary`);
  }
  if (participant.status) {
    parts.push(`Status: ${participant.status}`);
  }

  return parts;
}

export function SelectionParticipantCard({
  canSelect,
  group,
  isBusy,
  onSelect,
  participant,
}: {
  canSelect: boolean;
  group: SelectionGroup;
  isBusy: boolean;
  onSelect: (participant: SelectionParticipant) => void;
  participant: SelectionParticipant;
}) {
  const selectedCount = group.selectedParticipantIds.length;
  const groupIsFull = selectedCount >= group.picksFromGroup;
  const isSelected = group.selectedParticipantIds.includes(
    participant.sportEventParticipantId,
  );
  const canReplace = groupIsFull && !isSelected;
  const isDisabled =
    isBusy ||
    !canSelect ||
    !participant.isAvailable ||
    (groupIsFull && !canReplace && !isSelected);

  let actionLabel = "Select golfer";
  if (isSelected) {
    actionLabel = "Selected";
  } else if (!participant.isAvailable) {
    actionLabel = participant.unavailableReason ?? "Unavailable";
  } else if (canReplace) {
    actionLabel = "Replace selection";
  } else if (groupIsFull) {
    actionLabel = "Tier filled";
  }

  return (
    <button
      className={cn(
        "flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-70",
        isSelected
          ? "border-primary bg-primary/5"
          : "border-border bg-card hover:border-foreground/30",
      )}
      data-testid={`contest-entry-participant-${participant.sportEventParticipantId}`}
      disabled={isDisabled}
      onClick={() => onSelect(participant)}
      type="button"
    >
      <input
        aria-label={actionLabel}
        checked={isSelected}
        className="mt-1 h-4 w-4 accent-primary"
        readOnly
        tabIndex={-1}
        type="checkbox"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="font-medium text-foreground">
              {participant.participantName}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {participant.team ?? participant.position ?? "Golf field participant"}
            </div>
          </div>
          <StatusBadge tone={isSelected ? "success" : "neutral"}>
            {actionLabel}
          </StatusBadge>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          {getParticipantMetaSummary(participant).map((part) => (
            <span key={`${participant.sportEventParticipantId}-${part}`}>
              {part}
            </span>
          ))}
        </div>
      </div>
    </button>
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
        <Chip key={participant.sportEventParticipantId}>
          {participant.participantName}
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
  onParticipantSelect,
  onToggle,
  setToggleRef,
}: {
  canSelect: boolean;
  group: SelectionGroup;
  isBusy: boolean;
  isExpanded: boolean;
  onParticipantSelect: (participant: SelectionParticipant) => void;
  onToggle: () => void;
  setToggleRef: (element: HTMLButtonElement | null) => void;
}) {
  const isComplete = group.selectedParticipantIds.length >= group.picksFromGroup;
  const statusLabel = getGroupStatusLabel(group);

  return (
    <Tile
      className={cn(
        !isComplete ? "border-amber-300 bg-amber-50/40" : null,
      )}
      data-testid={`contest-entry-group-${group.groupId}`}
      padding="sm"
      radius="lg"
      variant="subtle"
    >
      <button
        className="flex w-full flex-wrap items-start justify-between gap-3 text-left"
        data-testid={`contest-entry-group-toggle-${group.groupId}`}
        onClick={onToggle}
        ref={setToggleRef}
        type="button"
      >
        <div>
          <h4 className="text-lg font-semibold text-foreground">
            {group.groupName}
          </h4>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose {group.picksFromGroup} golfer
            {group.picksFromGroup === 1 ? "" : "s"} from this tier.
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
          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            {isExpanded ? "Hide tier" : isComplete ? "Review tier" : "Open tier"}
          </span>
        </div>
      </button>

      {isExpanded ? (
        <ListStack className="mt-4">
          {group.participants.map((participant) => (
            <SelectionParticipantCard
              canSelect={canSelect}
              group={group}
              isBusy={isBusy}
              key={participant.sportEventParticipantId}
              onSelect={onParticipantSelect}
              participant={participant}
            />
          ))}
        </ListStack>
      ) : null}
    </Tile>
  );
}

export function LockedSelectionGroup({
  group,
}: {
  group: SelectionGroup;
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

      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="grid grid-cols-[minmax(0,1.6fr)_100px_110px_90px] gap-2 border-b border-border px-4 py-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          <span>Golfer</span>
          <span className="text-right">Contest rank</span>
          <span className="text-right">World rank</span>
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
                    {participant.participantName}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {participant.team ??
                      participant.position ??
                      "Golf field participant"}
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
                  {participant.status ?? "ACTIVE"}
                </span>
              </div>
            ))
          ) : (
            <div className="px-4 py-4 text-sm text-muted-foreground">
              No golfer was saved from this tier.
            </div>
          )}
        </div>
      </div>
    </Tile>
  );
}

export function TiebreakerSelector({
  disabled,
  isSubmitting,
  onChange,
  onSubmit,
  options,
  submitDisabled,
  value,
}: {
  disabled: boolean;
  isSubmitting: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  options: number[];
  submitDisabled: boolean;
  value: string;
}) {
  return (
    <Tile padding="sm" radius="lg" variant="subtle">
      <FormField label="Winning Score Relative to Par">
        <Select
          data-testid="contest-entry-tiebreaker-select"
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          value={value}
        >
          <option value="">Select score</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option === 0 ? "E" : option > 0 ? `+${option}` : `${option}`}
            </option>
          ))}
        </Select>
      </FormField>
      <Button
        className="mt-4"
        data-testid="contest-entry-submit"
        disabled={submitDisabled}
        onClick={onSubmit}
      >
        {isSubmitting ? "Submitting..." : "Submit entry"}
      </Button>
    </Tile>
  );
}
