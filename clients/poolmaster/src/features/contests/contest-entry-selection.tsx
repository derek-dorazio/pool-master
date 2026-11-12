import { formatParticipantStatusLabel, type Sport, type SportNoun } from "@poolmaster/shared/domain";
import { participantAffiliation, selectionParticipantLabel, unavailableParticipantLabel } from "./contest-sport";
import { ParticipantLine } from "./participant-line";
import type { EntryTiebreakerUi } from "./scoring-family-ui/types";
import type { SelectionStateResponse } from "@/lib/api";
import {
  Button,
  Checkbox,
  Chip,
  cn,
  FormField,
  ExpandableRow,
  SectionCard,
  SectionEmpty,
  SectionRow,
  SectionRows,
  Select,
  StatusBadge,
  Text,
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
            <ParticipantLine
              affiliation={participantAffiliation(participant) ?? participant.role ?? "In the field"}
              name={selectionParticipantLabel(participant)}
            />
          </div>
          <StatusBadge tone={isSelected ? "success" : "neutral"}>
            {actionLabel}
          </StatusBadge>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {getParticipantMetaSummary(participant, sport).map((part) => (
            <Text key={`${participant.sportEventParticipantId}-${part}`} variant="caption">
              {part}
            </Text>
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
    <div className="mt-2 flex flex-wrap gap-2">
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
  isPreview = false,
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
  /** A setup's preview, whose trial picks are never saved: the count says "picked". */
  isPreview?: boolean;
  noun: SportNoun;
  onParticipantSelect: (participant: SelectionParticipant) => void;
  onToggle: () => void;
  setToggleRef: (element: HTMLButtonElement | null) => void;
  sport: Sport | null;
}) {
  const isComplete = group.selectedParticipantIds.length >= group.picksFromGroup;
  const statusLabel = getGroupStatusLabel(group);

  return (
    <SectionCard
      headingLevel={4}
      testId={`contest-entry-group-${group.groupId}`}
      title={group.groupName}
      trailing={(
        <>
          <Text data-testid={`contest-entry-group-count-${group.groupId}`} variant="meta">
            {group.selectedParticipantIds.length}/{group.picksFromGroup} {isPreview ? "picked" : "saved"}
          </Text>
          <StatusBadge tone={isComplete ? "neutral" : "warning"}>{statusLabel}</StatusBadge>
        </>
      )}
    >
      <ExpandableRow
        isOpen={isExpanded}
        label={`${group.groupName}: ${isExpanded ? "hide tier" : isComplete ? "review tier" : "open tier"}`}
        look="card"
        onToggle={onToggle}
        summary={(
          <div className="space-y-2" data-testid={`contest-entry-group-summary-${group.groupId}`}>
            <Text as="p" variant="meta">
              Choose {group.picksFromGroup} {group.picksFromGroup === 1 ? noun.one : noun.many} from this tier.
            </Text>
            <SelectedParticipantChips group={group} />
          </div>
        )}
        toggleRef={setToggleRef}
        toggleTestId={`contest-entry-group-toggle-${group.groupId}`}
      >
        <div className="space-y-3 p-4">
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
        </div>
      </ExpandableRow>
    </SectionCard>
  );
}

/**
 * A locked pick's fact line: who they play for, then their contest rank and ranking. Each rank
 * keeps its words together (non-breaking spaces), so a phone wraps between facts, not inside one.
 */
function getLockedParticipantFacts(participant: SelectionParticipant) {
  return [
    participantAffiliation(participant) ?? participant.role ?? "In the field",
    participant.orderIndex ? `Contest\u00a0rank\u00a0#${participant.orderIndex}` : null,
    participant.ranking !== undefined && participant.ranking !== null ? `Ranking\u00a0#${participant.ranking}` : null,
  ].filter((part) => part !== null).join(" · ");
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
    <SectionCard
      headingLevel={4}
      testId={`contest-entry-group-${group.groupId}`}
      title={group.groupName}
      trailing={<StatusBadge tone="locked">Locked</StatusBadge>}
    >
      {selectedParticipants.length ? (
        <SectionRows>
          {selectedParticipants.map((participant) => {
            const testId = `contest-entry-locked-participant-${group.groupId}-${participant.sportEventParticipantId}`;
            return (
              <SectionRow
                aside={(
                  <StatusBadge data-testid={`${testId}-status`} tone="neutral">
                    {formatParticipantStatusLabel(participant.status ?? "ACTIVE", sport)}
                  </StatusBadge>
                )}
                facts={getLockedParticipantFacts(participant)}
                key={participant.sportEventParticipantId}
                name={selectionParticipantLabel(participant)}
                testId={testId}
              />
            );
          })}
        </SectionRows>
      ) : (
        <SectionEmpty>{`No ${noun.one} was saved from this tier.`}</SectionEmpty>
      )}
    </SectionCard>
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
