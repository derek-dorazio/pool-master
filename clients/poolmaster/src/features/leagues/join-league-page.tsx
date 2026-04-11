import { useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { acceptInvitation, getInvitationPreview } from '@/lib/api';
import { useAuth } from '@/features/auth/auth-provider';
import { buildInvitePath, buildLeaguePath, getLeagueInitials, setRecentLeagueCode } from './league-routing';

function getErrorMessage(error: unknown) {
  if (!error || typeof error !== 'object') {
    return 'We could not accept this invitation. Please try again.';
  }

  const candidate = error as {
    error?: { message?: unknown };
    message?: unknown;
  };

  if (typeof candidate.error?.message === 'string') {
    return candidate.error.message;
  }

  if (typeof candidate.message === 'string') {
    return candidate.message;
  }

  return 'We could not accept this invitation. Please try again.';
}

export function JoinLeaguePage() {
  const { inviteCode = '' } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const invitationQuery = useQuery({
    queryKey: ['poolmaster', 'invitation-preview', inviteCode],
    queryFn: async () => {
      const response = await getInvitationPreview({ path: { inviteCode } });
      if (!response.data?.invitation) {
        throw response.error ?? new Error('Invitation preview is missing data.');
      }
      return response.data.invitation;
    },
    enabled: Boolean(inviteCode),
    retry: false,
  });

  const acceptMutation = useMutation({
    mutationFn: async () => {
      const response = await acceptInvitation({ body: { inviteCode } });

      if (!response.data?.membership) {
        throw response.error ?? new Error('Invitation acceptance response is missing data.');
      }

      return response.data.membership;
    },
    onSuccess: () => {
      const leagueCode = invitationQuery.data?.league.leagueCode;
      if (leagueCode) {
        setRecentLeagueCode(leagueCode);
        navigate(buildLeaguePath(leagueCode));
      }
    },
  });

  const redirectMessage = useMemo(() => {
    if (!inviteCode) {
      return 'This invitation link is missing a code.';
    }

    if (!isAuthenticated) {
      return 'Sign in or create an account first, then come back to accept this invitation.';
    }

    return null;
  }, [inviteCode, isAuthenticated]);

  if (redirectMessage) {
    return (
      <section className="mx-auto max-w-2xl rounded-[2rem] border border-border bg-card p-8">
        <h2 className="text-2xl font-semibold">
          {invitationQuery.data ? `Join ${invitationQuery.data.league.name}` : 'Join league'}
        </h2>
        <p className="mt-3 text-sm text-muted-foreground">{redirectMessage}</p>
        {invitationQuery.data ? (
          <div className="mt-5 flex items-center gap-3 rounded-[1.5rem] border border-border bg-background p-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
              {getLeagueInitials(invitationQuery.data.league.name)}
            </div>
            <div>
              <div className="font-semibold">{invitationQuery.data.league.name}</div>
              <div className="text-sm text-muted-foreground">
                You&apos;ve been invited to join this league.
              </div>
            </div>
          </div>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground"
            state={{ from: buildInvitePath(inviteCode) }}
            to="/"
          >
            Go to sign-in
          </Link>
          <Link className="rounded-2xl border border-border px-4 py-3 text-sm font-medium" to="/">
            Back to home
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-2xl rounded-[2rem] border border-border bg-card p-8">
      <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
        Invitation
      </span>
      <h2 className="mt-4 text-3xl font-semibold tracking-tight">
        {invitationQuery.data ? `Join ${invitationQuery.data.league.name}` : 'Accept your league invite'}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Review the league invitation and join when you&apos;re ready.
      </p>

      <div className="mt-6 rounded-[1.5rem] border border-border bg-background p-5 text-sm text-muted-foreground">
        {invitationQuery.isLoading ? 'Loading invitation...' : null}
        {invitationQuery.isError ? 'We could not load this invitation.' : null}
        {invitationQuery.data ? (
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
              {getLeagueInitials(invitationQuery.data.league.name)}
            </div>
            <div>
              <div className="font-semibold text-foreground">{invitationQuery.data.league.name}</div>
              <div className="text-sm text-muted-foreground">
                Invite code {invitationQuery.data.inviteCode} · status {invitationQuery.data.status}
              </div>
            </div>
          </div>
        ) : null}
        {acceptMutation.isPending ? <p>Accepting invitation...</p> : null}
        {acceptMutation.isError ? <p>{getErrorMessage(acceptMutation.error)}</p> : null}
        {acceptMutation.isSuccess ? <p>Invitation accepted. Redirecting you to the league...</p> : null}
      </div>

      {invitationQuery.data ? (
        <div className="mt-5 flex gap-3">
          <button
            className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground"
            disabled={acceptMutation.isPending}
            onClick={() => acceptMutation.mutate()}
            type="button"
          >
            {acceptMutation.isPending ? 'Joining...' : 'Join league'}
          </button>
          <Link className="rounded-2xl border border-border px-4 py-3 text-sm font-medium" to="/welcome">
            Back
          </Link>
        </div>
      ) : null}
    </section>
  );
}
