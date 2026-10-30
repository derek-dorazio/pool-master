import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { buildCurrentUser } from '@/features/leagues/test/fixtures';
import { AUTH_ME_QUERY_KEY } from './auth-session-cache';
import { SignUpForm } from './sign-up-form';

const { mockLogger, registerUserMock, registerWithTeamOwnerInvitationMock } = vi.hoisted(() => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() };
  logger.child.mockImplementation(() => logger);
  return { mockLogger: logger, registerUserMock: vi.fn(), registerWithTeamOwnerInvitationMock: vi.fn() };
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

bindApiMocks({
  registerUser: registerUserMock,
  registerWithTeamOwnerInvitation: registerWithTeamOwnerInvitationMock,
});

function renderForm(props: Partial<Parameters<typeof SignUpForm>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onRegistered = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <SignUpForm onRegistered={onRegistered} {...props} />
    </QueryClientProvider>,
  );
  return { onRegistered, queryClient };
}

function fillAccount({ email = 'jordan@example.com', confirm = 'correct-horse-1' }: { email?: string | null; confirm?: string } = {}) {
  fireEvent.change(screen.getByTestId('sign-up-first-name'), { target: { value: ' Jordan ' } });
  fireEvent.change(screen.getByTestId('sign-up-last-name'), { target: { value: ' Rivers ' } });
  if (email === null) {
    fireEvent.change(screen.getByTestId('sign-up-username'), { target: { value: 'jrivers' } });
  } else {
    fireEvent.change(screen.getByTestId('sign-up-email'), { target: { value: email } });
  }
  fireEvent.change(screen.getByTestId('sign-up-password'), { target: { value: 'correct-horse-1' } });
  fireEvent.change(screen.getByTestId('sign-up-confirm-password'), { target: { value: confirm } });
}

afterEach(() => {
  registerUserMock.mockReset();
  registerWithTeamOwnerInvitationMock.mockReset();
});

describe('SignUpForm', () => {
  it("lets the browser fill the member's name, email and username and offer a new password in both password fields", () => {
    renderForm();

    expect(screen.getByTestId('sign-up-first-name')).toHaveAttribute('autocomplete', 'given-name');
    expect(screen.getByTestId('sign-up-last-name')).toHaveAttribute('autocomplete', 'family-name');
    expect(screen.getByTestId('sign-up-email')).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByTestId('sign-up-username')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByTestId('sign-up-password')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByTestId('sign-up-confirm-password')).toHaveAttribute('autocomplete', 'new-password');
  });

  it('names every empty required field and sends nothing', async () => {
    renderForm();

    fireEvent.click(screen.getByTestId('sign-up-submit'));

    expect(await screen.findByText('First name is required')).toBeInTheDocument();
    expect(screen.getByText('Last name is required')).toBeInTheDocument();
    expect(registerUserMock).not.toHaveBeenCalled();
  });

  it('refuses two passwords that differ', async () => {
    renderForm();
    fillAccount({ confirm: 'something-else-1' });

    fireEvent.click(screen.getByTestId('sign-up-submit'));

    expect(await screen.findByText('Passwords must match')).toBeInTheDocument();
    expect(registerUserMock).not.toHaveBeenCalled();
  });

  it('fills the username from the email until the member types one of their own', () => {
    renderForm();

    fireEvent.change(screen.getByTestId('sign-up-email'), { target: { value: 'Jordan@Example.com' } });
    expect(screen.getByTestId('sign-up-username')).toHaveValue('jordan@example.com');

    fireEvent.change(screen.getByTestId('sign-up-username'), { target: { value: 'jrivers' } });
    fireEvent.change(screen.getByTestId('sign-up-email'), { target: { value: 'other@example.com' } });
    expect(screen.getByTestId('sign-up-username')).toHaveValue('jrivers');
  });

  it('creates the account with trimmed names, caches its session and hands the new user to the page', async () => {
    const user = buildCurrentUser({ id: 'user-new' });
    registerUserMock.mockResolvedValue({ data: { user } });
    const { onRegistered, queryClient } = renderForm();
    fillAccount();

    fireEvent.click(screen.getByTestId('sign-up-submit'));

    await waitFor(() => expect(onRegistered).toHaveBeenCalledWith(user));
    expect(registerUserMock).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ email: 'jordan@example.com', username: 'jordan@example.com', firstName: 'Jordan', lastName: 'Rivers' }) as unknown,
    }));
    expect(queryClient.getQueryData(AUTH_ME_QUERY_KEY)).toEqual(user);
  });

  it("shows the server's refusal and leaves the member on the form", async () => {
    registerUserMock.mockResolvedValue({ error: { error: { code: 'AUTH_EMAIL_IN_USE', message: 'Email is already in use.' } } });
    const { onRegistered } = renderForm();
    fillAccount();

    fireEvent.click(screen.getByTestId('sign-up-submit'));

    expect(await screen.findByTestId('sign-up-error')).toHaveTextContent('Email is already in use.');
    expect(onRegistered).not.toHaveBeenCalled();
  });

  it("uses the page's own words for a refusal it names", async () => {
    registerWithTeamOwnerInvitationMock.mockResolvedValue({
      error: { error: { code: 'SQUAD_OWNER_INVITATION_ALREADY_ACCEPTED', message: 'accepted' } },
    });
    renderForm({ errorMessages: { SQUAD_OWNER_INVITATION_ALREADY_ACCEPTED: 'Already accepted. Sign in.' }, mode: { kind: 'teamInvite', inviteCode: 'TEAM123' } });
    fillAccount({ email: null });

    fireEvent.click(screen.getByTestId('sign-up-submit'));

    expect(await screen.findByTestId('sign-up-error')).toHaveTextContent('Already accepted. Sign in.');
  });

  it('on a co-owner invitation asks no email and signs up against the invitation', async () => {
    const user = buildCurrentUser({ id: 'user-invited' });
    registerWithTeamOwnerInvitationMock.mockResolvedValue({ data: { user } });
    const { onRegistered } = renderForm({ submitLabel: 'Create account and join', mode: { kind: 'teamInvite', inviteCode: 'TEAM123' } });

    expect(screen.queryByTestId('sign-up-email')).not.toBeInTheDocument();
    fillAccount({ email: null });
    fireEvent.change(screen.getByTestId('sign-up-username'), { target: { value: '  JRivers ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account and join' }));

    await waitFor(() => expect(onRegistered).toHaveBeenCalledWith(user));
    expect(registerUserMock).not.toHaveBeenCalled();
    expect(registerWithTeamOwnerInvitationMock).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.not.objectContaining({ email: expect.anything() as unknown }) as unknown,
    }));
    expect(registerWithTeamOwnerInvitationMock).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ inviteCode: 'TEAM123', username: 'jrivers' }) as unknown,
    }));
  });
});
