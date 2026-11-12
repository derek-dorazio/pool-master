import { ContestStatus } from '@poolmaster/shared/domain';
import { useState } from 'react';
import type { ContestDto } from '@/lib/api';
import { buildContestLandingPath } from '@/features/leagues/league-routing';
import { RowActionsMenu, showToast, type RowAction } from '@/features/shared/ui';
import { DeleteContestDialog } from './delete-contest-dialog';
import { OpenContestDialog } from './open-contest-action';

type RowDialog = 'open' | 'delete' | null;

/**
 * The "⋯" on a contest's row in Commissioner tools › Contests: a contest still in setup opens to
 * the league or is deleted from here, each after its question; one members can see opens the
 * page they see.
 */
export function ManageContestsRowActions({
  contest,
  isLeagueActive,
  leagueCode,
  leagueId,
}: {
  contest: ContestDto;
  isLeagueActive: boolean;
  leagueCode: string;
  leagueId: string;
}) {
  const [dialog, setDialog] = useState<RowDialog>(null);
  const isNotOpen = contest.status === ContestStatus.DRAFT;
  const testPrefix = `manage-contests-actions-${contest.id}`;

  const actions: RowAction[] = isNotOpen
    ? isLeagueActive
      ? [
          { label: 'Open to league', onSelect: () => setDialog('open'), testId: `${testPrefix}-open` },
          { label: 'Delete', onSelect: () => setDialog('delete'), testId: `${testPrefix}-delete`, tone: 'danger' },
        ]
      : []
    : [{ label: 'View as members see it', testId: `${testPrefix}-view`, to: buildContestLandingPath(leagueCode, contest) }];
  const setDialogOpen = (which: Exclude<RowDialog, null>) => (open: boolean) => setDialog(open ? which : null);

  return (
    <>
      <RowActionsMenu actions={actions} label={`Actions for ${contest.name}`} testId={testPrefix} />
      {isNotOpen ? (
        <>
          <OpenContestDialog
            contestId={contest.id}
            leagueId={leagueId}
            onOpened={() => showToast({ title: `${contest.name} is open to the league`, tone: 'success' })}
            onOpenChange={setDialogOpen('open')}
            open={dialog === 'open'}
          />
          <DeleteContestDialog
            contestId={contest.id}
            contestName={contest.name}
            leagueCode={leagueCode}
            leagueId={leagueId}
            onDeleted={() => showToast({ title: `${contest.name} deleted`, tone: 'success' })}
            onOpenChange={setDialogOpen('delete')}
            open={dialog === 'delete'}
          />
        </>
      ) : null}
    </>
  );
}
