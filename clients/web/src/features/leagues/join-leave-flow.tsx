/**
 * Join/Leave league flow with approval-based request handling.
 * Covers: open join, approval request, pending state, leave with confirmation.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { InvitePolicy } from '@poolmaster/shared/domain';
import { UserPlus, LogOut, Clock, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { client } from '@/lib/api';
import { API_ROUTES } from '@poolmaster/shared/api-routes';

type MembershipState = 'none' | 'pending' | 'member';

interface JoinLeagueButtonProps {
  leagueId: string;
  joinPolicy: string;
  membershipState: MembershipState;
}

export function JoinLeagueButton({ leagueId, joinPolicy, membershipState }: JoinLeagueButtonProps) {
  const queryClient = useQueryClient();
  const canJoinDirectly = joinPolicy === InvitePolicy.OPEN;

  const join = useMutation({
    mutationFn: async () => {
      if (!canJoinDirectly) {
        throw new Error('Join requests are not supported by the current backend flow.');
      }

      const result = await client.post({
        url: API_ROUTES.search.joinDiscoverableLeague(leagueId),
      });
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leagues'] });
      queryClient.invalidateQueries({ queryKey: ['discover'] });
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
    <Button size="sm" onClick={() => join.mutate()} disabled={join.isPending || !canJoinDirectly}>
      {join.isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <>
          <UserPlus className="h-4 w-4 mr-1" />
          {canJoinDirectly ? 'Join League' : 'Request Unsupported'}
        </>
      )}
    </Button>
  );
}

interface LeaveLeagueButtonProps {
  leagueId: string;
  leagueName: string;
  onLeft?: () => void;
}

export function LeaveLeagueButton({ leagueId, leagueName, onLeft }: LeaveLeagueButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const queryClient = useQueryClient();

  const leave = useMutation({
    mutationFn: async () => {
      const result = await client.delete({
        url: API_ROUTES.leagues.leave(leagueId),
      });
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leagues'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
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
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setConfirming(false)}>Cancel</Button>
              <Button variant="destructive" onClick={() => { leave.mutate(); setConfirming(false); }} disabled={leave.isPending}>
                {leave.isPending ? 'Leaving...' : 'Leave League'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
