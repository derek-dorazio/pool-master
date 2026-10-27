import { useState } from 'react';
import { useLocation } from 'react-router';
import { unsubscribeFromEmail } from '@/lib/api';
import { extractErrorMessage, hasErrorCode, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { Alert, Button, LinkButton, Tile } from '@/features/shared/ui';
import { EMAIL_CATEGORY_LABELS } from './email-preferences';
import { SELF_USER_ID } from './user-routing';

function readToken(search: string): string | null {
  const token = new URLSearchParams(search).get('token');
  return token?.trim() ? token : null;
}

/**
 * Where an email's "Stop these emails" link lands (#844 slice 5). It works signed out, since the
 * token is its whole authority, and asks before it turns anything off: a link scanner that opens
 * the page unsubscribes nobody.
 */
export function EmailUnsubscribePage() {
  const logger = getLogger().child({ feature: 'email-unsubscribe-page' });
  const location = useLocation();
  const [token] = useState(() => readToken(location.search));
  const unsubscribeMutation = useInvalidatingMutation({
    mutationFn: async (unsubscribeToken: string) => {
      const response = await unsubscribeFromEmail({ query: { token: unsubscribeToken } });
      if (!response.data) {
        throwApiError(response.error, 'Unsubscribe response is missing data.');
      }
      return response.data;
    },
    onError: (error) => {
      logger.warn({ action: 'email.unsubscribe.failed', err: error }, 'Unsubscribe failed');
    },
    invalidates: [QueryKeys.emailPreferences.detail(SELF_USER_ID)],
  });

  if (!token || hasErrorCode(unsubscribeMutation.error, 'EMAIL_UNSUBSCRIBE_LINK_INVALID')) {
    return (
      <Tile className="mx-auto max-w-md space-y-4" data-testid="email-unsubscribe-invalid" padding="lg" radius="xl">
        <h2 className="title-card text-lg text-foreground">This link doesn&apos;t work</h2>
        <p className="text-sm text-muted-foreground">
          Sign in and open Email notifications on your profile to choose which emails you get.
        </p>
        <LinkButton to="/my-account" variant="secondary">Email notifications</LinkButton>
      </Tile>
    );
  }

  if (unsubscribeMutation.isSuccess) {
    const { label } = EMAIL_CATEGORY_LABELS[unsubscribeMutation.data.category];
    return (
      <Tile className="mx-auto max-w-md space-y-4" data-testid="email-unsubscribe-done" padding="lg" radius="xl">
        <h2 className="title-card text-lg text-foreground">You&apos;re unsubscribed</h2>
        <p className="text-sm text-muted-foreground">
          You won&apos;t get {label.toLowerCase()} emails from any of your leagues. You can turn them
          back on, or change other emails, in Email notifications on your profile.
        </p>
        <LinkButton to="/my-account" variant="secondary">Email notifications</LinkButton>
      </Tile>
    );
  }

  return (
    <Tile className="mx-auto max-w-md space-y-4" padding="lg" radius="xl">
      <h2 className="title-card text-lg text-foreground">Stop these emails?</h2>
      <p className="text-sm text-muted-foreground">
        This turns off this kind of email from all your leagues. Invitations and account emails are
        always sent.
      </p>
      {unsubscribeMutation.isError ? (
        <Alert tone="danger">{extractErrorMessage(unsubscribeMutation.error, { fallback: 'We could not unsubscribe you. Try again.' })}</Alert>
      ) : null}
      <Button
        data-testid="email-unsubscribe-confirm"
        disabled={unsubscribeMutation.isPending}
        onClick={() => unsubscribeMutation.mutate(token)}
        type="button"
      >
        Stop these emails
      </Button>
    </Tile>
  );
}
