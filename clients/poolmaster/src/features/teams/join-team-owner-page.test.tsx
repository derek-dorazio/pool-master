import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { AuthProvider } from '@/features/auth/auth-provider';
import { JoinTeamOwnerPage } from './join-team-owner-page';

const {
  acceptTeamOwnerInvitationMock,
  getCurrentUserMock,
  getTeamOwnerInvitationPreviewMock,
  logoutUserMock,
  mockLogger,
  refreshTokenMock,
  registerWithTeamOwnerInvitationMock,
} = vi.hoisted(() => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };

  logger.child.mockImplementation(() => logger);

  return {
    acceptTeamOwnerInvitationMock: vi.fn(),
    getCurrentUserMock: vi.fn(),
    registerWithTeamOwnerInvitationMock: vi.fn(),
    getTeamOwnerInvitationPreviewMock: vi.fn(),
    logoutUserMock: vi.fn(),
    mockLogger: logger,
    refreshTokenMock: vi.fn(),
  };
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

bindApiMocks({
  acceptTeamOwnerInvitation: acceptTeamOwnerInvitationMock,
  getUser: getCurrentUserMock,
  getTeamOwnerInvitationPreview: getTeamOwnerInvitationPreviewMock,
  logoutUser: logoutUserMock,
  refreshToken: refreshTokenMock,
  registerWithTeamOwnerInvitation: registerWithTeamOwnerInvitationMock,
});

