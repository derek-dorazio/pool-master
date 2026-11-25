import { extractErrorMessage } from '@/lib/errors';
import { parseBracketTiebreaker } from './bracket-layout';
import type { useEntryName } from './use-entry-name';
import type { useGamePicks } from './use-game-picks';

/** The card's hint when the server refuses a submit for a reason the page doesn't name, such as its first game having started. */
export const SUBMIT_CLOSED = 'Submitting is closed.';

type GamePicksWrites = Pick<ReturnType<typeof useGamePicks>, 'saveMutation' | 'submitMutation' | 'tiebreakerDraft'>;

/**
 * The Name and submit card's one button on a games pick screen, a bracket's or a pick'em week's
 * (#1769): a tiebreaker typed but not yet saved, a changed name, then the submit, in that order.
 * Each step's error shows on the card, so a refusal stops the run without a second message.
 */
export function gameEntryFinish({
  canSubmit,
  errorMessage,
  name,
  onSubmitted,
  savedTiebreaker,
  submitFallback,
  submits,
  tiebreakerMax,
  writes: { saveMutation, submitMutation, tiebreakerDraft },
}: {
  /** The server's word that the entry can be submitted now, its tiebreaker as saved. */
  canSubmit: boolean;
  /** The page's own wording of a refusal, or null when there is none. */
  errorMessage: (error: Error | null, fallback: string) => string | null;
  name: ReturnType<typeof useEntryName>;
  /** Runs once a submit lands, such as returning to the contest's page. */
  onSubmitted: () => void;
  savedTiebreaker: number | null;
  /** The highest tiebreaker the server takes, from the picks read. */
  tiebreakerMax: number;
  /** The submit refusal's fallback, which names what is submitted: "this bracket", "this week". */
  submitFallback: string;
  /** The button submits; otherwise it only saves the name and tiebreaker of a submitted entry. */
  submits: boolean;
  writes: GamePicksWrites;
}) {
  const typedTiebreaker = tiebreakerDraft === null ? null : parseBracketTiebreaker(tiebreakerDraft, tiebreakerMax);
  const tiebreakerChanged = typedTiebreaker !== null && typedTiebreaker !== savedTiebreaker;
  // A save with no picks is the tiebreaker's, from this card.
  const isTiebreakerSave = saveMutation.variables?.picks.length === 0;
  const finish = async () => {
    saveMutation.reset();
    submitMutation.reset();
    name.rename.reset();
    try {
      if (tiebreakerChanged) {
        await saveMutation.mutateAsync({ picks: [], tiebreakerValue: typedTiebreaker });
      }
      await name.save();
      if (submits) {
        await submitMutation.mutateAsync();
        onSubmitted();
      }
    } catch {
      // Each step's own error shows on the card.
    }
  };
  return {
    /**
     * The server allows the submit: it said so, or the one thing it lacked is the tiebreaker the
     * button saves first. The page's hint names any other reason; the server stays the judge.
     */
    canSubmit: canSubmit || (savedTiebreaker === null && typedTiebreaker !== null),
    finish,
    finishError: errorMessage(submitMutation.error, submitFallback)
      ?? (isTiebreakerSave ? errorMessage(saveMutation.error, 'We could not save your tiebreaker. Please try again.') : null)
      ?? (name.rename.isError ? extractErrorMessage(name.rename.error) : null),
    isChanged: name.isChanged || tiebreakerChanged,
    isFinishing: saveMutation.isPending || name.rename.isPending || submitMutation.isPending,
    /** A save that failed was a pick's, so its error shows by the games, not on the card. */
    isTiebreakerSave,
    tiebreakerInvalid: tiebreakerDraft !== null && tiebreakerDraft.trim() !== '' && typedTiebreaker === null,
    tiebreakerText: tiebreakerDraft ?? (savedTiebreaker === null ? '' : String(savedTiebreaker)),
    typedTiebreaker,
  };
}
