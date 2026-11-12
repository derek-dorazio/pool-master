import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ColorScheme } from '@poolmaster/shared/domain';
import { AUTH_ME_QUERY_KEY, type AuthSessionUser } from '@/features/auth/auth-session-cache';
import { DEFAULT_DISPLAY_PREFERENCES } from '@/features/shared/ui';
import { setDeviceDark } from '@/test/device-color-scheme';
import { mockApi } from '@/test/msw-api';
import { buildCurrentUser, primeMyAccount, primeMyAccountThenRefetches, renderMyAccount } from '@/test/my-account-harness';

async function openPreferencesDialog() {
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Preferences' }));
  return screen.findByTestId('my-account-preferences-dialog');
}

function lastPreferencesBody() {
  const calls = mockApi.updateUserPreferences.mock.calls as [{ body: Record<string, unknown> }][];
  return calls.at(-1)?.[0].body;
}

describe('My account › Preferences', () => {
  it('shows the time zone, number and date style, clock and theme in words', async () => {
    primeMyAccount({ locale: 'en-GB', colorScheme: ColorScheme.LIGHT });

    renderMyAccount();

    expect(await screen.findByTestId('my-account-preferences-time-zone')).toHaveTextContent('Eastern (New York)');
    expect(screen.getByTestId('my-account-preferences-locale')).toHaveTextContent('British English');
    expect(screen.getByTestId('my-account-preferences-clock')).toHaveTextContent('12-hour');
    expect(screen.getByTestId('my-account-preferences-theme')).toHaveTextContent('Light');
  });

  it('shows Match my device for each choice the member left to their device, and Eastern when no zone is saved', async () => {
    primeMyAccount({ timezone: undefined, locale: undefined, timeFormat: undefined, colorScheme: undefined });

    renderMyAccount();

    expect(await screen.findByTestId('my-account-preferences-time-zone')).toHaveTextContent('Eastern (New York)');
    expect(screen.getByTestId('my-account-preferences-locale')).toHaveTextContent('Match my device');
    expect(screen.getByTestId('my-account-preferences-clock')).toHaveTextContent('Match my device');
    expect(screen.getByTestId('my-account-preferences-theme')).toHaveTextContent('Match my device');
  });

  it('opens the dialog on the default time zone and empty choices when the member has none saved', async () => {
    primeMyAccount({ timezone: undefined, locale: undefined, timeFormat: undefined });

    renderMyAccount();

    await openPreferencesDialog();
    expect(screen.getByTestId('my-account-time-zone')).toHaveValue(DEFAULT_DISPLAY_PREFERENCES.timeZone);
    expect(screen.getByTestId('my-account-locale')).toHaveValue('');
    expect(screen.getByTestId('my-account-clock')).toHaveValue('');
    expect(screen.getByTestId('my-account-theme')).toHaveValue(ColorScheme.DEVICE);
  });

  it('saves the time zone and clock picked, then closes, toasts and shows them on the page', async () => {
    const updated = buildCurrentUser({ timezone: 'America/Chicago', timeFormat: '24H' });
    primeMyAccountThenRefetches(updated);
    mockApi.updateUserPreferences.mockResolvedValue({ data: { user: updated } });

    const { queryClient } = renderMyAccount();

    await openPreferencesDialog();
    fireEvent.change(screen.getByTestId('my-account-time-zone'), { target: { value: 'America/Chicago' } });
    fireEvent.change(screen.getByTestId('my-account-clock'), { target: { value: '24H' } });
    fireEvent.click(screen.getByTestId('my-account-preferences-save'));

    await waitFor(() =>
      expect(mockApi.updateUserPreferences).toHaveBeenCalledWith(expect.objectContaining({
        path: { userId: 'me' },
        body: { timezone: 'America/Chicago', locale: 'en-US', timeFormat: '24H' },
      })),
    );
    expect(await screen.findByText('Preferences saved')).toBeVisible();
    expect(screen.queryByTestId('my-account-preferences-dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('my-account-preferences-time-zone')).toHaveTextContent('Central (Chicago)'));
    expect(screen.getByTestId('my-account-preferences-clock')).toHaveTextContent('24-hour');
    expect(queryClient.getQueryData<AuthSessionUser>(AUTH_ME_QUERY_KEY)).toMatchObject({ timezone: 'America/Chicago' });
  });

  it('leaves an unchosen theme unsaved when the member saves other preferences', async () => {
    primeMyAccount();
    mockApi.updateUserPreferences.mockResolvedValue({ data: { user: buildCurrentUser() } });

    renderMyAccount();

    await openPreferencesDialog();
    fireEvent.click(screen.getByTestId('my-account-preferences-save'));

    await waitFor(() => expect(mockApi.updateUserPreferences).toHaveBeenCalled());
    expect(lastPreferencesBody()).not.toHaveProperty('colorScheme');
  });

  it('saves Dark over Light and switches the page to dark at once, without a reload', async () => {
    const updated = buildCurrentUser({ colorScheme: ColorScheme.DARK });
    primeMyAccountThenRefetches(updated, { colorScheme: ColorScheme.LIGHT });
    mockApi.updateUserPreferences.mockResolvedValue({ data: { user: updated } });

    renderMyAccount();

    await screen.findByTestId('my-account-page');
    await waitFor(() => expect(document.documentElement.dataset['colorScheme']).toBe('light'));
    await openPreferencesDialog();
    fireEvent.change(screen.getByTestId('my-account-theme'), { target: { value: ColorScheme.DARK } });
    fireEvent.click(screen.getByTestId('my-account-preferences-save'));

    await waitFor(() => expect(lastPreferencesBody()).toMatchObject({ colorScheme: ColorScheme.DARK }));
    await waitFor(() => expect(document.documentElement.dataset['colorScheme']).toBe('dark'));
  });

  it('opens on the theme the member saved, and puts it on the page when the account loads', async () => {
    setDeviceDark(true);
    primeMyAccount({ colorScheme: ColorScheme.LIGHT });

    renderMyAccount();

    await screen.findByTestId('my-account-page');
    await waitFor(() => expect(document.documentElement.dataset['colorScheme']).toBe('light'));
    await openPreferencesDialog();
    expect(screen.getByTestId('my-account-theme')).toHaveValue(ColorScheme.LIGHT);
  });

  it('sends no locale or clock when the member clears the locale and leaves the clock to the device', async () => {
    primeMyAccount();
    mockApi.updateUserPreferences.mockResolvedValue({ data: { user: buildCurrentUser({ locale: undefined, timeFormat: undefined }) } });

    renderMyAccount();

    await openPreferencesDialog();
    fireEvent.change(screen.getByTestId('my-account-locale'), { target: { value: '   ' } });
    fireEvent.change(screen.getByTestId('my-account-clock'), { target: { value: '' } });
    expect(screen.getByTestId('my-account-locale')).toHaveValue('');
    fireEvent.click(screen.getByTestId('my-account-preferences-save'));

    await waitFor(() =>
      expect(lastPreferencesBody()).toEqual({ timezone: 'America/New_York', locale: undefined, timeFormat: undefined }),
    );
  });

  it('keeps the dialog open with the server reason when saving fails, and clears it once the member edits', async () => {
    primeMyAccount();
    mockApi.updateUserPreferences.mockResolvedValue({
      error: { error: { code: 'VALIDATION_ERROR', message: 'That locale is not supported.' } },
    });

    renderMyAccount();

    const dialog = await openPreferencesDialog();
    fireEvent.click(screen.getByTestId('my-account-preferences-save'));

    expect(await within(dialog).findByText('That locale is not supported.')).toBeVisible();
    expect(screen.queryByText('Preferences saved')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('my-account-locale'), { target: { value: 'fr-FR' } });
    await waitFor(() => expect(within(dialog).queryByText('That locale is not supported.')).not.toBeInTheDocument());
  });

  it('closes on Cancel without saving', async () => {
    primeMyAccount();

    renderMyAccount();

    const dialog = await openPreferencesDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByTestId('my-account-preferences-dialog')).not.toBeInTheDocument());
    expect(mockApi.updateUserPreferences).not.toHaveBeenCalled();
  });
});
