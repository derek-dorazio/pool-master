import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { acceptInvitation } from '@/lib/api';
import { useAuth } from '@/features/auth/auth-provider';
import { InvitationContextCard } from './invitation-context-card';
import { buildInvitePath, buildLeaguePath, setRecentLeagueCode } from './league-routing';
import {
  fetchInvitationPreview,
  getInvitationPreviewQueryKey,
} from './invitation-preview';

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
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const invitationQuery = useQuery({
    queryKey: getInvitationPreviewQueryKey(inviteCode),
    queryFn: () => fetchInvitationPreview(inviteCode),
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
        void queryClient.invalidateQueries({ queryKey: ['poolmaster', 'leagues'] });
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
          <div className="mt-5">
            <InvitationContextCard
              inviteCode={invitationQuery.data.inviteCode}
              leagueName={invitationQuery.data.league.name}
              message="You've been invited to join this league. Sign in with your existing account, or create a new account and then come back here to accept the invite."
              title="League invite"
            />
          </div>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground"
            data-testid="invite-sign-in"
            state={{ from: buildInvitePath(inviteCode) }}
            to="/"
          >
            Sign in to continue
          </Link>
          <Link
            className="rounded-2xl border border-border px-4 py-3 text-sm font-medium"
            data-testid="invite-create-account"
            state={{ authMode: 'register', from: buildInvitePath(inviteCode) }}
            to="/"
          >
            Create account
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
          <InvitationContextCard
            inviteCode={invitationQuery.data.inviteCode}
            leagueName={invitationQuery.data.league.name}
            message={`You are signed in. Review this invite and choose Join League when you're ready. Current status: ${invitationQuery.data.status}.`}
            title="Ready to join"
          />
        ) : null}
        {acceptMutation.isPending ? <p>Accepting invitation...</p> : null}
        {acceptMutation.isError ? <p>{getErrorMessage(acceptMutation.error)}</p> : null}
        {acceptMutation.isSuccess ? <p>Invitation accepted. Redirecting you to the league...</p> : null}
      </div>

      {invitationQuery.data ? (
        <div className="mt-5 flex gap-3">
          <button
            className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground"
            data-testid="invite-accept"
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
