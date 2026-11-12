import { useAuth } from '@/features/auth/auth-context';
import { LinkButton, StatusPage } from '@/features/shared/ui';
import type { UnusableInvitation } from './unusable-invitation';

/**
 * The page a dead invitation link opens, for league and co-owner invites alike: why it can't be
 * used, and the way on from here, to the viewer's leagues or to sign in.
 */
export function InvitationStatusPage({ invitation }: { invitation: UnusableInvitation }) {
  const { isAuthenticated } = useAuth();
  return (
    <StatusPage
      action={isAuthenticated ? (
        <LinkButton data-testid="invitation-status-action" to="/welcome">Go to my leagues</LinkButton>
      ) : (
        <LinkButton data-testid="invitation-status-action" to="/">Sign in</LinkButton>
      )}
      body={invitation.body}
      kind={invitation.kind}
      testId="invitation-status-page"
      title={invitation.title}
    />
  );
}
