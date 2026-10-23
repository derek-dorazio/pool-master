import { CupContestCount } from '@poolmaster/shared/domain';
import { useState } from 'react';
import { crownCup, type CupDto } from '@/lib/api';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { Alert, Button, ConfirmDialog } from '@/features/shared/ui';
import { cupLeaders, joinNames } from './cup-view';

/**
 * "Ready to crown" for the commissioner: a cup whose counted contests are all final, with the
 * Crown button. Crowning freezes the standings and hands out the trophies, so it asks first.
 */
export function CrownCupBanner({ cup, leagueId }: { cup: CupDto; leagueId: string }) {
  const [isConfirming, setIsConfirming] = useState(false);
  const crownMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await crownCup({ path: { id: leagueId, cupId: cup.id } });
      if (!response.data?.cup) {
        throwApiError(response.error, 'Crown response is missing data.');
      }
      return response.data.cup;
    },
    onSuccess: () => setIsConfirming(false),
    invalidates: [QueryKeys.cups.all],
  });
  // A cup ready to crown has every contest it counts final.
  const final = cup.contests.filter((contest) => contest.count !== CupContestCount.NOT_COUNTED).length;
  const leaders = cupLeaders(cup);
  const winners = joinNames(leaders.map((row) => row.squadName));
  const close = () => {
    if (!crownMutation.isPending) {
      crownMutation.reset();
      setIsConfirming(false);
    }
  };

  return (
    <>
      <Alert
        action={(
          <Button data-testid={`crown-cup-${cup.id}`} onClick={() => setIsConfirming(true)} size="sm" type="button">
            Crown
          </Button>
        )}
        data-testid={`ready-to-crown-${cup.id}`}
        title={`${cup.name} is ready to crown`}
      >
        {final === 1 ? `Its ${cup.sportLeagueName} contest is final.` : `All ${final} ${cup.sportLeagueName} contests are final.`}
      </Alert>
      <ConfirmDialog
        confirmLabel="Crown"
        description={`${winners} ${leaders.length === 1 ? 'takes' : 'share'} the cup. Crowning fixes the standings and hands out the trophies for 1st, 2nd and 3rd. It can't be undone, and a contest that goes final later won't count.`}
        isPending={crownMutation.isPending}
        onCancel={close}
        onConfirm={() => crownMutation.mutate()}
        onOpenChange={(open) => (open ? setIsConfirming(true) : close())}
        open={isConfirming}
        pendingLabel="Crowning..."
        testId={`crown-cup-dialog-${cup.id}`}
        title={`Crown the ${cup.name}?`}
      >
        {crownMutation.isError ? (
          <Alert tone="danger">{extractErrorMessage(crownMutation.error, { fallback: 'We could not crown the cup.' })}</Alert>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
