import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { acceptInvitation } from '@/lib/api';
import { useSessionStore } from '@/features/auth/session-store';

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
  const tokens = useSessionStore((state) => state.tokens);
  const isAuthenticated = Boolean(tokens?.accessToken);
  const [attemptedCode, setAttemptedCode] = useState<string | null>(null);

  const acceptMutation = useMutation({
    mutationFn: async () => {
      const response = await acceptInvitation({
        body: { inviteCode },
        headers: tokens?.accessToken
          ? {
              Authorization: `Bearer ${tokens.accessToken}`,
            }
          : undefined,
      });

      if (!response.data?.membership) {
        throw response.error ?? new Error('Invitation acceptance response is missing data.');
      }

      return response.data.membership;
    },
    onSuccess: (membership) => {
      navigate(`/leagues/${membership.leagueId}`);
    },
  });

  useEffect(() => {
    if (!inviteCode || !isAuthenticated || attemptedCode === inviteCode || acceptMutation.isPending) {
      return;
    }

    setAttemptedCode(inviteCode);
    acceptMutation.mutate();
  }, [acceptMutation, attemptedCode, inviteCode, isAuthenticated]);

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
        <h2 className="text-2xl font-semibold">Join league</h2>
        <p className="mt-3 text-sm text-muted-foreground">{redirectMessage}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground" to="/">
            Go to sign-in
          </Link>
          <Link className="rounded-2xl border border-border px-4 py-3 text-sm font-medium" to="/leagues">
            Back to leagues
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
      <h2 className="mt-4 text-3xl font-semibold tracking-tight">Accepting your league invite</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        PoolMaster is adding this account to the invited league using the current backend
        membership flow.
      </p>

      <div className="mt-6 rounded-[1.5rem] border border-border bg-background p-5 text-sm text-muted-foreground">
        {acceptMutation.isPending ? 'Accepting invitation...' : null}
        {acceptMutation.isError ? getErrorMessage(acceptMutation.error) : null}
        {acceptMutation.isSuccess ? 'Invitation accepted. Redirecting you to the league...' : null}
      </div>

      {acceptMutation.isError ? (
        <div className="mt-5 flex gap-3">
          <button
            className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground"
            onClick={() => acceptMutation.mutate()}
            type="button"
          >
            Try again
          </button>
          <Link className="rounded-2xl border border-border px-4 py-3 text-sm font-medium" to="/">
            Back to sign-in
          </Link>
        </div>
      ) : null}
    </section>
  );
}
