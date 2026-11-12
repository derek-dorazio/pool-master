import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OptionalEmailCategory } from '@poolmaster/shared/domain';
import { mockApi } from '@/test/msw-api';
import { buildEmailPreferences, primeMyAccount, renderMyAccount } from '@/test/my-account-harness';

function preferencesWith(category: OptionalEmailCategory, enabled: boolean) {
  return buildEmailPreferences({
    preferences: Object.values(OptionalEmailCategory).map((each) => ({ category: each, enabled: each === category ? enabled : true })),
  });
}

describe('My account › Email notifications', () => {
  it('shows one named switch per category, each on or off as the API reports it', async () => {
    primeMyAccount();
    mockApi.getUserEmailPreferences.mockResolvedValue({ data: preferencesWith(OptionalEmailCategory.LIVE_STANDINGS, false) });

    renderMyAccount();

    const section = within(await screen.findByTestId('my-account-notifications'));
    expect(await section.findAllByRole('switch')).toHaveLength(Object.values(OptionalEmailCategory).length);
    expect(section.getByRole('switch', { name: 'Live standings' })).not.toBeChecked();
    expect(section.getByRole('switch', { name: 'Results' })).toBeChecked();
  });

  it('keeps how each category and the section work behind (?) tips, not sentences on the page', async () => {
    primeMyAccount();

    renderMyAccount();

    await screen.findByTestId('my-account-notifications-RESULTS');
    expect(screen.getByTestId('my-account-notifications-RESULTS-help')).toBeInTheDocument();
    expect(screen.getByTestId('my-account-notifications-help')).toBeInTheDocument();
    expect(screen.queryByText('Final standings and winners when a contest ends.')).not.toBeInTheDocument();
  });

  it('turns a category off the moment it is flipped, saves it for the member\'s own account and keeps the answer', async () => {
    primeMyAccount();
    let answer: (value: { data: unknown }) => void = () => undefined;
    mockApi.updateUserEmailPreference.mockReturnValue(new Promise<{ data: unknown }>((resolve) => { answer = resolve; }));

    renderMyAccount();

    const results = await screen.findByRole('switch', { name: 'Results' });
    fireEvent.click(results);

    // It shows off straight away, before the answer comes back.
    await waitFor(() => expect(results).toHaveAttribute('aria-checked', 'false'));
    expect(results).toBeDisabled();
    expect(mockApi.updateUserEmailPreference).toHaveBeenCalledWith(expect.objectContaining({
      path: { userId: 'me' },
      body: { category: OptionalEmailCategory.RESULTS, enabled: false },
    }));
    answer({ data: preferencesWith(OptionalEmailCategory.RESULTS, false) });
    await waitFor(() => expect(results).toBeEnabled());
    expect(results).not.toBeChecked();
    expect(mockApi.getUserEmailPreferences).toHaveBeenCalledTimes(1);
  });

  it('puts the switch back and says why when saving a flip fails', async () => {
    primeMyAccount();
    mockApi.updateUserEmailPreference.mockResolvedValue({
      error: { error: { code: 'INTERNAL_ERROR', message: 'We could not save that right now.' } },
    });

    renderMyAccount();

    const results = await screen.findByRole('switch', { name: 'Results' });
    fireEvent.click(results);

    expect(await screen.findByTestId('my-account-notifications-save-error')).toHaveTextContent('We could not save that right now.');
    expect(results).toBeChecked();
  });

  it('says the email settings could not load, in red with Retry, and shows the switches once Retry succeeds', async () => {
    primeMyAccount();
    mockApi.getUserEmailPreferences
      .mockResolvedValueOnce({ error: { error: { code: 'INTERNAL_ERROR', message: 'Email settings are unavailable.' } } })
      .mockResolvedValue({ data: buildEmailPreferences() });

    renderMyAccount();

    const error = await screen.findByTestId('my-account-notifications-error');
    expect(error).toHaveTextContent('Email settings are unavailable.');
    fireEvent.click(within(error).getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('switch', { name: 'Results' })).toBeVisible();
  });
});
