import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/features/auth/auth-provider';
import { JoinTeamOwnerPage } from './join-team-owner-page';

const {
  acceptTeamOwnerInvitationMock,
  getCurrentUserMock,
  getTeamOwnerInvitationPreviewMock,
  logoutUserMock,
  mockLogger,
  refreshTokenMock,
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
    getTeamOwnerInvitationPreviewMock: vi.fn(),
    logoutUserMock: vi.fn(),
    mockLogger: logger,
    refreshTokenMock: vi.fn(),
  };
});

vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

vi.mock('@/lib/api', () => ({
  acceptTeamOwnerInvitation: (...args: unknown[]) => acceptTeamOwnerInvitationMock(...args),
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
  getTeamOwnerInvitationPreview: (...args: unknown[]) => getTeamOwnerInvitationPreviewMock(...args),
  logoutUser: (...args: unknown[]) => logoutUserMock(...args),
  refreshToken: (...args: unknown[]) => refreshTokenMock(...args),
}));

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
    getCurrentUserMock.mockReset();
    getTeamOwnerInvitationPreviewMock.mockReset();
    logoutUserMock.mockReset();
    refreshTokenMock.mockReset();
    mockLogger.debug.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
  });

  it('sends unauthenticated users back through sign-in and registration', async () => {
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

    expect(await screen.findByTestId('team-invite-sign-in')).toHaveAttribute('href', '/');
    expect(screen.getByTestId('team-invite-create-account')).toHaveAttribute('href', '/');
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
