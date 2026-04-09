import { useEffect, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Loader2, LogIn, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { acceptInvitation, client } from '@/lib/api';
import { LeagueMembershipResponseSchema } from '@poolmaster/shared/dto';
import { useAuthStore } from '@/stores/auth-store';

function useAcceptInvitation(inviteCode: string) {
  const navigate = useNavigate();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await acceptInvitation({
        client,
        body: { inviteCode },
      });
      if (error) throw error;
      return LeagueMembershipResponseSchema.parse(data);
    },
    onSuccess: ({ membership }) => {
      navigate(`/leagues/${membership.leagueId}`);
    },
  });
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return 'We could not accept this invite. Please try again.';
}

export function Component() {
  const { inviteCode = '' } = useParams<{ inviteCode: string }>();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const acceptInvitation = useAcceptInvitation(inviteCode);
  const attemptedInviteCodeRef = useRef<string | null>(null);
  const redirectTo = `/join/${encodeURIComponent(inviteCode)}`;

  useEffect(() => {
    if (!inviteCode || !isAuthenticated || attemptedInviteCodeRef.current === inviteCode || acceptInvitation.isPending || acceptInvitation.isSuccess) {
      return;
    }

    attemptedInviteCodeRef.current = inviteCode;
    acceptInvitation.mutate();
  }, [acceptInvitation, inviteCode, isAuthenticated]);

  if (!inviteCode) {
    return (
      <div className="mx-auto flex max-w-lg justify-center px-4 py-16">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Invite link unavailable</CardTitle>
            <CardDescription>This invitation link is missing a code.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="mx-auto flex max-w-lg justify-center px-4 py-16">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Join League</CardTitle>
            <CardDescription>Sign in or create an account to accept this invitation.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button asChild>
              <Link to={`/login?redirectTo=${encodeURIComponent(redirectTo)}`}>
                <LogIn className="mr-2 h-4 w-4" />
                Log In To Join
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to={`/register?redirectTo=${encodeURIComponent(redirectTo)}`}>
                <UserPlus className="mr-2 h-4 w-4" />
                Create Account
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-lg justify-center px-4 py-16">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Accepting Invitation</CardTitle>
          <CardDescription>We’re adding you to the league now.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {acceptInvitation.isPending && (
            <div className="flex items-center gap-3 text-sm text-muted-foreground" data-testid="join-invitation-loading">
              <Loader2 className="h-4 w-4 animate-spin" />
              Accepting invitation...
            </div>
          )}
          {acceptInvitation.isSuccess && (
            <div className="flex items-center gap-3 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4" />
              Invitation accepted.
            </div>
          )}
          {acceptInvitation.isError && (
            <div className="space-y-3">
              <p className="text-sm text-destructive" data-testid="join-invitation-error">
                {getErrorMessage(acceptInvitation.error)}
              </p>
              <Button variant="outline" onClick={() => acceptInvitation.mutate()} data-testid="join-invitation-retry">
                Try Again
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
