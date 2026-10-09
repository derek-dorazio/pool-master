import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { leaveLeague, type LeagueDto } from '@/lib/api';
import {
  Alert,
  Button,
  DangerZone,
  DangerZoneAction,
  Modal,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { type LeagueListCache, removeLeague } from './league-cache';
import { buildLeaguePath } from './league-routing';

const LEAVE_LEAGUE_ERROR_CODE_MESSAGES: Record<string, string> = {
  LEAGUE_LAST_COMMISSIONER_REQUIRED:
    'Appoint another commissioner before the last commissioner leaves or steps down.',
};

/** Leave league: a member's one danger action, with a confirm step and a done step. */
export function LeaveLeagueSection({ league }: { league: LeagueDto }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [hasLeft, setHasLeft] = useState(false);
  const isInactive = !league.isActive;

  const leaveMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await leaveLeague({ path: { id: league.id } });
      if (!response.data) {
        throwApiError(response.error, 'Leave league response is missing data.');
      }
      return response.data;
    },
    onSuccess: () => {
      setHasLeft(true);
      queryClient.setQueryData<LeagueListCache>(QueryKeys.leagues.list, (current) =>
        removeLeague(current, league.id),
      );
    },
    invalidates: [],
  });

  function handleAcknowledgeLeft() {
    const remainingLeagues = queryClient.getQueryData<LeagueListCache>(QueryKeys.leagues.list)?.leagues ?? [];
    const nextLeague = remainingLeagues.find((candidate) => candidate.isActive);

    setIsDialogOpen(false);
    setHasLeft(false);
    // With no active league left the viewer is still signed in: welcome either lands them on a
    // league they can select or shows the zero-league page.
    navigate(nextLeague ? buildLeaguePath(nextLeague.leagueCode) : '/welcome', { replace: true });
  }

  return (
    <>
      <DangerZone description="Leaving asks you to confirm." testId="leave-league-section">
        <DangerZoneAction
          action={(
            <Button
              data-testid="league-leave-open"
              disabled={isInactive}
              onClick={() => {
                leaveMutation.reset();
                setHasLeft(false);
                setIsDialogOpen(true);
              }}
              size="sm"
              variant="danger"
            >
              Leave league
            </Button>
          )}
          description={isInactive
            ? 'You cannot leave while the league is inactive.'
            : "You'll lose access to this league and your team's contest history."}
          title="Leave league"
        />
      </DangerZone>

      <Modal
        description="Leaving removes your membership from the active roster. If you are the last commissioner, appoint another commissioner before leaving."
        descriptionId="league-leave-modal-description"
        onOpenChange={(open) => {
          if (!open && !leaveMutation.isPending && !hasLeft) {
            setIsDialogOpen(false);
          }
        }}
        open={isDialogOpen}
        testId="league-leave-modal"
        title="Leave league"
      >
        {hasLeft ? (
          <>
            <Alert className="mt-5" tone="success">
              You left {league.name}.
            </Alert>
            <div className="mt-6 flex justify-end">
              <Button data-testid="league-leave-ok" onClick={handleAcknowledgeLeft}>
                OK
              </Button>
            </div>
          </>
        ) : (
          <>
            {leaveMutation.isError ? (
              <Alert className="mt-4" data-testid="league-leave-error" tone="danger">
                {extractErrorMessage(leaveMutation.error, {
                  fallback: 'We could not complete that leave request right now.',
                  codeMessages: LEAVE_LEAGUE_ERROR_CODE_MESSAGES,
                })}
              </Alert>
            ) : null}
            <div className="mt-6 flex justify-end gap-3">
              <Button
                disabled={leaveMutation.isPending}
                onClick={() => setIsDialogOpen(false)}
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                data-testid="league-leave"
                disabled={leaveMutation.isPending}
                onClick={() => leaveMutation.mutate()}
                variant="danger"
              >
                {leaveMutation.isPending ? 'Leaving...' : 'Leave league'}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