function renderJoinTeamOwnerPage(initialEntry = '/team-invite/TEAM123') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route element={<JoinTeamOwnerPage />} path="/team-invite/:inviteCode" />
            <Route element={<div data-testid="team-destination" />} path="/league/:leagueCode/team" />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('JoinTeamOwnerPage', () => {
  afterEach(() => {
    acceptTeamOwnerInvitationMock.mockReset();
    registerWithTeamOwnerInvitationMock.mockReset();
    getCurrentUserMock.mockReset();
    getTeamOwnerInvitationPreviewMock.mockReset();
    logoutUserMock.mockReset();
    refreshTokenMock.mockReset();
    mockLogger.debug.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
  });

  // #217 — was "sends unauthenticated users back through sign-in and registration". That bounce
  // was a dead end: `acceptTeamOwnerInvitation` needs a session, so an invited stranger had no way
  // through. The page registers them inline now.
  it('offers an unauthenticated invitee the registration form rather than sending them away', async () => {
    getCurrentUserMock.mockRejectedValue(new Error('Not authenticated'));
    refreshTokenMock.mockResolvedValue({ data: null });
    getTeamOwnerInvitationPreviewMock.mockResolvedValue({
      data: {
        invitation: {
          inviteCode: 'TEAM123',
          status: 'PENDING',
          league: {
            id: 'league-1',
            leagueCode: 'BIGDAWGS',
            name: 'Big Dawgs',
          },
          team: {
            id: 'team-1',
            name: 'Beer Bellies',
            iconKey: 'CAPTAIN_SMILE_FIELD',
          },
          roleAfterAccept: 'MEMBER',
        },
      },
    });

    renderJoinTeamOwnerPage();

    expect(await screen.findByTestId('team-invite-register-form')).toBeVisible();
    expect(screen.getByTestId('team-invite-register-submit')).toBeVisible();
    // Signing in stays available for somebody who already has an account; what is gone is the
    // "create an account and come back" round trip.
    expect(screen.getByTestId('team-invite-sign-in')).toHaveAttribute('href', '/');
    expect(screen.queryByTestId('team-invite-create-account')).not.toBeInTheDocument();
    // No email field: the account uses the invited address, which the server reads off the
    // invitation. That is the security property, so its absence is asserted.
    expect(screen.queryByTestId('team-invite-register-email')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(getTeamOwnerInvitationPreviewMock).toHaveBeenCalledWith({
        path: { inviteCode: 'TEAM123' },
      }),
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'teamInvite.preview.loaded',
      }),
      expect.any(String),
    );
  });

  it('registers an invited stranger and lands them on their team', async () => {
    getCurrentUserMock.mockRejectedValue(new Error('Not authenticated'));
    refreshTokenMock.mockResolvedValue({ data: null });
    getTeamOwnerInvitationPreviewMock.mockResolvedValue({
      data: {
        invitation: {
          inviteCode: 'TEAM123',
          status: 'PENDING',
          league: { id: 'league-1', leagueCode: 'BIGDAWGS', name: 'Big Dawgs' },
          team: { id: 'team-1', name: 'Beer Bellies', iconKey: 'CAPTAIN_SMILE_FIELD' },
          roleAfterAccept: 'MEMBER',
        },
      },
    });
    registerWithTeamOwnerInvitationMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-9',
          email: 'stranger@example.com',
          username: 'stranger',
          firstName: 'Sam',
          lastName: 'Stranger',
          isActive: true,
          isRootAdmin: false,
        },
        tokens: { accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 },
      },
    });

    renderJoinTeamOwnerPage();

    await screen.findByTestId('team-invite-register-form');
    fireEvent.change(screen.getByTestId('team-invite-register-first-name'), {
      target: { value: 'Sam' },
    });
    fireEvent.change(screen.getByTestId('team-invite-register-last-name'), {
      target: { value: 'Stranger' },
    });
    fireEvent.change(screen.getByTestId('team-invite-register-username'), {
      target: { value: 'Stranger' },
    });
    fireEvent.change(screen.getByTestId('team-invite-register-password'), {
      target: { value: 'stranger-pass-1' },
    });
    fireEvent.click(screen.getByTestId('team-invite-register-submit'));

    await waitFor(() =>
      expect(registerWithTeamOwnerInvitationMock).toHaveBeenCalledWith({
        body: {
          inviteCode: 'TEAM123',
          // Lower-cased like the main registration form does it, and NO email — the account uses
          // the invited address, which only the server knows.
          username: 'stranger',
          password: 'stranger-pass-1',
          firstName: 'Sam',
          lastName: 'Stranger',
        },
      }),
    );

    // One step: registered, joined, and taken to the team rather than back to sign-in.
    expect(await screen.findByTestId('team-destination')).toBeInTheDocument();
  });

  it('accepts a team-owner invitation for an authenticated user', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: true,
          isRootAdmin: false,
          createdAt: '2026-04-16T00:00:00.000Z',
        },
      },
    });
    refreshTokenMock.mockResolvedValue({ data: null });
    getTeamOwnerInvitationPreviewMock.mockResolvedValue({
      data: {
        invitation: {
          inviteCode: 'TEAM123',
          status: 'PENDING',
          league: {
            id: 'league-1',
            leagueCode: 'BIGDAWGS',
            name: 'Big Dawgs',
          },
          team: {
            id: 'team-1',
            name: 'Beer Bellies',
            iconKey: 'CAPTAIN_SMILE_FIELD',
          },
          roleAfterAccept: 'MEMBER',
        },
      },
    });
    acceptTeamOwnerInvitationMock.mockResolvedValue({
      data: {
        invitation: {
          id: 'invitation-1',
          leagueId: 'league-1',
          squadId: 'team-1',
          email: 'derek@example.com',
          inviteCode: 'TEAM123',
          status: 'ACCEPTED',
          invitedBy: 'user-2',
          acceptedBy: 'user-1',
          acceptedAt: '2026-04-16T00:00:00.000Z',
          createdAt: '2026-04-16T00:00:00.000Z',
          updatedAt: '2026-04-16T00:00:00.000Z',
          team: {
            id: 'team-1',
            name: 'Beer Bellies',
            iconKey: 'CAPTAIN_SMILE_FIELD',
          },
        },
      },
    });

    renderJoinTeamOwnerPage();

    await screen.findByTestId('team-owner-invite-page');
    fireEvent.click(screen.getByTestId('team-invite-accept'));

    await waitFor(() =>
      expect(acceptTeamOwnerInvitationMock).toHaveBeenCalledWith({
        body: { inviteCode: 'TEAM123' },
      }),
    );
    await screen.findByTestId('team-destination');
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'teamInvite.accept.succeeded',
      }),
      expect.any(String),
    );
  });

  it('shows the rejection message when team-owner invitation acceptance fails with an expected error payload', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: true,
          isRootAdmin: false,
          createdAt: '2026-04-16T00:00:00.000Z',
        },
      },
    });
    refreshTokenMock.mockResolvedValue({ data: null });
    getTeamOwnerInvitationPreviewMock.mockResolvedValue({
      data: {
        invitation: {
          inviteCode: 'TEAM123',
          status: 'PENDING',
          league: {
            id: 'league-1',
            leagueCode: 'BIGDAWGS',
            name: 'Big Dawgs',
          },
          team: {
            id: 'team-1',
            name: 'Beer Bellies',
            iconKey: 'CAPTAIN_SMILE_FIELD',
          },
          roleAfterAccept: 'MEMBER',
        },
      },
    });
    acceptTeamOwnerInvitationMock.mockResolvedValue({
      error: {
        message: 'This team invitation is no longer active.',
      },
    });

    renderJoinTeamOwnerPage();

    await screen.findByTestId('team-owner-invite-page');
    fireEvent.click(screen.getByTestId('team-invite-accept'));

    await screen.findByText('This team invitation is no longer active.');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'teamInvite.accept.failed',
      }),
      expect.any(String),
    );
  });
});
