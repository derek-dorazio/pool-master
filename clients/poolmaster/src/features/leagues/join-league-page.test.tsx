import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TeamIconKey } from '@poolmaster/shared/domain';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/features/auth/auth-provider';
import { useSessionStore } from '@/features/auth/session-store';
import { JoinLeaguePage } from './join-league-page';
import {
  acceptInvitationData,
  apiSuccess,
  buildAcceptedLeagueMembership,
  buildCurrentUser,
  buildInvitationPreview,
  buildLeagueSquad,
  buildLeagueSquadMember,
  getInvitationPreviewData,
  listLeagueSquadsData,
  updateLeagueSquadData,
} from './test/fixtures';

const {
  acceptInvitationMock,
  getCurrentUserMock,
  getInvitationPreviewMock,
  listLeagueSquadsMock,
  logoutUserMock,
  mockLogger,
  refreshTokenMock,
  updateLeagueSquadMock,
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
    acceptInvitationMock: vi.fn(),
    getCurrentUserMock: vi.fn(),
    getInvitationPreviewMock: vi.fn(),
    listLeagueSquadsMock: vi.fn(),
    logoutUserMock: vi.fn(),
    mockLogger: logger,
    refreshTokenMock: vi.fn(),
    updateLeagueSquadMock: vi.fn(),
  };
});

vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

vi.mock('@/lib/api', () => ({
  acceptInvitation: (...args: unknown[]) => acceptInvitationMock(...args),
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
  getInvitationPreview: (...args: unknown[]) => getInvitationPreviewMock(...args),
  listLeagueSquads: (...args: unknown[]) => listLeagueSquadsMock(...args),
  logoutUser: (...args: unknown[]) => logoutUserMock(...args),
  refreshToken: (...args: unknown[]) => refreshTokenMock(...args),
  updateLeagueSquad: (...args: unknown[]) => updateLeagueSquadMock(...args),
}));

function renderJoinLeaguePage(initialEntry = '/invite/LEAGUE123') {
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
            <Route element={<JoinLeaguePage />} path="/invite/:inviteCode" />
            <Route element={<div data-testid="league-destination" />} path="/league/:leagueCode" />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('pool-master-rop.23: JoinLeaguePage generated DTO fixtures', () => {
  afterEach(() => {
    acceptInvitationMock.mockReset();
    getCurrentUserMock.mockReset();
    getInvitationPreviewMock.mockReset();
    listLeagueSquadsMock.mockReset();
    logoutUserMock.mockReset();
    refreshTokenMock.mockReset();
    updateLeagueSquadMock.mockReset();
    mockLogger.debug.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
    useSessionStore.getState().clearSession();
  });

  it('pool-master-rop.23: lets an authenticated member set team name and icon during join', async () => {
    getCurrentUserMock.mockResolvedValue(apiSuccess({
      user: buildCurrentUser({
        email: 'derek@example.com',
        username: 'derek@example.com',
        firstName: 'Derek',
        lastName: 'Dorazio',
        createdAt: '2026-04-16T00:00:00.000Z',
      }),
    }));
    refreshTokenMock.mockResolvedValue({ data: null });
    getInvitationPreviewMock.mockResolvedValue(apiSuccess(getInvitationPreviewData(
      buildInvitationPreview(),
    )));
    acceptInvitationMock.mockResolvedValue(apiSuccess(acceptInvitationData(
      buildAcceptedLeagueMembership(),
    )));
    listLeagueSquadsMock.mockResolvedValue(apiSuccess(listLeagueSquadsData([
      buildLeagueSquad({
        name: "Derek Dorazio's Team",
        createdAt: '2026-04-16T00:00:00.000Z',
        updatedAt: '2026-04-16T00:00:00.000Z',
        members: [
          buildLeagueSquadMember({
            firstName: 'Derek',
            lastName: 'Dorazio',
            joinedAt: '2026-04-16T00:00:00.000Z',
            createdAt: '2026-04-16T00:00:00.000Z',
            updatedAt: '2026-04-16T00:00:00.000Z',
          }),
        ],
      }),
    ])));
    updateLeagueSquadMock.mockResolvedValue(apiSuccess(updateLeagueSquadData(buildLeagueSquad({
      name: 'Beer Bellies',
      iconKey: TeamIconKey.TURBO_TURTLE_MIDNIGHT,
      createdAt: '2026-04-16T00:00:00.000Z',
      updatedAt: '2026-04-16T00:00:00.000Z',
      members: [],
    }))));

    renderJoinLeaguePage();

    await screen.findByTestId('join-league-page');
    fireEvent.change(screen.getByTestId('join-league-team-name'), {
      target: { value: 'Beer Bellies' },
    });
    fireEvent.click(screen.getByTestId(`join-league-team-icon-${TeamIconKey.TURBO_TURTLE_MIDNIGHT}`));
    fireEvent.click(screen.getByTestId('invite-accept'));

    await waitFor(() =>
      expect(updateLeagueSquadMock).toHaveBeenCalledWith({
        path: { id: 'league-1', squadId: 'team-1' },
        body: { name: 'Beer Bellies', iconKey: TeamIconKey.TURBO_TURTLE_MIDNIGHT },
      }),
    );
    await screen.findByTestId('league-destination');
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'leagueInvite.accept.succeeded',
        data: expect.objectContaining({
          leagueCode: 'BIGDAWGS',
        }),
      }),
      expect.any(String),
    );
  });

  it('pool-master-rop.23: shows the rejection message when accepting the invitation fails with an expected error payload', async () => {
    getCurrentUserMock.mockResolvedValue(apiSuccess({
      user: buildCurrentUser({
        email: 'derek@example.com',
        username: 'derek@example.com',
        firstName: 'Derek',
        lastName: 'Dorazio',
        createdAt: '2026-04-16T00:00:00.000Z',
      }),
    }));
    refreshTokenMock.mockResolvedValue({ data: null });
    getInvitationPreviewMock.mockResolvedValue(apiSuccess(getInvitationPreviewData(
      buildInvitationPreview(),
    )));
    acceptInvitationMock.mockResolvedValue({
      error: {
        message: 'This invitation has already been accepted.',
      },
    });

    renderJoinLeaguePage();

    await screen.findByTestId('join-league-page');
    fireEvent.click(screen.getByTestId('invite-accept'));

    await screen.findByText('This invitation has already been accepted.');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'leagueInvite.accept.failed',
      }),
      expect.any(String),
    );
  });
});
