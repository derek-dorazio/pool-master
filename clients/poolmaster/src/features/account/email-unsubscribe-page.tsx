import { useState } from 'react';
import { useLocation } from 'react-router';
import { unsubscribeFromEmail } from '@/lib/api';
import { extractErrorMessage, hasErrorCode, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { Button, LinkButton, Notice, StatusPage } from '@/features/shared/ui';
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
      <StatusPage
        action={<LinkButton to="/my-account" variant="secondary">Email notifications</LinkButton>}
        body="Sign in to choose your emails in Email notifications."
        kind="notFound"
        testId="email-unsubscribe-invalid"
        title="This link doesn't work"
      />
    );
  }

  if (unsubscribeMutation.isSuccess) {
    const { label } = EMAIL_CATEGORY_LABELS[unsubscribeMutation.data.category];
    return (
      <StatusPage
        action={<LinkButton to="/my-account" variant="secondary">Email notifications</LinkButton>}
        body={`No more ${label.toLowerCase()} emails from any of your leagues.`}
        kind="done"
        testId="email-unsubscribe-done"
        title="You're unsubscribed"
      />
    );
  }

  return (
    <StatusPage
      action={(
        <Button
          data-testid="email-unsubscribe-confirm"
          disabled={unsubscribeMutation.isPending}
          onClick={() => unsubscribeMutation.mutate(token)}
          type="button"
        >
          Stop these emails
        </Button>
      )}
      body="This kind of email stops from all your leagues. Invitations and account emails still come."
      kind="confirm"
      testId="email-unsubscribe-confirm-page"
      title="Stop these emails?"
    >
      {unsubscribeMutation.isError ? (
        <Notice tone="danger">{extractErrorMessage(unsubscribeMutation.error, { fallback: 'We could not unsubscribe you. Try again.' })}</Notice>
      ) : null}
    </StatusPage>
  );
}
