import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LinkedAccounts } from './linked-accounts';

const {
  mockUseProfile,
  mockUseLinkedAccounts,
  mockUseConnectAccount,
  mockUseDisconnectAccount,
} = vi.hoisted(() => ({
  mockUseProfile: vi.fn(),
  mockUseLinkedAccounts: vi.fn(),
  mockUseConnectAccount: vi.fn(),
  mockUseDisconnectAccount: vi.fn(),
}));

vi.mock('./hooks/use-linked-accounts', () => ({
  useLinkedAccounts: () =>
    mockUseLinkedAccounts() ?? {
      data: [],
      isLoading: false,
    },
  useConnectAccount: () =>
    mockUseConnectAccount() ?? {
      mutate: vi.fn(),
      isPending: false,
    },
  useDisconnectAccount: () =>
    mockUseDisconnectAccount() ?? {
      mutate: vi.fn(),
      isPending: false,
    },
}));

vi.mock('./hooks/use-profile', () => ({
  useProfile: () =>
    mockUseProfile() ?? {
      data: {
        authProvider: 'email',
      },
    },
}));

describe('LinkedAccounts', () => {
  beforeEach(() => {
    mockUseProfile.mockReset();
    mockUseLinkedAccounts.mockReset();
    mockUseConnectAccount.mockReset();
    mockUseDisconnectAccount.mockReset();
  });

  it('shows loading skeletons while linked accounts load', () => {
    mockUseLinkedAccounts.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    render(<LinkedAccounts />);

    expect(screen.getByText('Linked Accounts')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument();
  });

  it('connects an account that is not yet linked', async () => {
    const user = userEvent.setup();
    const connect = vi.fn();

    mockUseLinkedAccounts.mockReturnValue({
      data: [
        { provider: 'google', connected: true, email: 'owner@example.com' },
        { provider: 'apple', connected: false, email: null },
      ],
      isLoading: false,
    });
    mockUseConnectAccount.mockReturnValue({
      mutate: connect,
      isPending: false,
    });

    render(<LinkedAccounts />);

    await user.click(screen.getByRole('button', { name: 'Connect' }));

    expect(connect).toHaveBeenCalledWith('apple');
  });

  it('disables disconnect when the current sign-in method would be the only one left', () => {
    mockUseProfile.mockReturnValue({
      data: { authProvider: 'google' },
    });
    mockUseLinkedAccounts.mockReturnValue({
      data: [{ provider: 'google', connected: true, email: 'owner@example.com' }],
      isLoading: false,
    });

    render(<LinkedAccounts />);

    const disconnectButton = screen.getByRole('button', { name: 'Disconnect' });
    expect(disconnectButton).toBeDisabled();
    expect(disconnectButton).toHaveAttribute(
      'title',
      'You must have at least one sign-in method. Set a password first.',
    );
  });

  it('confirms a disconnect before invoking the mutation', async () => {
    const user = userEvent.setup();
    const disconnect = vi.fn();

    mockUseProfile.mockReturnValue({
      data: { authProvider: 'email' },
    });
    mockUseLinkedAccounts.mockReturnValue({
      data: [
        { provider: 'google', connected: true, email: 'owner@example.com' },
        { provider: 'apple', connected: false, email: null },
      ],
      isLoading: false,
    });
    mockUseDisconnectAccount.mockReturnValue({
      mutate: disconnect,
      isPending: false,
    });

    render(<LinkedAccounts />);

    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(disconnect).toHaveBeenCalledWith('google');
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  });
});
