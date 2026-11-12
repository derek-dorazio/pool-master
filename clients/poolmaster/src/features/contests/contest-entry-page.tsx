import { useParams } from 'react-router';
import { SelectionType } from '@poolmaster/shared/domain';
import { LoadingState } from '@/features/shared/ui';
import { BracketEntryPage } from './bracket-entry-page';
import { PickEmEntryPage } from './pick-em-entry-page';
import { RosterContestEntryPage } from './roster-contest-entry-page';
import { SquaresEntryPage } from './squares-pages';
import { useContestQuery } from './use-contest-query';

/**
 * The contest entry page: a bracket contest's entries fill in a bracket (#721), a pick'em
 * contest's pick each week's games (#718), a squares contest's claim boxes on the grid (#711); every roster contest's build a lineup in the selection
 * room. The contest read says which, and is shared
 * with the page it opens through the contest's own key.
 */
export function ContestEntryPage() {
  const { contestId = '', entryId = '' } = useParams<{ contestId: string; entryId: string }>();
  const contestQuery = useContestQuery(contestId);
  if (contestQuery.isLoading) {
    return <LoadingState body="Loading contest entry..." />;
  }
  if (contestQuery.data?.selectionType === SelectionType.BRACKET) {
    return <BracketEntryPage contest={contestQuery.data} />;
  }
  // A survivor week is picked on the pick'em week screen (#719).
  if (contestQuery.data?.selectionType === SelectionType.PICK_EM || contestQuery.data?.selectionType === SelectionType.SURVIVOR) {
    return <PickEmEntryPage contest={contestQuery.data} />;
  }
  // A squares entry claims boxes on the grid (#711).
  if (contestQuery.data?.selectionType === SelectionType.SQUARES) {
    return <SquaresEntryPage contest={contestQuery.data} />;
  }
  // Keyed by the entry, so opening another entry starts from that entry's own name and tiebreaker.
  return <RosterContestEntryPage key={entryId} />;
}
