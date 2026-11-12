import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { leaveLeague, type LeagueDto } from '@/lib/api';
import {
  Button,
  ConfirmDialog,
  SectionCard,
  SectionRow,
  SectionRows,
  showToast,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError, type ErrorCodeMessages } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { type LeagueListCache, removeLeague } from './league-cache';
import { buildLeaguePath } from './league-routing';

const LEAVE_LEAGUE_ERROR_CODE_MESSAGES: ErrorCodeMessages = {
  LEAGUE_LAST_COMMISSIONER_REQUIRED:
    'Appoint another commissioner before the last commissioner leaves or steps down.',
};

/**
 * Leave league: a member's one danger action. Confirming leaves, moves the member to their next
 * active league (or welcome) and says so in a toast.
 */
export function LeaveLeagueSection({ league }: { league: LeagueDto }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
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
      const remainingLeagues = queryClient.setQueryData<LeagueListCache>(QueryKeys.leagues.list, (current) =>
        removeLeague(current, league.id),
      )?.leagues ?? [];
      const nextLeague = remainingLeagues.find((candidate) => candidate.isActive);

      setIsDialogOpen(false);
      showToast({ title: `You left ${league.name}`, tone: 'success' });
      // With no active league left the viewer is still signed in: welcome either lands them on a
      // league they can select or shows the zero-league page.
      void navigate(nextLeague ? buildLeaguePath(nextLeague.leagueCode) : '/welcome', { replace: true });
    },
    invalidates: [],
  });

  return (
    <>
      <SectionCard testId="leave-league-section" tone="danger">
        <SectionRows>
          <SectionRow
            aside={(
              <Button
                data-testid="league-leave-open"
                disabled={isInactive}
                onClick={() => {
                  leaveMutation.reset();
                  setIsDialogOpen(true);
                }}
                size="sm"
                variant="danger"
              >
                Leave league
              </Button>
            )}
            facts={isInactive
              ? 'You cannot leave while the league is inactive.'
              : "You'll lose access to this league and your contest history in it."}
            name="Leave league"
          />
        </SectionRows>
      </SectionCard>

      <ConfirmDialog
        confirmLabel="Leave league"
        confirmTestId="league-leave"
        description={`You'll lose access to ${league.name} and your contest history in it.`}
        error={leaveMutation.isError
          ? extractErrorMessage(leaveMutation.error, {
            fallback: 'We could not complete that leave request right now.',
            codeMessages: LEAVE_LEAGUE_ERROR_CODE_MESSAGES,
          })
          : null}
        isPending={leaveMutation.isPending}
        onCancel={() => setIsDialogOpen(false)}
        onConfirm={() => leaveMutation.mutate()}
        onOpenChange={(open) => {
          if (!open) {
            setIsDialogOpen(false);
          }
        }}
        open={isDialogOpen}
        pendingLabel="Leaving..."
        testId="league-leave-modal"
        title={`Leave ${league.name}?`}
        tone="danger"
      />
    </>
  );
}
