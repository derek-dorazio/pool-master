import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuthProvider } from '@poolmaster/shared/domain';
import { mockApi } from '@/test/msw-api';
import { buildEmailPreferences, primeMyAccount, renderMyAccount } from '@/test/my-account-harness';

describe('My account page', () => {
  it('shows the shared loading line while the account is still loading', () => {
    primeMyAccount();
    mockApi.getUser.mockReturnValue(new Promise(() => undefined));

    renderMyAccount();

    expect(screen.getByTestId('my-account-loading')).toHaveTextContent('Loading your account...');
  });

  it('heads the page "My account" with when the member joined and how they sign in, in words not codes', async () => {
    primeMyAccount();

    renderMyAccount();

    const header = await screen.findByTestId('my-account-header');
    expect(within(header).getByRole('heading', { level: 1, name: 'My account' })).toBeVisible();
    expect(screen.getByTestId('my-account-header-meta')).toHaveTextContent('Member since Apr 2026');
    expect(screen.getByTestId('my-account-header-meta')).toHaveTextContent('Signs in with email');
    expect(screen.queryByText('EMAIL')).not.toBeInTheDocument();
  });

  it('names Google as the sign-in method for a member who signs in with Google', async () => {
    primeMyAccount({ authProvider: AuthProvider.GOOGLE });

    renderMyAccount();

    expect(await screen.findByTestId('my-account-header-meta')).toHaveTextContent('Signs in with Google');
  });

  it('shows every setting as it stands without opening a dialog, and never the member\'s role', async () => {
    primeMyAccount({ isRootAdmin: true });

    renderMyAccount();

    await screen.findByTestId('my-account-page');
    expect(screen.getByTestId('my-account-profile-name')).toHaveTextContent('Derek Dorazio');
    expect(screen.getByTestId('my-account-preferences-time-zone')).toHaveTextContent('Eastern (New York)');
    expect(await screen.findByTestId('my-account-notifications-RESULTS')).toBeVisible();
    expect(screen.getByTestId('my-account-password')).toBeVisible();
    expect(screen.getByTestId('my-account-lifecycle')).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Role')).not.toBeInTheDocument();
    expect(screen.queryByText('Root admin')).not.toBeInTheDocument();
  });

  it('marks an inactive account Inactive in the header and says the leagues cannot see it until it is reactivated', async () => {
    primeMyAccount({ isActive: false });

    renderMyAccount();

    expect(await screen.findByTestId('my-account-inactive-status')).toHaveTextContent('Inactive');
    const notice = screen.getByTestId('my-account-inactive-notice');
    expect(notice).toHaveTextContent(/reactivate/i);
    expect(notice).not.toHaveTextContent(/cannot sign in/i);
  });

  it('shows no Inactive mark or notice on an active account', async () => {
    primeMyAccount();

    renderMyAccount();

    await screen.findByTestId('my-account-page');
    expect(screen.queryByTestId('my-account-inactive-status')).not.toBeInTheDocument();
    expect(screen.queryByTestId('my-account-inactive-notice')).not.toBeInTheDocument();
  });

  it.each([
    ['BOUNCE' as const, /bounced/],
    ['COMPLAINT' as const, /marked as spam/],
  ])('warns the member that no email reaches them when their address is suppressed for %s', async (reason, text) => {
    primeMyAccount();
    mockApi.getUserEmailPreferences.mockResolvedValue({ data: buildEmailPreferences({ emailSuppression: reason }) });

    renderMyAccount();

    const notice = await screen.findByTestId('email-suppression-notice');
    expect(notice).toHaveTextContent("We can't email you");
    expect(notice).toHaveTextContent(text);
  });

  it('shows no email warning when the address can be emailed', async () => {
    primeMyAccount();

    renderMyAccount();

    await screen.findByTestId('my-account-notifications-RESULTS');
    expect(screen.queryByTestId('email-suppression-notice')).not.toBeInTheDocument();
  });

  it('lists the payments the member made in their leagues, each naming its league and linking to it', async () => {
    primeMyAccount();
    mockApi.listUserPayments.mockResolvedValue({
      data: {
        payments: [{
          id: '0f6e3c1a-2222-4b4b-9c9c-000000000001',
          paidAt: '2026-10-24T15:00:00.000Z',
          amountCents: 0,
          description: 'Masters Pool: up to 50 entries',
          league: { id: 'league-1', name: 'Big Dawgs', leagueCode: 'BIGDAWGS' },
        }],
      },
    });

    renderMyAccount();

    const line = await screen.findByTestId('my-payment-0f6e3c1a-2222-4b4b-9c9c-000000000001');
    expect(line).toHaveTextContent('Big Dawgs');
    expect(line).toHaveTextContent('$0');
    expect(within(line).getByRole('link', { name: 'Masters Pool: up to 50 entries' })).toHaveAttribute('href', '/league/BIGDAWGS');
  });

  it('says the member has no payments yet when they have made none', async () => {
    primeMyAccount();

    renderMyAccount();

    expect(await screen.findByTestId('my-payments-empty')).toHaveTextContent('No payments yet.');
  });
});

describe('A user page address', () => {
  it('sends a member who opens their own /users page to My account', async () => {
    primeMyAccount();

    renderMyAccount('/users/user-1');

    expect(await screen.findByTestId('my-account-page')).toBeVisible();
  });

  it('sends a member who opens another member\'s page to their own My account', async () => {
    primeMyAccount();

    renderMyAccount('/users/user-2');

    expect(await screen.findByTestId('my-account-page')).toBeVisible();
    expect(screen.getByTestId('my-account-profile-name')).toHaveTextContent('Derek Dorazio');
  });

  it('sends a root admin who opens another user\'s page to that user in Manage', async () => {
    primeMyAccount({ id: 'admin-1', isRootAdmin: true });

    renderMyAccount('/users/user-2');

    expect(await screen.findByTestId('manage-user-route')).toBeInTheDocument();
  });

  it('sends a root admin who opens their own /users page to My account, not Manage', async () => {
    primeMyAccount({ id: 'admin-1', isRootAdmin: true });

    renderMyAccount('/users/admin-1');

    await waitFor(() => expect(screen.getByTestId('my-account-page')).toBeVisible());
  });
});
