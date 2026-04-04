import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { InvitePolicy } from '@poolmaster/shared/domain';
import { UserPlus, LogOut, Clock, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { client, joinDiscoverableLeague, leaveLeague } from '@/lib/api';

type MembershipState = 'none' | 'pending' | 'member';

interface JoinLeagueButtonProps {
  leagueId: string;
  joinPolicy: InvitePolicy;
  membershipState: MembershipState;
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}

function getJoinPolicyLabel(joinPolicy: InvitePolicy): string {
  switch (joinPolicy) {
    case InvitePolicy.OPEN:
      return 'Join League';
    case InvitePolicy.LINK_INVITE:
      return 'Invite Link Required';
    case InvitePolicy.COMMISSIONER_ONLY:
      return 'Commissioner Only';
  }
}

function getJoinPolicyHelpText(joinPolicy: InvitePolicy): string {
  switch (joinPolicy) {
    case InvitePolicy.OPEN:
      return '';
    case InvitePolicy.LINK_INVITE:
      return 'This league uses invite links for membership.';
    case InvitePolicy.COMMISSIONER_ONLY:
      return 'Only the commissioner can add members to this league.';
  }
}

export function JoinLeagueButton({ leagueId, joinPolicy, membershipState }: JoinLeagueButtonProps) {
  const queryClient = useQueryClient();
  const canJoinDirectly = joinPolicy === InvitePolicy.OPEN;
  const [joinError, setJoinError] = useState<string | null>(null);

  const join = useMutation({
    mutationFn: async () => {
      if (!canJoinDirectly) {
        throw new Error('Join requests are not supported by the current backend flow.');
      }

      const { data, error } = await joinDiscoverableLeague({
        client,
        path: { leagueId },
      });

      if (error) {
        throw error;
      }

      if (!data?.membership?.leagueId) {
        throw new Error('Missing membership response from join league.');
      }

      return data.membership;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leagues'] });
      queryClient.invalidateQueries({ queryKey: ['discover'] });
      setJoinError(null);
    },
    onError: (error) => {
      setJoinError(getErrorMessage(error));
    },
  });

  if (membershipState === 'member') {
    return (
      <Button variant="outline" size="sm" disabled>
        <Check className="h-4 w-4 mr-1" /> Joined
      </Button>
    );
  }

  if (membershipState === 'pending') {
    return (
      <Button variant="outline" size="sm" disabled>
        <Clock className="h-4 w-4 mr-1" /> Request Pending
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <Button
        size="sm"
        onClick={() => {
          setJoinError(null);
          join.mutate();
        }}
        disabled={join.isPending || !canJoinDirectly}
        data-testid="league-join-button"
      >
        {join.isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="ml-2">Joining...</span>
          </>
        ) : (
          <>
            <UserPlus className="h-4 w-4 mr-1" />
            {canJoinDirectly ? 'Join League' : getJoinPolicyLabel(joinPolicy)}
          </>
        )}
      </Button>

      {!canJoinDirectly && (
        <p className="text-xs text-muted-foreground">{getJoinPolicyHelpText(joinPolicy)}</p>
      )}

      {joinError && (
        <p className="text-xs text-destructive" data-testid="league-join-error">
          {joinError}
        </p>
      )}
    </div>
  );
}

interface LeaveLeagueButtonProps {
  leagueId: string;
  leagueName: string;
  onLeft?: () => void;
}

export function LeaveLeagueButton({ leagueId, leagueName, onLeft }: LeaveLeagueButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const leave = useMutation({
    mutationFn: async () => {
      const { data, error } = await leaveLeague({
        client,
        path: { id: leagueId },
      });

      if (error) {
        throw error;
      }

      if (!data?.success) {
        throw new Error('Leave league did not return a success response.');
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leagues'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setLeaveError(null);
      onLeft?.();
    },
  });

  return (
    <>
      <Button variant="outline" size="sm" className="text-destructive" onClick={() => setConfirming(true)}>
        <LogOut className="h-4 w-4 mr-1" /> Leave League
      </Button>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-lg shadow-lg p-6 max-w-sm w-full mx-4 space-y-4">
            <h3 className="text-lg font-semibold">Leave League</h3>
            <p className="text-sm text-muted-foreground">
              Are you sure you want to leave <strong>{leagueName}</strong>? You'll lose access to all contests and history in this league.
            </p>
            {leaveError && (
              <p className="text-sm text-destructive" data-testid="league-leave-error">
                {leaveError}
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setConfirming(false);
                  setLeaveError(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={async () => {
                  setLeaveError(null);
                  try {
                    await leave.mutateAsync();
                    setConfirming(false);
                  } catch (error) {
                    setLeaveError(getErrorMessage(error));
                  }
                }}
                disabled={leave.isPending}
                data-testid="league-leave-confirm"
              >
                {leave.isPending ? 'Leaving...' : 'Leave League'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
