import { useEffect } from 'react';
import type { EmailSuppressionReason } from '@poolmaster/shared/domain';
import { AuthProvider } from '@poolmaster/shared/domain';
import { useAuth } from '@/features/auth/auth-context';
import { MyPaymentsSection } from '@/features/billing/payment-history-sections';
import {
  formatMonthYearDisplay,
  LoadingState,
  PendingPage,
  Notice,
  PageHeader,
  StatusBadge,
  Text,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import { useOwnEmailPreferences } from '../email-preferences';
import { MyAccountAccountSection } from './my-account-account-section';
import { EMAIL_SUPPRESSION_MESSAGES, SIGN_IN_METHOD_LABELS } from './my-account-helpers';
import { MyAccountNotificationsSection } from './my-account-notifications-section';
import { MyAccountPreferencesSection } from './my-account-preferences-section';
import { MyAccountProfileSection } from './my-account-profile-section';
import { MyAccountSignInSection } from './my-account-sign-in-section';

/** Says why no email reaches the member at all, when their address bounced or was marked as spam. */
export function EmailSuppressionNotice({ reason }: { reason: EmailSuppressionReason | null | undefined }) {
  if (!reason) {
    return null;
  }
  return (
    <Notice data-testid="email-suppression-notice" title="We can't email you" tone="warning">
      <Text as="p" className="mt-1">{EMAIL_SUPPRESSION_MESSAGES[reason]}</Text>
    </Notice>
  );
}

/**
 * My account (#1597): every setting the member has, shown as it stands, in "see it, then Edit"
 * sections. Each section owns its call, its actions and its dialog.
 */
export function MyAccountPage() {
  const { user } = useAuth();
  const displayPreferences = useDisplayPreferences();
  const emailPreferencesQuery = useOwnEmailPreferences(Boolean(user));

  useEffect(() => {
    if (user) {
      getLogger().child({ feature: 'my-account' }).info(
        { action: 'myAccount.page.loaded', data: { userId: user.id, isActive: user.isActive } },
        'Loaded My account',
      );
    }
  }, [user]);

  if (!user) {
    return <PendingPage testId="my-account-pending"><LoadingState body="Loading your account..." testId="my-account-loading" /></PendingPage>;
  }

  const isInactive = !user.isActive;
  return (
    <section className="space-y-6" data-testid="my-account-page">
      <PageHeader
        meta={(
          <>
            <span>Member since {formatMonthYearDisplay(user.createdAt, displayPreferences, 'Unknown')}</span>
            <span>Signs in with {SIGN_IN_METHOD_LABELS[user.authProvider ?? AuthProvider.EMAIL]}</span>
          </>
        )}
        status={isInactive ? <StatusBadge data-testid="my-account-inactive-status" tone="inactive">Inactive</StatusBadge> : undefined}
        testId="my-account-header"
        title="My account"
      />
      {isInactive ? (
        <Notice data-testid="my-account-inactive-notice" tone="warning">
          Your leagues can&apos;t see you until you reactivate your account.
        </Notice>
      ) : null}
      <EmailSuppressionNotice reason={emailPreferencesQuery.data?.emailSuppression} />

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <MyAccountProfileSection user={user} />
        <MyAccountPreferencesSection user={user} />
        <MyAccountNotificationsSection />
        <MyAccountSignInSection />
        <MyPaymentsSection />
        <MyAccountAccountSection user={user} />
      </div>
    </section>
  );
}
