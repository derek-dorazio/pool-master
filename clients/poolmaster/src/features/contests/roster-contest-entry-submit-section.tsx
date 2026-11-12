import { Notice } from '@/features/shared/ui';
import { TiebreakerField } from './contest-entry-selection';
import { EntryNameField } from './entry-name-field';
import { EntrySubmitBar } from './entry-submit-bar';
import type { EntryTiebreakerUi } from './scoring-family-ui/types';

/**
 * The roster entry's last section: its name, its tiebreaker and the one Submit for all of it,
 * while each can still change; the saved tiebreaker once it cannot.
 */
export function RosterContestEntrySubmitSection({
  canSubmit,
  detailsEditable,
  entryName,
  isEditable,
  isSaving,
  isSubmitted,
  isSubmitting,
  lineupComplete,
  onEntryNameChange,
  onSubmit,
  onTiebreakerChange,
  progress,
  saveError,
  savedTiebreakerValue,
  submitBlockedReason,
  submitError,
  tiebreaker,
  tiebreakerValue,
}: {
  canSubmit: boolean;
  /** The name and tiebreaker can change until the contest's first event starts. */
  detailsEditable: boolean;
  entryName: string;
  /** The shown event still takes picks. */
  isEditable: boolean;
  isSaving: boolean;
  isSubmitted: boolean;
  isSubmitting: boolean;
  lineupComplete: boolean;
  onEntryNameChange: (name: string) => void;
  onSubmit: () => void;
  onTiebreakerChange: (value: string) => void;
  progress: string | null;
  saveError: string | null;
  savedTiebreakerValue: number | null | undefined;
  submitBlockedReason: string | null;
  submitError: string | null;
  tiebreaker: EntryTiebreakerUi | null;
  /** The tiebreaker option chosen, or '' for none. */
  tiebreakerValue: string;
}) {
  const showSubmit = isEditable && lineupComplete;
  return (
    <EntrySubmitBar
      error={submitError}
      errorTestId="contest-entry-submit-error"
      progress={progress}
      progressTestId="contest-entry-submit-progress"
      submit={showSubmit ? {
        disabled: !canSubmit,
        isSubmitting: isSaving || isSubmitting,
        label: isSubmitted ? 'Save entry' : 'Submit entry',
        onSubmit,
        testId: 'contest-entry-submit',
      } : null}
      testId="contest-entry-finish"
      title={detailsEditable ? 'Name and submit' : isEditable ? 'Submit' : 'Your entry'}
    >
      {detailsEditable ? (
        <EntryNameField
          disabled={isSaving}
          onChange={onEntryNameChange}
          testId="contest-entry-header-name-input"
          value={entryName}
        />
      ) : null}

      {tiebreaker && showSubmit ? (
        <TiebreakerField
          disabled={!detailsEditable || isSaving || isSubmitting}
          onChange={onTiebreakerChange}
          tiebreaker={tiebreaker}
          value={tiebreakerValue}
        />
      ) : null}

      {tiebreaker && !detailsEditable ? (
        <Notice title="Saved tiebreaker">
          <div data-testid="contest-entry-readonly-tiebreaker">
            {savedTiebreakerValue === null || savedTiebreakerValue === undefined
              ? 'No tiebreaker prediction was saved.'
              : tiebreaker.describe(savedTiebreakerValue)}
          </div>
        </Notice>
      ) : null}

      {saveError ? <Notice tone="danger">{saveError}</Notice> : null}

      {isEditable && !isSubmitted ? (
        <Notice data-testid="contest-entry-not-submitted" title="Not submitted" tone="warning">
          {lineupComplete
            ? tiebreaker
              ? 'Your lineup is complete. Choose a tiebreaker and submit it: an entry only counts once it is submitted.'
              : 'Your lineup is complete. Submit it: an entry only counts once it is submitted.'
            : 'This entry only counts once its lineup is complete and submitted. A change that leaves a submitted lineup short needs submitting again.'}
        </Notice>
      ) : null}

      {showSubmit && submitBlockedReason ? (
        <Notice data-testid="contest-entry-submit-blocked" tone="danger">
          {submitBlockedReason}
        </Notice>
      ) : null}
    </EntrySubmitBar>
  );
}
