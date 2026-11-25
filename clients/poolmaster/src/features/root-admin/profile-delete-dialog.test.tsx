import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProfileDeleteDialog } from './profile-delete-dialog';

vi.mock('@/lib/logger');

function openDialog(remove: () => Promise<void>) {
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProfileDeleteDialog invalidates={['profiles']} kindLabel="tier profile" name="Standard tiers" onClose={onClose} remove={remove} testId="profile-delete" />
    </QueryClientProvider>,
  );
  return onClose;
}

describe('ProfileDeleteDialog', () => {
  it('closes on Cancel without deleting', async () => {
    const remove = vi.fn(() => Promise.resolve());
    const onClose = openDialog(remove);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });

  it('keeps the dialog open with the reason when the delete is refused, and closes on Escape after', async () => {
    const onClose = openDialog(() => Promise.reject(new Error('Two sport leagues name it.')));

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
