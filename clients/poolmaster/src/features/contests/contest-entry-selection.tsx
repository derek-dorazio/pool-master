import { formatParticipantStatusLabel, type Sport, type SportNoun } from "@poolmaster/shared/domain";
import { participantAffiliation, selectionParticipantLabel, unavailableParticipantLabel } from "./contest-sport";
import { ParticipantLine } from "./participant-line";
import type { EntryTiebreakerUi } from "./scoring-family-ui/types";
import type { SelectionStateResponse } from "@/lib/api";
import {
  Notice,
  Button,
  Checkbox,
  Chip,
  cn,
  FormField,
  Heading,
  ExpandableRow,
  Select,
  SimpleTable,
  StatusBadge,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Text,
  Tile,
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
      className={cn("overflow-hidden", !isComplete ? "bg-muted/30" : null)}
      data-testid={`contest-entry-group-${group.groupId}`}
      padding="none"
      radius="lg"
      variant="subtle"
    >
      <ExpandableRow
        isOpen={isExpanded}
        label={`${group.groupName}: ${isExpanded ? "hide tier" : isComplete ? "review tier" : "open tier"}`}
        look="card"
        onToggle={onToggle}
        summary={(
          <div className="flex flex-wrap items-start justify-between gap-3" data-testid={`contest-entry-group-summary-${group.groupId}`}>
            <div>
              <Heading level={4} variant="subtitle">
                {group.groupName}
              </Heading>
              <Text as="p" className="mt-1" variant="meta">
                Choose {group.picksFromGroup} {group.picksFromGroup === 1 ? noun.one : noun.many} from this tier.
              </Text>
              <SelectedParticipantChips group={group} />
            </div>
            <div className="flex flex-col items-end gap-2">
              <StatusBadge tone={isComplete ? "neutral" : "warning"}>
                {statusLabel}
              </StatusBadge>
              <Text variant="meta">
                {group.selectedParticipantIds.length}/{group.picksFromGroup} saved
              </Text>
              <Text variant="label">
                {isExpanded ? "Hide tier" : isComplete ? "Review tier" : "Open tier"}
              </Text>
            </div>
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
    </Tile>
  );
}

/** The locked tier's columns, each width written once. */
const LOCKED_TIER_COLUMNS = [
  { id: "participant", label: "", align: "left", width: "" },
  { id: "contest-rank", label: "Contest rank", align: "right", width: "w-[120px]" },
  { id: "ranking", label: "Ranking", align: "right", width: "w-[110px]" },
  { id: "status", label: "Status", align: "right", width: "w-[90px]" },
] as const;

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
          <Heading level={4} variant="subtitle">
            {group.groupName}
          </Heading>
          <Text as="p" className="mt-1" variant="meta">
            Frozen lineup from Tier {group.groupNumber}.
          </Text>
        </div>
        <StatusBadge tone="locked">Locked</StatusBadge>
      </div>

      <Tile className="mt-4 overflow-x-auto" padding="none" radius="lg">
        <SimpleTable className="min-w-[32rem] table-fixed">
            <colgroup>
              {LOCKED_TIER_COLUMNS.map((column) => <col className={column.width} key={column.id} />)}
            </colgroup>
            <TableHead tone="plain">
              <tr className="border-b border-border">
                {LOCKED_TIER_COLUMNS.map((column) => (
                  <TableHeaderCell align={column.align} className="py-3" key={column.id}>
                    <Text className={cn("whitespace-nowrap", column.id === "participant" ? "capitalize" : undefined)} variant="label">
                      {column.id === "participant" ? noun.one : column.label}
                    </Text>
                  </TableHeaderCell>
                ))}
              </tr>
            </TableHead>
            <TableBody>
              {selectedParticipants.map((participant, index) => (
                <TableRow
                  className={index === 0 ? "border-t-0" : undefined}
                  data-testid={`contest-entry-locked-participant-${group.groupId}-${participant.sportEventParticipantId}`}
                  key={participant.sportEventParticipantId}
                >
                  <TableCell className="py-3">
                    <ParticipantLine
                      affiliation={participantAffiliation(participant) ?? participant.role ?? "In the field"}
                      density="compact"
                      name={selectionParticipantLabel(participant)}
                      truncate
                    />
                  </TableCell>
                  <TableCell align="right" className="py-3">
                    <Text tone="default">{participant.orderIndex ? `#${participant.orderIndex}` : "-"}</Text>
                  </TableCell>
                  <TableCell align="right" className="py-3">
                    <Text variant="meta">
                      {participant.ranking !== undefined && participant.ranking !== null
                        ? `#${participant.ranking}`
                        : "-"}
                    </Text>
                  </TableCell>
                  <TableCell align="right" className="py-3">
                    <Text variant="meta">{formatParticipantStatusLabel(participant.status ?? "ACTIVE", sport)}</Text>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
        </SimpleTable>
        {selectedParticipants.length ? null : (
          <Notice className="m-4">
            No {noun.one} was saved from this tier.
          </Notice>
        )}
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
