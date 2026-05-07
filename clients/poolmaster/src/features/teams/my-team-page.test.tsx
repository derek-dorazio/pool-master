import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TeamIconKey } from '@poolmaster/shared/domain';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/features/auth/auth-provider';
import { MyTeamPage } from './my-team-page';

const changeMemberRoleMock = vi.fn();
const createLeagueSquadMock = vi.fn();
const deleteLeagueSquadMock = vi.fn();
const enterContestMock = vi.fn();
const createSquadOwnerInvitationMock = vi.fn();
const getCurrentUserMock = vi.fn();
const getLeagueByCodeMock = vi.fn();
const inactivateLeagueSquadMock = vi.fn();
const listContestEntriesMock = vi.fn();
const listContestsMock = vi.fn();
const listLeagueMembersMock = vi.fn();
const listLeagueSquadsMock = vi.fn();
const listSquadOwnerInvitationsMock = vi.fn();
const logoutUserMock = vi.fn();
const refreshTokenMock = vi.fn();
const removeSquadOwnerMock = vi.fn();
const replaceSquadOwnerMock = vi.fn();
const revokeSquadOwnerInvitationMock = vi.fn();
const updateContestEntryMock = vi.fn();
const updateLeagueSquadMock = vi.fn();

vi.mock('@/lib/api', () => ({
  changeMemberRole: (...args: unknown[]) => changeMemberRoleMock(...args),
  createLeagueSquad: (...args: unknown[]) => createLeagueSquadMock(...args),
  deleteLeagueSquad: (...args: unknown[]) => deleteLeagueSquadMock(...args),
  enterContest: (...args: unknown[]) => enterContestMock(...args),
  createSquadOwnerInvitation: (...args: unknown[]) => createSquadOwnerInvitationMock(...args),
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
  getLeagueByCode: (...args: unknown[]) => getLeagueByCodeMock(...args),
  inactivateLeagueSquad: (...args: unknown[]) => inactivateLeagueSquadMock(...args),
  listContestEntries: (...args: unknown[]) => listContestEntriesMock(...args),
  listContests: (...args: unknown[]) => listContestsMock(...args),
  listLeagueMembers: (...args: unknown[]) => listLeagueMembersMock(...args),
  listLeagueSquads: (...args: unknown[]) => listLeagueSquadsMock(...args),
  listSquadOwnerInvitations: (...args: unknown[]) => listSquadOwnerInvitationsMock(...args),
  logoutUser: (...args: unknown[]) => logoutUserMock(...args),
  refreshToken: (...args: unknown[]) => refreshTokenMock(...args),
  removeSquadOwner: (...args: unknown[]) => removeSquadOwnerMock(...args),
  replaceSquadOwner: (...args: unknown[]) => replaceSquadOwnerMock(...args),
  revokeSquadOwnerInvitation: (...args: unknown[]) => revokeSquadOwnerInvitationMock(...args),
  updateContestEntry: (...args: unknown[]) => updateContestEntryMock(...args),
  updateLeagueSquad: (...args: unknown[]) => updateLeagueSquadMock(...args),
}));

function TeamRouteControls() {
  const navigate = useNavigate();

  return (
    <button
      data-testid="go-other-team"
      onClick={() => navigate('/league/BIGDAWGS/team?teamId=team-2')}
      type="button"
    >
      Other team
    </button>
  );
}

function renderMyTeamPage(initialEntry = '/league/BIGDAWGS/team') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  const renderResult = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route
              element={(
                <>
                  <TeamRouteControls />
                  <MyTeamPage />
                </>
              )}
              path="/league/:leagueCode/team"
            />
            <Route element={<div data-testid="manage-teams-route-destination" />} path="/manage/teams" />
            <Route element={<div data-testid="user-route-destination" />} path="/users/:userId" />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );

  return {
    ...renderResult,
    queryClient,
  };
}

function buildLeagueDetail(role: 'COMMISSIONER' | 'MEMBER' = 'MEMBER', isRootAdmin = false) {
  return {
    id: 'league-1',
    leagueCode: 'BIGDAWGS',
    name: 'Big Dawgs',
    isActive: true,
    iconKey: 'TROPHY',
    memberCount: 2,
    activeContestCount: 0,
    memberType: role,
    leagueRelationship: {
      leagueMember: true,
      commissioner: role === 'COMMISSIONER',
    },
    isRootAdmin,
    joinPolicy: 'COMMISSIONER_ONLY',
    createdAt: '2026-04-15T00:00:00.000Z',
  } as const;
}

function buildTeamSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'team-1',
    leagueId: 'league-1',
    createdBy: 'user-1',
    name: 'Derek Squad',
    iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
    isActive: true,
    memberCount: 1,
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-15T00:00:00.000Z',
    teamRelationship: {
      leagueMember: true,
      owner: true,
      commissioner: false,
    },
    isRootAdmin: false,
    members: [
      {
        id: 'membership-1',
        squadId: 'team-1',
        leagueId: 'league-1',
        userId: 'user-1',
        firstName: 'Derek',
        lastName: 'Dorazio',
        status: 'ACTIVE',
        joinedAt: '2026-04-15T00:00:00.000Z',
        createdAt: '2026-04-15T00:00:00.000Z',
        updatedAt: '2026-04-15T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

function mockCurrentUser() {
  getCurrentUserMock.mockResolvedValue({
    data: {
      user: {
        id: 'user-1',
        email: 'derek@example.com',
        firstName: 'Derek',
        lastName: 'Dorazio',
        isActive: true,
        isRootAdmin: false,
        createdAt: '2026-04-15T00:00:00.000Z',
      },
    },
  });
  refreshTokenMock.mockResolvedValue({ data: null });
}

describe('pool-master-rop.22: MyTeamPage', () => {
  beforeEach(() => {
    listLeagueMembersMock.mockResolvedValue({ data: { members: [] } });
  });

  afterEach(() => {
    changeMemberRoleMock.mockReset();
    createLeagueSquadMock.mockReset();
    deleteLeagueSquadMock.mockReset();
    enterContestMock.mockReset();
    createSquadOwnerInvitationMock.mockReset();
    getCurrentUserMock.mockReset();
    getLeagueByCodeMock.mockReset();
    inactivateLeagueSquadMock.mockReset();
    listContestEntriesMock.mockReset();
    listContestsMock.mockReset();
    listLeagueMembersMock.mockReset();
    listLeagueSquadsMock.mockReset();
    listSquadOwnerInvitationsMock.mockReset();
    logoutUserMock.mockReset();
    refreshTokenMock.mockReset();
    removeSquadOwnerMock.mockReset();
    replaceSquadOwnerMock.mockReset();
    revokeSquadOwnerInvitationMock.mockReset();
    updateContestEntryMock.mockReset();
    updateLeagueSquadMock.mockReset();
  });

  it('pool-master-rop.22: renders a loading state while team page league context is pending', async () => {
    mockCurrentUser();
    getLeagueByCodeMock.mockReturnValue(new Promise(() => undefined));

    renderMyTeamPage();

    expect(await screen.findByText('Loading your team...')).toBeInTheDocument();
  });

  it('pool-master-rop.22: renders access-denied copy when league membership is rejected', async () => {
    mockCurrentUser();
    getLeagueByCodeMock.mockResolvedValue({
      error: {
        code: 'LEAGUE_MEMBERSHIP_REQUIRED',
        message: 'League membership is required.',
      },
    });

    renderMyTeamPage();

    expect(await screen.findByText('You do not have access to this league.')).toBeInTheDocument();
    expect(screen.getByText(/Open one of your active leagues/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to welcome' })).toHaveAttribute('href', '/welcome');
  });

  it('pool-master-rop.22: blocks team creation when the league relationship is not a member', async () => {
    mockCurrentUser();
    getLeagueByCodeMock.mockResolvedValue({
      data: {
        league: {
          ...buildLeagueDetail('MEMBER', true),
          leagueRelationship: {
            leagueMember: false,
            commissioner: false,
          },
        },
      },
    });
    listLeagueSquadsMock.mockResolvedValue({
      data: {
        squads: [],
      },
    });
    listLeagueMembersMock.mockResolvedValue({
      data: {
        members: [],
      },
    });
    listSquadOwnerInvitationsMock.mockResolvedValue({
      data: {
        invitations: [],
      },
    });

    renderMyTeamPage();

    await screen.findByTestId('my-team-page');
    expect(screen.getByText(/Select a team from Teams and Owners/)).toBeInTheDocument();
    expect(screen.getByTestId('my-team-name')).toBeDisabled();
    expect(screen.getByTestId('my-team-save')).toBeDisabled();
    expect(screen.getByTestId('my-team-save')).toHaveTextContent('Choose a team first');
  });

  it('pool-master-rop.22: surfaces create-team rejection without losing the typed team name', async () => {
    mockCurrentUser();
    getLeagueByCodeMock.mockResolvedValue({
      data: {
        league: buildLeagueDetail('MEMBER'),
      },
    });
    listLeagueSquadsMock.mockResolvedValue({
      data: {
        squads: [],
      },
    });
    listLeagueMembersMock.mockResolvedValue({
      data: {
        members: [
          {
            id: 'league-member-1',
            userId: 'user-1',
            email: 'derek@example.com',
            firstName: 'Derek',
            lastName: 'Dorazio',
            role: 'MEMBER',
            joinedAt: '2026-04-15T00:00:00.000Z',
          },
        ],
      },
    });
    listSquadOwnerInvitationsMock.mockResolvedValue({
      data: {
        invitations: [],
      },
    });
    createLeagueSquadMock.mockRejectedValue(new Error('Team name is already taken.'));

    renderMyTeamPage();

    await screen.findByTestId('my-team-page');
    fireEvent.change(screen.getByTestId('my-team-name'), {
      target: { value: 'Derek Squad' },
    });
    fireEvent.click(screen.getByTestId('my-team-save'));

    expect(await screen.findByText('Team name is already taken.')).toBeInTheDocument();
    expect(screen.getByTestId('my-team-name')).toHaveValue('Derek Squad');
  });

  it('pool-master-rop.22: creates a team when the current user does not yet belong to one', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: true,
          isRootAdmin: false,
          createdAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });
    refreshTokenMock.mockResolvedValue({ data: null });
    getLeagueByCodeMock.mockResolvedValue({
      data: {
        league: buildLeagueDetail('MEMBER'),
      },
    });
    listLeagueSquadsMock.mockResolvedValue({
      data: {
        squads: [],
      },
    });
    listLeagueMembersMock.mockResolvedValue({
      data: {
        members: [
          {
            id: 'league-member-1',
            userId: 'user-1',
            email: 'derek@example.com',
            firstName: 'Derek',
            lastName: 'Dorazio',
            role: 'MEMBER',
            joinedAt: '2026-04-15T00:00:00.000Z',
          },
        ],
      },
    });
    listContestsMock.mockResolvedValue({
      data: {
        contests: [],
      },
    });
    listSquadOwnerInvitationsMock.mockResolvedValue({
      data: {
        invitations: [],
      },
    });
    createLeagueSquadMock.mockResolvedValue({
      data: {
        squad: buildTeamSummary(),
      },
    });

    renderMyTeamPage();

    await screen.findByTestId('my-team-page');
    fireEvent.change(screen.getByTestId('my-team-name'), {
      target: { value: 'Derek Squad' },
    });
    fireEvent.click(screen.getByTestId('my-team-save'));

    await waitFor(() =>
      expect(createLeagueSquadMock).toHaveBeenCalledWith({
        path: { id: 'league-1' },
        body: { name: 'Derek Squad', iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD },
      }),
    );
  });

  it('pool-master-rop.22: updates the current team name when the user already belongs to a team', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: true,
          isRootAdmin: false,
          createdAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });
    refreshTokenMock.mockResolvedValue({ data: null });
    getLeagueByCodeMock.mockResolvedValue({
      data: {
        league: buildLeagueDetail('MEMBER'),
      },
    });
    listLeagueSquadsMock.mockResolvedValue({
      data: {
        squads: [
          buildTeamSummary({
            name: 'Original Team',
          }),
        ],
      },
    });
    listLeagueMembersMock.mockResolvedValue({
      data: {
        members: [
          {
            id: 'league-member-1',
            userId: 'user-1',
            email: 'derek@example.com',
            firstName: 'Derek',
            lastName: 'Dorazio',
            role: 'MEMBER',
            joinedAt: '2026-04-15T00:00:00.000Z',
          },
        ],
      },
    });
    listContestsMock.mockResolvedValue({
      data: {
        contests: [],
      },
    });
    listSquadOwnerInvitationsMock.mockResolvedValue({
      data: {
        invitations: [],
      },
    });
    updateLeagueSquadMock.mockResolvedValue({
      data: {
        squad: buildTeamSummary({
          name: 'Updated Team',
          iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
        }),
      },
    });

    renderMyTeamPage();

    fireEvent.click(await screen.findByTestId('my-team-open-name'));
    await screen.findByTestId('my-team-name-modal');
    fireEvent.change(screen.getByTestId('my-team-name'), {
      target: { value: 'Updated Team' },
    });
    fireEvent.click(screen.getByTestId('my-team-save'));

    await waitFor(() =>
      expect(updateLeagueSquadMock).toHaveBeenCalledWith({
        path: { id: 'league-1', squadId: 'team-1' },
        body: { name: 'Updated Team', iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD },
      }),
    );
  });

  it('pool-master-rop.22: surfaces update-team rejection inside the name modal without losing the draft', async () => {
    mockCurrentUser();
    getLeagueByCodeMock.mockResolvedValue({
      data: {
        league: buildLeagueDetail('MEMBER'),
      },
    });
    listLeagueSquadsMock.mockResolvedValue({
      data: {
        squads: [
          buildTeamSummary({
            name: 'Original Team',
          }),
        ],
      },
    });
    listLeagueMembersMock.mockResolvedValue({
      data: {
        members: [
          {
            id: 'league-member-1',
            userId: 'user-1',
            email: 'derek@example.com',
            firstName: 'Derek',
            lastName: 'Dorazio',
            role: 'MEMBER',
            joinedAt: '2026-04-15T00:00:00.000Z',
          },
        ],
      },
    });
    listSquadOwnerInvitationsMock.mockResolvedValue({
      data: {
        invitations: [],
      },
    });
    updateLeagueSquadMock.mockRejectedValue(new Error('Team update was rejected.'));

    renderMyTeamPage();

    fireEvent.click(await screen.findByTestId('my-team-open-name'));
    const modal = await screen.findByTestId('my-team-name-modal');
    fireEvent.change(within(modal).getByTestId('my-team-name'), {
      target: { value: 'Rejected Team Name' },
    });
    fireEvent.click(within(modal).getByTestId('my-team-save'));

    expect(await within(modal).findByText('Team update was rejected.')).toBeInTheDocument();
    expect(within(modal).getByTestId('my-team-name')).toHaveValue('Rejected Team Name');
    expect(screen.getByTestId('my-team-name-modal')).toBeInTheDocument();

    fireEvent.click(within(modal).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByTestId('my-team-name-modal')).not.toBeInTheDocument());
    expect(screen.queryByText('Team update was rejected.')).not.toBeInTheDocument();
  });

  it('pool-master-rop.20 preserves an unsaved team name draft across team query refetches', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: true,
          isRootAdmin: false,
          createdAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });
    refreshTokenMock.mockResolvedValue({ data: null });
    getLeagueByCodeMock.mockResolvedValue({
      data: {
        league: buildLeagueDetail('MEMBER'),
      },
    });
    listLeagueSquadsMock.mockResolvedValue({
      data: {
        squads: [
          buildTeamSummary({
            name: 'Original Team',
          }),
        ],
      },
    });
    listLeagueMembersMock.mockResolvedValue({
      data: {
        members: [
          {
            id: 'league-member-1',
            userId: 'user-1',
            email: 'derek@example.com',
            firstName: 'Derek',
            lastName: 'Dorazio',
            role: 'MEMBER',
            joinedAt: '2026-04-15T00:00:00.000Z',
          },
        ],
      },
    });
    listSquadOwnerInvitationsMock.mockResolvedValue({
      data: {
        invitations: [],
      },
    });

    const { queryClient } = renderMyTeamPage();

    fireEvent.click(await screen.findByTestId('my-team-open-name'));
    await screen.findByTestId('my-team-name-modal');
    fireEvent.change(screen.getByTestId('my-team-name'), {
      target: { value: 'Unsaved Team Name' },
    });
    listLeagueSquadsMock.mockResolvedValueOnce({
      data: {
        squads: [
          buildTeamSummary({
            name: 'Server Snapshot Team',
          }),
        ],
      },
    });

    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['poolmaster', 'league-teams', 'league-1'] });
    });

    await waitFor(() =>
      expect(queryClient.getQueryData(['poolmaster', 'league-teams', 'league-1'])).toEqual([
        expect.objectContaining({
          name: 'Server Snapshot Team',
        }),
      ]),
    );
    await waitFor(() =>
      expect(screen.getByTestId('my-team-details-tile')).toHaveTextContent('Server Snapshot Team'),
    );

    expect(screen.getByTestId('my-team-name')).toHaveValue('Unsaved Team Name');
  });

  it('pool-master-rop.20 reseeds the team name draft when the selected team identity changes', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: true,
          isRootAdmin: false,
          createdAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });
    refreshTokenMock.mockResolvedValue({ data: null });
    getLeagueByCodeMock.mockResolvedValue({
      data: {
        league: buildLeagueDetail('COMMISSIONER'),
      },
    });
    listLeagueSquadsMock.mockResolvedValue({
      data: {
        squads: [
          buildTeamSummary({
            id: 'team-1',
            name: 'Original Team',
            teamRelationship: {
              leagueMember: true,
              owner: true,
              commissioner: true,
            },
          }),
          buildTeamSummary({
            id: 'team-2',
            name: 'Other Team',
            teamRelationship: {
              leagueMember: true,
              owner: false,
              commissioner: true,
            },
            members: [],
          }),
        ],
      },
    });
    listLeagueMembersMock.mockResolvedValue({
      data: {
        members: [],
      },
    });
    listSquadOwnerInvitationsMock.mockResolvedValue({
      data: {
        invitations: [],
      },
    });
    updateLeagueSquadMock.mockResolvedValue({
      data: {
        squad: buildTeamSummary({
          id: 'team-2',
          name: 'Renamed Other Team',
          teamRelationship: {
            leagueMember: true,
            owner: false,
            commissioner: true,
          },
          members: [],
        }),
      },
    });

    renderMyTeamPage('/league/BIGDAWGS/team?teamId=team-1');

    fireEvent.click(await screen.findByTestId('my-team-open-name'));
    await screen.findByTestId('my-team-name-modal');
    fireEvent.change(screen.getByTestId('my-team-name'), {
      target: { value: 'Unsaved Team Name' },
    });

    fireEvent.click(screen.getByTestId('go-other-team'));

    await waitFor(() => expect(screen.getByTestId('my-team-name')).toHaveValue('Other Team'));

    fireEvent.change(screen.getByTestId('my-team-name'), {
      target: { value: 'Renamed Other Team' },
    });
    fireEvent.click(screen.getByTestId('my-team-save'));

    await waitFor(() =>
      expect(updateLeagueSquadMock).toHaveBeenCalledWith({
        path: { id: 'league-1', squadId: 'team-2' },
        body: { name: 'Renamed Other Team', iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD },
      }),
    );
    expect(updateLeagueSquadMock).not.toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 'league-1', squadId: 'team-1' },
    }));
  });

  // pool-master-dxd.14 — icon mutation response updates the query-owned team icon
  // without relying on duplicated local selected-icon state.
  it('updates the team icon from a modal and returns to Team Home with the new icon', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: true,
          isRootAdmin: false,
          createdAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });
    refreshTokenMock.mockResolvedValue({ data: null });
    getLeagueByCodeMock.mockResolvedValue({
      data: {
        league: buildLeagueDetail('MEMBER'),
      },
    });
    listLeagueSquadsMock.mockResolvedValue({
      data: {
        squads: [buildTeamSummary()],
      },
    });
    listLeagueMembersMock.mockResolvedValue({
      data: {
        members: [
          {
            id: 'league-member-1',
            userId: 'user-1',
            email: 'derek@example.com',
            firstName: 'Derek',
            lastName: 'Dorazio',
            role: 'MEMBER',
            joinedAt: '2026-04-15T00:00:00.000Z',
          },
        ],
      },
    });
    listContestsMock.mockResolvedValue({
      data: {
        contests: [],
      },
    });
    listSquadOwnerInvitationsMock.mockResolvedValue({
      data: {
        invitations: [],
      },
    });
    updateLeagueSquadMock.mockResolvedValue({
      data: {
        squad: buildTeamSummary({
          iconKey: TeamIconKey.TURBO_TURTLE_MIDNIGHT,
        }),
      },
    });

    renderMyTeamPage();

    await screen.findByTestId('my-team-current-icon-label');
    expect(screen.getByTestId('my-team-current-icon-label')).toHaveTextContent('Captain Smile Field');

    fireEvent.click(screen.getByTestId('my-team-change-icon'));
    await screen.findByTestId('my-team-icon-modal');

    fireEvent.click(screen.getByTestId(`my-team-icon-${TeamIconKey.TURBO_TURTLE_MIDNIGHT}`));
    fireEvent.click(screen.getByTestId('my-team-save-icon'));

    await waitFor(() =>
      expect(updateLeagueSquadMock).toHaveBeenCalledWith({
        path: { id: 'league-1', squadId: 'team-1' },
        body: { iconKey: TeamIconKey.TURBO_TURTLE_MIDNIGHT },
      }),
    );
    await waitFor(() => expect(screen.queryByTestId('my-team-icon-modal')).not.toBeInTheDocument());
    expect(screen.getByTestId('my-team-current-icon-label')).toHaveTextContent('Turbo Turtle Midnight');
  });

  // pool-master-dxd.31 — Team has many more icon variants than League, so the
  // modal and palette must stay constrained and scrollable with actions reachable.
  it('keeps the team icon picker constrained and scrollable like the league icon picker', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: true,
          isRootAdmin: false,
          createdAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });
    refreshTokenMock.mockResolvedValue({ data: null });
    getLeagueByCodeMock.mockResolvedValue({
      data: {
        league: buildLeagueDetail('MEMBER'),
      },
    });
    listLeagueSquadsMock.mockResolvedValue({
      data: {
        squads: [buildTeamSummary()],
      },
    });
    listLeagueMembersMock.mockResolvedValue({
      data: {
        members: [
          {
            id: 'league-member-1',
            userId: 'user-1',
            email: 'derek@example.com',
            firstName: 'Derek',
            lastName: 'Dorazio',
            role: 'MEMBER',
            joinedAt: '2026-04-15T00:00:00.000Z',
          },
        ],
      },
    });
    listContestsMock.mockResolvedValue({
      data: {
        contests: [],
      },
    });
    listSquadOwnerInvitationsMock.mockResolvedValue({
      data: {
        invitations: [],
      },
    });

    renderMyTeamPage();

    await screen.findByTestId('my-team-current-icon-label');
    fireEvent.click(screen.getByTestId('my-team-change-icon'));

    expect(await screen.findByTestId('my-team-icon-modal')).toHaveClass(
      'max-h-[calc(100vh-2rem)]',
      'max-w-3xl',
      'overflow-y-auto',
    );
    expect(screen.getByTestId('my-team-icon-palette')).toHaveClass(
      'max-h-80',
      'overflow-y-auto',
      'sm:grid-cols-4',
    );
  });

  it('pool-master-rop.22: creates, replaces, removes, and revokes owner invites for an existing team', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: true,
          isRootAdmin: false,
          createdAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });
    refreshTokenMock.mockResolvedValue({ data: null });
    getLeagueByCodeMock.mockResolvedValue({
      data: {
        league: buildLeagueDetail('MEMBER'),
      },
    });
    listLeagueSquadsMock.mockResolvedValue({
      data: {
        squads: [
          buildTeamSummary({
            name: 'Original Team',
            memberCount: 2,
            teamRelationship: {
              leagueMember: true,
              owner: true,
              commissioner: true,
            },
            members: [
              {
                id: 'membership-1',
                squadId: 'team-1',
                leagueId: 'league-1',
                userId: 'user-1',
                firstName: 'Derek',
                lastName: 'Dorazio',
                status: 'ACTIVE',
                joinedAt: '2026-04-15T00:00:00.000Z',
                createdAt: '2026-04-15T00:00:00.000Z',
                updatedAt: '2026-04-15T00:00:00.000Z',
              },
              {
                id: 'membership-2',
                squadId: 'team-1',
                leagueId: 'league-1',
                userId: 'user-2',
                firstName: 'Brendan',
                lastName: 'Haley',
                status: 'ACTIVE',
                joinedAt: '2026-04-15T00:00:00.000Z',
                createdAt: '2026-04-15T00:00:00.000Z',
                updatedAt: '2026-04-15T00:00:00.000Z',
              },
            ],
          }),
        ],
      },
    });
    listLeagueMembersMock.mockResolvedValue({
      data: {
        members: [
          {
            id: 'league-member-1',
            userId: 'user-1',
            email: 'derek@example.com',
            firstName: 'Derek',
            lastName: 'Dorazio',
            role: 'COMMISSIONER',
            joinedAt: '2026-04-15T00:00:00.000Z',
          },
          {
            id: 'league-member-2',
            userId: 'user-2',
            email: 'brendan@example.com',
            firstName: 'Brendan',
            lastName: 'Haley',
            role: 'MEMBER',
            joinedAt: '2026-04-15T00:00:00.000Z',
          },
        ],
      },
    });
    listContestsMock.mockResolvedValue({
      data: {
        contests: [],
      },
    });
    listSquadOwnerInvitationsMock.mockResolvedValue({
      data: {
        invitations: [
          {
            id: 'invite-1',
            leagueId: 'league-1',
            squadId: 'team-1',
            email: 'pending@example.com',
            inviteCode: 'TEAM123',
            status: 'PENDING',
            invitedBy: 'user-1',
            createdAt: '2026-04-15T00:00:00.000Z',
            updatedAt: '2026-04-15T00:00:00.000Z',
            team: {
              id: 'team-1',
              name: 'Original Team',
              iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
            },
          },
        ],
      },
    });
    createSquadOwnerInvitationMock.mockResolvedValue({
      data: {
        invitation: {
          id: 'invite-2',
          leagueId: 'league-1',
          squadId: 'team-1',
          email: 'owner@example.com',
          inviteCode: 'TEAM124',
          status: 'PENDING',
          invitedBy: 'user-1',
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-15T00:00:00.000Z',
          team: {
            id: 'team-1',
            name: 'Original Team',
            iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
          },
        },
      },
    });
    replaceSquadOwnerMock.mockResolvedValue({
      data: {
        invitation: {
          id: 'invite-3',
          leagueId: 'league-1',
          squadId: 'team-1',
          email: 'replacement@example.com',
          inviteCode: 'TEAM125',
          status: 'PENDING',
          invitedBy: 'user-1',
          replacementForUserId: 'user-2',
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-15T00:00:00.000Z',
          team: {
            id: 'team-1',
            name: 'Original Team',
            iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
          },
        },
      },
    });
    removeSquadOwnerMock.mockResolvedValue({
      data: {
        membership: {
          id: 'membership-2',
          squadId: 'team-1',
          leagueId: 'league-1',
          userId: 'user-2',
          status: 'INACTIVE',
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });
    revokeSquadOwnerInvitationMock.mockResolvedValue({
      data: {
        invitation: {
          id: 'invite-1',
          leagueId: 'league-1',
          squadId: 'team-1',
          email: 'pending@example.com',
          inviteCode: 'TEAM123',
          status: 'REVOKED',
          invitedBy: 'user-1',
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-15T00:00:00.000Z',
          team: {
            id: 'team-1',
            name: 'Original Team',
            iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
          },
        },
      },
    });

    renderMyTeamPage();

    fireEvent.click(await screen.findByTestId('my-team-open-owners'));
    await screen.findByTestId('my-team-owners-modal');
    expect(screen.getByTestId('my-team-member-link-user-2')).toHaveAttribute('href', '/users/user-2');

    fireEvent.change(screen.getByTestId('my-team-owner-email'), {
      target: { value: 'owner@example.com' },
    });
    fireEvent.click(screen.getByTestId('my-team-owner-invite'));

    await waitFor(() =>
      expect(createSquadOwnerInvitationMock).toHaveBeenCalledWith({
        path: { id: 'league-1', squadId: 'team-1' },
        body: { email: 'owner@example.com' },
      }),
    );

    fireEvent.click(screen.getByTestId('my-team-open-replace-user-2'));
    fireEvent.change(screen.getByTestId('my-team-replace-email'), {
      target: { value: 'replacement@example.com' },
    });
    fireEvent.click(screen.getByTestId('my-team-replace-submit'));

    await waitFor(() =>
      expect(replaceSquadOwnerMock).toHaveBeenCalledWith({
        path: { id: 'league-1', squadId: 'team-1', userId: 'user-2' },
        body: { email: 'replacement@example.com' },
      }),
    );

    fireEvent.click(screen.getByTestId('team-home-owner-actions-trigger-team-1-user-2'));
    fireEvent.click(screen.getByTestId('team-home-owner-actions-remove-team-1-user-2'));
    await screen.findByTestId('team-home-owner-actions-dialog-team-1-user-2');
    fireEvent.click(screen.getByTestId('team-home-owner-actions-confirm-remove-team-1-user-2'));

    await waitFor(() =>
      expect(removeSquadOwnerMock).toHaveBeenCalledWith({
        path: { id: 'league-1', squadId: 'team-1', userId: 'user-2' },
      }),
    );

    fireEvent.click(screen.getByTestId('my-team-revoke-owner-invitation-invite-1'));

    await waitFor(() =>
      expect(revokeSquadOwnerInvitationMock).toHaveBeenCalledWith({
        path: { id: 'league-1', invitationId: 'invite-1' },
      }),
    );
  });

  it('pool-master-rop.22: inactivates the current team', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: true,
          isRootAdmin: false,
          createdAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });
    refreshTokenMock.mockResolvedValue({ data: null });
    getLeagueByCodeMock.mockResolvedValue({
      data: {
        league: buildLeagueDetail('MEMBER'),
      },
    });
    listLeagueSquadsMock.mockResolvedValue({
      data: {
        squads: [
          buildTeamSummary({
            name: 'Original Team',
          }),
        ],
      },
    });
    listLeagueMembersMock.mockResolvedValue({
      data: {
        members: [
          {
            id: 'league-member-1',
            userId: 'user-1',
            email: 'derek@example.com',
            firstName: 'Derek',
            lastName: 'Dorazio',
            role: 'MEMBER',
            joinedAt: '2026-04-15T00:00:00.000Z',
          },
        ],
      },
    });
    listContestsMock.mockResolvedValue({
      data: {
        contests: [],
      },
    });
    listSquadOwnerInvitationsMock.mockResolvedValue({
      data: {
        invitations: [],
      },
    });
    inactivateLeagueSquadMock.mockResolvedValue({
      data: {
        squad: buildTeamSummary({
          name: 'Original Team',
          isActive: false,
          memberCount: 0,
          members: [],
        }),
      },
    });

    renderMyTeamPage();

    fireEvent.click(await screen.findByTestId('my-team-inactivate'));
    expect(await screen.findByTestId('my-team-inactivate-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('my-team-confirm-inactivate'));

    await waitFor(() =>
      expect(inactivateLeagueSquadMock).toHaveBeenCalledWith({
        path: { id: 'league-1', squadId: 'team-1' },
      }),
    );
  });

  // pool-master-dxd.32 — inactive teams should show their lifecycle and advance
  // to the delete workflow instead of offering another inactivation.
  it('shows inactive lifecycle and deletes an inactive team from Team Home', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'root@example.com',
          firstName: 'Root',
          lastName: 'Admin',
          isActive: true,
          isRootAdmin: true,
          createdAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });
    refreshTokenMock.mockResolvedValue({ data: null });
    getLeagueByCodeMock.mockResolvedValue({
      data: {
        league: buildLeagueDetail('MEMBER', true),
      },
    });
    listLeagueSquadsMock.mockResolvedValue({
      data: {
        squads: [
          buildTeamSummary({
            name: 'Inactive Team',
            isActive: false,
            memberCount: 0,
            members: [],
            isRootAdmin: true,
            teamRelationship: {
              leagueMember: false,
              owner: false,
              commissioner: false,
            },
          }),
        ],
      },
    });
    listLeagueMembersMock.mockResolvedValue({
      data: {
        members: [],
      },
    });
    listContestsMock.mockResolvedValue({
      data: {
        contests: [],
      },
    });
    listSquadOwnerInvitationsMock.mockResolvedValue({
      data: {
        invitations: [],
      },
    });
    deleteLeagueSquadMock.mockResolvedValue({
      data: {
        success: true,
      },
    });

    renderMyTeamPage('/league/BIGDAWGS/team?teamId=team-1');

    await screen.findByTestId('my-team-delete');
    expect(screen.getByTestId('my-team-lifecycle-status')).toHaveTextContent('Inactive');
    expect(screen.queryByTestId('my-team-inactivate')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('my-team-delete'));
    expect(await screen.findByTestId('my-team-delete-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('my-team-confirm-delete'));

    await waitFor(() =>
      expect(deleteLeagueSquadMock).toHaveBeenCalledWith({
        path: { id: 'league-1', squadId: 'team-1' },
      }),
    );
    expect(await screen.findByTestId('manage-teams-route-destination')).toBeInTheDocument();
  });

  it('pool-master-zi0 removes duplicate active entry management links from Team Details', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          firstName: 'Derek',
          lastName: 'Dorazio',
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
          ...buildLeagueDetail('MEMBER'),
          activeContestCount: 2,
        },
      },
    });
    listLeagueSquadsMock.mockResolvedValue({
      data: {
        squads: [
          buildTeamSummary({
            name: 'Original Team',
          }),
        ],
      },
    });
    listLeagueMembersMock.mockResolvedValue({
      data: {
        members: [
          {
            id: 'league-member-1',
            userId: 'user-1',
            email: 'derek@example.com',
            firstName: 'Derek',
            lastName: 'Dorazio',
            role: 'MEMBER',
            joinedAt: '2026-04-15T00:00:00.000Z',
          },
        ],
      },
    });
    listSquadOwnerInvitationsMock.mockResolvedValue({
      data: {
        invitations: [],
      },
    });
    renderMyTeamPage();

    await screen.findByTestId('my-team-page');
    expect(screen.queryByText('Active entry management')).not.toBeInTheDocument();
    expect(screen.queryByTestId('my-team-open-league-home')).not.toBeInTheDocument();
    expect(screen.queryByTestId('my-team-open-my-history')).not.toBeInTheDocument();
    expect(screen.queryByTestId('my-team-history-contest-contest-complete')).not.toBeInTheDocument();
  });

  it('pool-master-rop.22: lets a commissioner promote an owner from Team Home', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: true,
          isRootAdmin: false,
          createdAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });
    refreshTokenMock.mockResolvedValue({ data: null });
    getLeagueByCodeMock.mockResolvedValue({
      data: {
        league: buildLeagueDetail('COMMISSIONER'),
      },
    });
    listLeagueSquadsMock.mockResolvedValue({
      data: {
        squads: [
          buildTeamSummary({
            createdBy: 'user-2',
            name: 'Original Team',
            memberCount: 2,
            teamRelationship: {
              leagueMember: true,
              owner: true,
              commissioner: true,
            },
            members: [
              {
                id: 'membership-1',
                squadId: 'team-1',
                leagueId: 'league-1',
                userId: 'user-1',
                firstName: 'Derek',
                lastName: 'Dorazio',
                status: 'ACTIVE',
                joinedAt: '2026-04-15T00:00:00.000Z',
                createdAt: '2026-04-15T00:00:00.000Z',
                updatedAt: '2026-04-15T00:00:00.000Z',
              },
              {
                id: 'membership-2',
                squadId: 'team-1',
                leagueId: 'league-1',
                userId: 'user-2',
                firstName: 'Fran',
                lastName: 'Lane',
                status: 'ACTIVE',
                joinedAt: '2026-04-15T00:00:00.000Z',
                createdAt: '2026-04-15T00:00:00.000Z',
                updatedAt: '2026-04-15T00:00:00.000Z',
              },
            ],
          }),
        ],
      },
    });
    listLeagueMembersMock.mockResolvedValue({
      data: {
        members: [
          {
            id: 'league-member-1',
            userId: 'user-1',
            email: 'derek@example.com',
            firstName: 'Derek',
            lastName: 'Dorazio',
            role: 'COMMISSIONER',
            joinedAt: '2026-04-15T00:00:00.000Z',
          },
          {
            id: 'league-member-2',
            userId: 'user-2',
            email: 'fran@example.com',
            firstName: 'Fran',
            lastName: 'Lane',
            role: 'MEMBER',
            joinedAt: '2026-04-15T00:00:00.000Z',
          },
        ],
      },
    });
    listContestsMock.mockResolvedValue({ data: { contests: [] } });
    listSquadOwnerInvitationsMock.mockResolvedValue({ data: { invitations: [] } });
    changeMemberRoleMock.mockResolvedValue({
      data: {
        membership: {
          id: 'league-member-2',
          leagueId: 'league-1',
          userId: 'user-2',
          role: 'COMMISSIONER',
          status: 'ACTIVE',
          joinedAt: '2026-04-15T00:00:00.000Z',
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });

    renderMyTeamPage('/league/BIGDAWGS/team?teamId=team-1');

    fireEvent.click(await screen.findByTestId('my-team-open-owners'));
    await screen.findByTestId('my-team-owners-modal');
    fireEvent.click(screen.getByTestId('team-home-owner-actions-trigger-team-1-user-2'));
    fireEvent.click(screen.getByTestId('team-home-owner-actions-promote-team-1-user-2'));
    await screen.findByTestId('team-home-owner-actions-dialog-team-1-user-2');
    fireEvent.click(screen.getByTestId('team-home-owner-actions-confirm-promote-team-1-user-2'));

    await waitFor(() =>
      expect(changeMemberRoleMock).toHaveBeenCalledWith({
        path: { id: 'league-1', uid: 'user-2' },
        body: { role: 'COMMISSIONER' },
      }),
    );
  });
});
