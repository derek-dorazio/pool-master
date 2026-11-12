import type { RefObject } from 'react';
import type { SelectionStateResponse } from '@/lib/api';
import type { Sport, SportNoun } from '@poolmaster/shared/domain';
import { Notice, SectionCard, Text } from '@/features/shared/ui';
import {
  EditableSelectionGroup,
  LockedSelectionGroup,
  type SelectionGroup,
} from './contest-entry-selection';
import { BudgetLineupBuilder, LockedBudgetLineup } from './contest-entry-budget';
import { DrawLineup, type DrawState } from './contest-entry-draw';
import { getNextSelectedParticipantIds } from './contest-entry-lineup';

/** One tap on a field row: `isSelected` is whether the entry held it before the tap. */
export type PickChange = { participantId: string; isSelected: boolean };

/**
 * The roster entry's lineup: the dealt field of a random draw, or each tier (or the one budget
 * group) to pick from, open for picks while the event has not started and read-only after.
 */
export function RosterContestEntryLineupSection({
  drawState,
  expandedGroupId,
  groupToggleRefs,
  isBudget,
  isBusy,
  isEditable,
  isMyEntry,
  isPreview = false,
  lineupSummary,
  noun,
  onExpandGroup,
  onPick,
  pickError,
  pickedAtById,
  picksHidden,
  progressNote,
  selectionGroups,
  sport,
}: {
  /** A random draw's room, whose dealt field replaces the picking; null for every other format. */
  drawState: DrawState | null;
  expandedGroupId: string | null;
  groupToggleRefs: RefObject<Record<string, HTMLButtonElement | null>>;
  isBudget: boolean;
  isBusy: boolean;
  isEditable: boolean;
  isMyEntry: boolean;
  /** A setup's preview (#1612): nothing is saved, so the tiers count what is picked. */
  isPreview?: boolean;
  lineupSummary: NonNullable<SelectionStateResponse['lineupSummary']> | null;
  noun: SportNoun;
  /** Opens a tier, closes every tier (null), or hands on to the next short tier (undefined). */
  onExpandGroup: (groupId: string | null | undefined) => void;
  /** Saves one tap; a refusal rejects, once the page has rolled it back. */
  onPick: (change: PickChange) => Promise<unknown>;
  /** Why the last pick was refused. */
  pickError: string | null;
  /** When each picked participant was picked, so a full tier's swap drops the newest. */
  pickedAtById: ReadonlyMap<string, string>;
  picksHidden: boolean;
  progressNote: string | null;
  selectionGroups: SelectionGroup[];
  sport: Sport | null;
}) {
  const many = noun.many;
  const title = drawState
    ? `${drawState.drawnAt ? 'Dealt ' : ''}${drawState.drawnAt ? many : many.charAt(0).toUpperCase() + many.slice(1)}`
    : isEditable ? 'Build your lineup' : 'Saved lineup detail';

  return (
    <SectionCard headingLevel={3} padded testId="contest-entry-lineup" title={title} titleTestId="contest-entry-builder-heading">
      {progressNote ? (
        <Text as="p" data-testid="contest-entry-progress" size="sm" variant="meta">{progressNote}</Text>
      ) : null}
      {drawState ? (
        <DrawLineup noun={noun} selectionState={drawState} />
      ) : (
        <div className="space-y-5">
          {picksHidden ? (
            <Notice data-testid="contest-entry-picks-hidden">
              This entry&apos;s picks stay hidden until the event starts.
            </Notice>
          ) : null}
          {isBudget ? selectionGroups.map((group) => (isEditable ? (
            <BudgetLineupBuilder
              canSelect={isMyEntry}
              sport={sport}
              group={group}
              isBusy={isBusy}
              key={group.groupId}
              noun={noun}
              onParticipantSelect={(participant) => {
                // A refused pick is shown by the page's pick error and rolled back there.
                void onPick({
                  participantId: participant.sportEventParticipantId,
                  isSelected: group.selectedParticipantIds.includes(participant.sportEventParticipantId),
                }).catch(() => undefined);
              }}
              summary={lineupSummary}
            />
          ) : (
            <LockedBudgetLineup group={group} key={group.groupId} noun={noun} summary={lineupSummary} />
          ))) : selectionGroups.map((group) => {
            if (!isEditable) {
              return <LockedSelectionGroup group={group} key={group.groupId} noun={noun} sport={sport} />;
            }

            const isExpanded = expandedGroupId === group.groupId;

            return (
              <EditableSelectionGroup
                canSelect={isMyEntry}
                sport={sport}
                group={group}
                isBusy={isBusy}
                isExpanded={isExpanded}
                isPreview={isPreview}
                key={group.groupId}
                noun={noun}
                onParticipantSelect={(nextParticipant) => {
                  const participantId = nextParticipant.sportEventParticipantId;
                  // The tier closes, and the next short one opens, as soon as the tap fills it:
                  // the lineup after the tap decides, not the server's answer.
                  const nextSelectedIds = getNextSelectedParticipantIds(
                    group,
                    participantId,
                    pickedAtById,
                  );
                  if (nextSelectedIds.length >= group.picksFromGroup) {
                    const currentIndex = selectionGroups.findIndex((candidate) => candidate.groupId === group.groupId);
                    const nextGroup = selectionGroups
                      .slice(currentIndex + 1)
                      .find((candidate) => candidate.selectedParticipantIds.length < candidate.picksFromGroup);
                    // With no short group after this one, the first short group opens instead.
                    onExpandGroup(nextGroup?.groupId);
                  }
                  void onPick({ participantId, isSelected: group.selectedParticipantIds.includes(participantId) })
                    // A refused pick is shown by the page's pick error and rolled back there; the
                    // refused tier is opened again so the fix is in view.
                    .catch(() => onExpandGroup(group.groupId));
                }}
                onToggle={() => onExpandGroup(isExpanded ? null : group.groupId)}
                setToggleRef={(element) => {
                  groupToggleRefs.current[group.groupId] = element;
                }}
              />
            );
          })}

          {pickError ? <Notice tone="danger">{pickError}</Notice> : null}
        </div>
      )}
    </SectionCard>
  );
}
