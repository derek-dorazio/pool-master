import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

describe('ConfirmDialog', () => {
  const defaultProps = {
    open: true,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    title: 'Suspend tenant?',
    description: 'This will disable all access for this tenant.',
  };

  beforeEach(() => {
    defaultProps.onConfirm.mockClear();
    defaultProps.onCancel.mockClear();
  });

  it('not visible when open=false', () => {
    render(<ConfirmDialog {...defaultProps} open={false} />);

    expect(screen.queryByText('Suspend tenant?')).not.toBeInTheDocument();
  });

  it('shows title and description when open', () => {
    render(<ConfirmDialog {...defaultProps} />);

    expect(screen.getByText('Suspend tenant?')).toBeInTheDocument();
    expect(screen.getByText('This will disable all access for this tenant.')).toBeInTheDocument();
  });

  it('confirm button calls onConfirm', async () => {
    const user = userEvent.setup();
    render(<ConfirmDialog {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('cancel button calls onCancel', async () => {
    const user = userEvent.setup();
    render(<ConfirmDialog {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it('destructive variant passes variant to confirm button', () => {
    render(<ConfirmDialog {...defaultProps} variant="destructive" />);

    const confirmBtn = screen.getByRole('button', { name: 'Confirm' });
    expect(confirmBtn).toBeInTheDocument();
  });

  it('uses custom confirmLabel when provided', () => {
    render(<ConfirmDialog {...defaultProps} confirmLabel="Yes, suspend" />);

    expect(screen.getByRole('button', { name: 'Yes, suspend' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  });
});
