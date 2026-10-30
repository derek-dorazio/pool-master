import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DialogActions } from './dialog-actions';

function renderActions(overrides: Partial<Parameters<typeof DialogActions>[0]> = {}) {
  const onAction = vi.fn();
  const onCancel = vi.fn();
  render(
    <DialogActions
      actionLabel="Remove owner"
      actionTestId="dialog-action"
      cancelLabel="Cancel"
      isPending={false}
      onAction={onAction}
      onCancel={onCancel}
      pendingLabel="Removing..."
      {...overrides}
    />,
  );
  return { onAction, onCancel };
}

describe('DialogActions', () => {
  it('runs the action or cancels on the matching button', async () => {
    const { onAction, onCancel } = renderActions();

    await userEvent.click(screen.getByTestId('dialog-action'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('holds both buttons and shows the pending label while the action runs', () => {
    renderActions({ isPending: true });

    expect(screen.getByTestId('dialog-action')).toBeDisabled();
    expect(screen.getByTestId('dialog-action')).toHaveTextContent('Removing...');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('holds only the action while it is not allowed yet, so the dialog can still be cancelled', () => {
    renderActions({ isActionDisabled: true });

    expect(screen.getByTestId('dialog-action')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });
});
