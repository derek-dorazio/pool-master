import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/features/auth/auth-provider';
import { useSessionStore } from '@/features/auth/session-store';
import { LeagueDetailPage } from './league-detail-page';

const changeMemberRoleMock = vi.fn();
const generateInviteLinkMock = vi.fn();
const getCurrentUserMock = vi.fn();
const getLeagueByCodeMock = vi.fn();
const leaveLeagueMock = vi.fn();
const listContestsMock = vi.fn();
const listLeagueMembersMock = vi.fn();
const logoutUserMock = vi.fn();
const refreshTokenMock = vi.fn();
const removeMemberMock = vi.fn();
const sendLeagueInvitationsMock = vi.fn();

vi.mock('@/lib/api', () => ({
  changeMemberRole: (...args: unknown[]) => changeMemberRoleMock(...args),
  generateInviteLink: (...args: unknown[]) => generateInviteLinkMock(...args),
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
  getLeagueByCode: (...args: unknown[]) => getLeagueByCodeMock(...args),
  leaveLeague: (...args: unknown[]) => leaveLeagueMock(...args),
  listContests: (...args: unknown[]) => listContestsMock(...args),
  listLeagueMembers: (...args: unknown[]) => listLeagueMembersMock(...args),
  logoutUser: (...args: unknown[]) => logoutUserMock(...args),
  refreshToken: (...args: unknown[]) => refreshTokenMock(...args),
  removeMember: (...args: unknown[]) => removeMemberMock(...args),
  sendLeagueInvitations: (...args: unknown[]) => sendLeagueInvitationsMock(...args),
}));

function renderLeagueDetailPage() {
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
        <MemoryRouter initialEntries={['/league/BIGDAWGS']}>
          <Routes>
            <Route element={<LeagueDetailPage />} path="/league/:leagueCode" />
            <Route element={<div data-testid="welcome-page" />} path="/welcome" />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function primeCommonMocks() {
  getCurrentUserMock.mockResolvedValue({
    data: {
      user: {
        id: 'user-1',
        email: 'commissioner@example.com',
        firstName: 'Casey',
        lastName: 'Commissioner',
        isActive: true,
        isRootAdmin: false,
        createdAt: '2026-04-15T00:00:00.000Z',
      },
    },
  });
  refreshTokenMock.mockResolvedValue({ data: null });
  getLeagueByCodeMock.mockResolvedValue({
    data: {
      league: {
        id: 'league-1',
        leagueCode: 'BIGDAWGS',
        name: 'Big Dawgs',
        description: 'A test league',
        isActive: true,
        iconKey: 'TROPHY',
        memberCount: 2,
        activeContestCount: 0,
        role: 'COMMISSIONER',
        joinPolicy: 'COMMISSIONER_ONLY',
        createdAt: '2026-04-15T00:00:00.000Z',
      },
    },
  });
  listContestsMock.mockResolvedValue({
    data: {
      contests: [],
    },
  });
  listLeagueMembersMock.mockResolvedValue({
    data: {
      members: [
        {
          id: 'membership-1',
          userId: 'user-1',
          email: 'commissioner@example.com',
          firstName: 'Casey',
          lastName: 'Commissioner',
          role: 'COMMISSIONER',
          joinedAt: '2026-04-15T00:00:00.000Z',
        },
        {
          id: 'membership-2',
          userId: 'user-2',
          email: 'member@example.com',
          firstName: 'Morgan',
          lastName: 'Member',
          role: 'MEMBER',
          joinedAt: '2026-04-16T00:00:00.000Z',
        },
      ],
    },
  });
}

describe('LeagueDetailPage', () => {
  afterEach(() => {
    changeMemberRoleMock.mockReset();
    generateInviteLinkMock.mockReset();
    getCurrentUserMock.mockReset();
    getLeagueByCodeMock.mockReset();
    leaveLeagueMock.mockReset();
    listContestsMock.mockReset();
    listLeagueMembersMock.mockReset();
    logoutUserMock.mockReset();
    refreshTokenMock.mockReset();
    removeMemberMock.mockReset();
    sendLeagueInvitationsMock.mockReset();
    useSessionStore.getState().clearSession();
  });

  it('allows a commissioner to promote a member from the roster', async () => {
    primeCommonMocks();
    changeMemberRoleMock.mockResolvedValue({
      data: {
        membership: {
          id: 'membership-2',
          leagueId: 'league-1',
          userId: 'user-2',
          role: 'COMMISSIONER',
          status: 'ACTIVE',
          joinedAt: '2026-04-16T00:00:00.000Z',
          createdAt: '2026-04-16T00:00:00.000Z',
          updatedAt: '2026-04-16T00:00:00.000Z',
        },
      },
    });

    renderLeagueDetailPage();

    await screen.findByTestId('league-home');
    fireEvent.click(screen.getByTestId('league-member-promote-membership-2'));

    await waitFor(() =>
      expect(changeMemberRoleMock).toHaveBeenCalledWith({
        path: { id: 'league-1', uid: 'user-2' },
        body: { role: 'COMMISSIONER' },
      }),
    );
  });

  it('shows a clear handoff message when the last commissioner tries to leave', async () => {
    primeCommonMocks();
    leaveLeagueMock.mockResolvedValue({
      error: {
        code: 'LEAGUE_LAST_COMMISSIONER_REQUIRED',
        message: 'Appoint another active commissioner before removing or demoting the last commissioner.',
      },
    });

    renderLeagueDetailPage();

    await screen.findByTestId('league-home');
    fireEvent.click(screen.getByTestId('league-leave'));

    expect(await screen.findByTestId('league-leave-error')).toHaveTextContent(
      'Appoint another commissioner before the last commissioner leaves or steps down.',
    );
  });
});
