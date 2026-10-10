import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TeamIconKey } from '@poolmaster/shared/domain';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { AuthProvider } from '@/features/auth/auth-provider';
import {
  apiSuccess,
  buildCurrentUser,
  buildLeague,
  buildLeagueMembership,
  buildLeagueSquad,
  buildLeagueSquadMember,
  getLeagueByCodeData,
  listLeagueSquadsData,
  updateLeagueSquadData,
} from '@/features/leagues/test/fixtures';
import type { LeagueDto, SquadDto } from '@/lib/api';
import { QueryKeys } from '@/lib/query-keys';
import { MyTeamEditPage } from './my-team-edit-page';
import { MyTeamPage } from './my-team-page';
import { TeamPage } from './team-page';

const createLeagueSquadMock = vi.fn();
const createSquadOwnerInvitationMock = vi.fn();
const getCurrentUserMock = vi.fn();
const getGolfContestLeaderboardMock = vi.fn();
const listContestEntriesMock = vi.fn();
const listContestsMock = vi.fn();
const getLeagueByCodeMock = vi.fn();
const listLeagueMembersMock = vi.fn();
const listLeagueSquadsMock = vi.fn();
const listSquadOwnerInvitationsMock = vi.fn();
const refreshTokenMock = vi.fn();
const replaceSquadOwnerMock = vi.fn();
const revokeSquadOwnerInvitationMock = vi.fn();
const updateLeagueSquadMock = vi.fn();

bindApiMocks({
  createLeagueSquad: createLeagueSquadMock,
  createSquadOwnerInvitation: createSquadOwnerInvitationMock,
  getUser: getCurrentUserMock,
  getGolfContestLeaderboard: getGolfContestLeaderboardMock,
  listContestEntries: listContestEntriesMock,
  listContests: listContestsMock,
  getLeagueByCode: getLeagueByCodeMock,
  listLeagueMembers: listLeagueMembersMock,
  listLeagueSquads: listLeagueSquadsMock,
  listSquadOwnerInvitations: listSquadOwnerInvitationsMock,
  refreshToken: refreshTokenMock,
  replaceSquadOwner: replaceSquadOwnerMock,
  revokeSquadOwnerInvitation: revokeSquadOwnerInvitationMock,
  updateLeagueSquad: updateLeagueSquadMock,
});

function renderTeamRoutes(path = '/league/BIGDAWGS/team') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<MyTeamPage />} path="/league/:leagueCode/team" />
            <Route element={<MyTeamEditPage />} path="/league/:leagueCode/team/edit" />
            <Route element={<TeamPage />} path="/league/:leagueCode/teams/:teamId" />
            <Route element={<div data-testid="league-home-destination" />} path="/league/:leagueCode" />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

const coOwner = buildLeagueSquadMember({
  id: 'team-membership-2',
  userId: 'user-2',
  user: buildCurrentUser({ id: 'user-2', firstName: 'Jordan', lastName: 'Rivers' }),
});

const rivalTeam = buildLeagueSquad({
  id: 'team-2',
  name: 'Rival Squad',
  members: [buildLeagueSquadMember({
    id: 'team-membership-3',
    squadId: 'team-2',
    userId: 'user-3',
    user: buildCurrentUser({ id: 'user-3', firstName: 'Riley', lastName: 'Rival' }),
  })],
});

const pendingOwnerInvite = {
  id: 'owner-invite-1',
  leagueId: 'league-1',
  squadId: 'team-1',
  email: 'pending@example.com',
  status: 'PENDING',
  replacementForUserId: null,
  invitedBy: 'user-1',
  inviteCode: 'owner-code-1',
  expiresAt: '2026-11-01T00:00:00.000Z',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

function primeTeam({
  isMember = true,
  isRootAdmin = false,
  league = {},
  role = 'MEMBER',
  squadId = 'team-1',
  squads = [buildLeagueSquad(), rivalTeam],
}: {
  isMember?: boolean;
  isRootAdmin?: boolean;
  league?: Partial<LeagueDto>;
  role?: 'COMMISSIONER' | 'MEMBER';
  squadId?: string | null;
  squads?: SquadDto[];
} = {}) {
  getCurrentUserMock.mockResolvedValue(apiSuccess({ user: buildCurrentUser({ isRootAdmin }) }));
  refreshTokenMock.mockResolvedValue({ data: null });
  const context = getLeagueByCodeData(buildLeague(league), {
    membership: buildLeagueMembership({ role }),
    squadMembership: squadId ? buildLeagueSquadMember({ squadId }) : null,
  });
  getLeagueByCodeMock.mockResolvedValue(apiSuccess(isMember ? context : { ...context, membership: null }));
  listLeagueSquadsMock.mockResolvedValue(apiSuccess(listLeagueSquadsData(squads)));
  listLeagueMembersMock.mockResolvedValue(apiSuccess({
    members: [
      buildLeagueMembership({ id: 'm-1', userId: 'user-1', role }),
      buildLeagueMembership({ id: 'm-3', userId: 'user-3', role: 'COMMISSIONER' }),
    ],
  }));
  listSquadOwnerInvitationsMock.mockResolvedValue(apiSuccess({ invitations: [] }));
  listContestsMock.mockResolvedValue(apiSuccess({ contests: [] }));
}

function contest(id: string, name: string, status: 'DRAFT' | 'OPEN' | 'ACTIVE' | 'COMPLETED') {
  return {
    id,
    name,
    status,
    contestFormat: 'ROSTER',
    selectionType: 'TIERED',
    scoringEngine: 'STROKE_PLAY',
    leagueId: 'league-1',
    sportEventId: `event-${id}`,
    sport: 'GOLF',
    entryCount: 4,
    isExclusive: false,
  };
}

function teamEntry(contestId: string, status: 'DRAFT' | 'SUBMITTED', squadId = 'team-1') {
  return {
    id: `${contestId}-${squadId}`,
    contestId,
    squadId,
    squadName: squadId,
    entryNumber: 1,
    name: `${squadId} entry`,
    status,
    picksCount: 6,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
  };
}

function primeContests(
  contests: ReturnType<typeof contest>[],
  entriesByContest: Record<string, ReturnType<typeof teamEntry>[]>,
) {
  listContestsMock.mockResolvedValue(apiSuccess({ contests }));
  listContestEntriesMock.mockImplementation(({ path }: { path: { contestId: string } }) => {
    const entries = entriesByContest[path.contestId] ?? [];
    return apiSuccess({
      contestId: path.contestId,
      total: entries.length,
      isJoined: false,
      myEntryId: null,
      myEntryIds: [],
      picksRevealed: false,
      entries,
    });
  });
}

afterEach(() => {
  for (const mock of [
    createLeagueSquadMock, createSquadOwnerInvitationMock, getCurrentUserMock, getLeagueByCodeMock,
    listLeagueMembersMock, listLeagueSquadsMock, listSquadOwnerInvitationsMock, refreshTokenMock,
    replaceSquadOwnerMock, revokeSquadOwnerInvitationMock, updateLeagueSquadMock,
    getGolfContestLeaderboardMock, listContestEntriesMock, listContestsMock,
  ]) {
    mock.mockReset();
  }
});

describe('My team', () => {
  it('shows the team with Edit team, Contest history, its owners and Leave league', async () => {
    primeTeam();

    renderTeamRoutes();

    const identity = await screen.findByTestId('my-team-identity');
    expect(identity).toHaveTextContent('Casey Crushers');
    expect(identity).toHaveTextContent('1 owner');
    expect(screen.getByTestId('my-team-edit')).toHaveAttribute('href', '/league/BIGDAWGS/team/edit');
    expect(screen.getByTestId('my-team-history-link')).toHaveAttribute('href', '/league/BIGDAWGS/history');
    expect(within(screen.getByTestId('my-team-owners')).getByText('Casey Commissioner')).toBeInTheDocument();
    expect(screen.getByTestId('leave-league-section')).toBeInTheDocument();
  });

  it('makes the team read-only while the league is inactive', async () => {
    primeTeam({ league: { isActive: false } });

    renderTeamRoutes();

    expect(await screen.findByTestId('my-team-league-inactive')).toBeInTheDocument();
    expect(screen.getByTestId('my-team-edit')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('textbox', { name: 'Co-owner email' })).toBeDisabled();
  });

  it('does not offer to create a team while the viewer\'s team is still loading', async () => {
    primeTeam();
    listLeagueSquadsMock.mockReturnValue(new Promise(() => undefined));

    renderTeamRoutes();

    expect(await screen.findByTestId('my-team-loading')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create team' })).not.toBeInTheDocument();
  });

  it('shows an error instead of Create team when the team list fails to load', async () => {
    primeTeam();
    listLeagueSquadsMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL_ERROR', message: 'Teams are unavailable right now.' } },
      status: 500,
    });

    renderTeamRoutes();

    expect(await screen.findByTestId('my-team-error')).toHaveTextContent('Teams are unavailable right now.');
    expect(screen.queryByRole('button', { name: 'Create team' })).not.toBeInTheDocument();
  });

  it('shows the load-error copy with a way back to welcome when the league cannot be loaded', async () => {
    primeTeam();
    getLeagueByCodeMock.mockResolvedValue({
      error: { error: { code: 'LEAGUE_NOT_FOUND', message: 'League not found.' } },
      status: 404,
    });

    renderTeamRoutes();

    expect(await screen.findByRole('link', { name: 'Back to welcome' })).toHaveAttribute('href', '/welcome');
  });
});

describe('My team › My entries', () => {
  it('offers Make your picks for an open contest the team has not entered, and Finish your picks for a draft', async () => {
    primeTeam();
    primeContests(
      [contest('c-open', 'Masters Pool', 'OPEN'), contest('c-draft', 'PGA Pool', 'OPEN')],
      { 'c-draft': [teamEntry('c-draft', 'DRAFT')] },
    );

    renderTeamRoutes();

    const open = await screen.findByTestId('my-team-entry-action-c-open');
    expect(open).toHaveTextContent('Make your picks');
    expect(open).toHaveAttribute('href', '/league/BIGDAWGS/contests/c-open');
    expect(await screen.findByText('Finish your picks')).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/contests/c-draft/entries/c-draft-team-1',
    );
  });

  it('shows the team\'s place in a live contest it entered, links to the leaderboard, and leaves out live contests it did not enter', async () => {
    primeTeam();
    primeContests(
      [contest('c-live', 'Masters Pool', 'ACTIVE'), contest('c-other', 'Other Pool', 'ACTIVE')],
      { 'c-live': [teamEntry('c-live', 'SUBMITTED')], 'c-other': [teamEntry('c-other', 'SUBMITTED', 'team-9')] },
    );
    getGolfContestLeaderboardMock.mockResolvedValue(apiSuccess({
      contestId: 'c-live',
      sportEventId: 'event-c-live',
      scoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
      countingRule: { type: 'BEST_N_GOLFERS', count: 4 },
      participants: [],
      entries: [
        { entryId: 'e-9', entryName: 'Leaders', entryNumber: 1, squadId: 'team-9', squadName: 'Leaders', status: 'SUBMITTED', position: 1, displayPosition: '1', countingPickLimit: 4, scoredPickCount: 0, golf: { totalScoreToPar: -8 }, picks: [] },
        { entryId: 'e-1', entryName: 'Mine', entryNumber: 1, squadId: 'team-1', squadName: 'Casey Crushers', status: 'SUBMITTED', position: 2, displayPosition: 'T2', countingPickLimit: 4, scoredPickCount: 0, golf: { totalScoreToPar: -3 }, picks: [] },
      ],
      asOf: '2026-04-11T18:00:00.000Z',
    }));

    renderTeamRoutes();

    await waitFor(() => expect(screen.getByTestId('my-team-entry-rank-c-live')).toHaveTextContent('Place T2'));
    expect(screen.getByTestId('my-team-entry-action-c-live')).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/contests/c-live/leaderboard',
    );
    expect(screen.queryByTestId('my-team-entry-c-other')).not.toBeInTheDocument();
  });

  it('says no contests are open or live when there are none, and leaves out drafts and finished ones', async () => {
    primeTeam();
    primeContests([contest('c-draft', 'Draft', 'DRAFT'), contest('c-done', 'Done', 'COMPLETED')], {});

    renderTeamRoutes();

    expect(await screen.findByTestId('my-team-entries-none')).toHaveTextContent('No contests are open or live right now.');
  });

  it('says the contests could not load rather than showing none', async () => {
    primeTeam();
    listContestsMock.mockResolvedValue({ error: { error: { code: 'INTERNAL', message: 'Down' } } });

    renderTeamRoutes();

    expect(await screen.findByTestId('my-team-entries-error')).toBeInTheDocument();
  });
});

describe('My team › Create team', () => {
  it('creates the team with the name and icon the member chose, in one request, then shows it', async () => {
    primeTeam({ role: 'COMMISSIONER', squadId: null, squads: [] });
    createLeagueSquadMock.mockImplementation(() => {
      // Once the team exists, the league context names it as the viewer's own.
      primeTeam({ role: 'COMMISSIONER', squads: [buildLeagueSquad({ name: 'Ocean Winkers' })] });
      return Promise.resolve(apiSuccess(updateLeagueSquadData(buildLeagueSquad({ name: 'Ocean Winkers' }))));
    });

    renderTeamRoutes();

    const name = await screen.findByTestId('create-team-name');
    expect(name).toHaveValue("Casey Commissioner's Team");
    fireEvent.change(name, { target: { value: 'Ocean Winkers' } });
    fireEvent.click(screen.getByTestId(`team-icon-${TeamIconKey.CAPTAIN_WINK_OCEAN}`));
    fireEvent.click(screen.getByRole('button', { name: 'Create team' }));

    await waitFor(() => expect(createLeagueSquadMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 'league-1' },
      body: { name: 'Ocean Winkers', iconKey: TeamIconKey.CAPTAIN_WINK_OCEAN },
    })));
    expect(await screen.findByTestId('my-team-identity')).toHaveTextContent('Ocean Winkers');
  });

  it('shows the reason and keeps the typed name when creating the team fails', async () => {
    primeTeam({ squadId: null, squads: [] });
    createLeagueSquadMock.mockResolvedValue({
      error: { error: { code: 'SQUAD_NAME_TAKEN', message: 'Team name is already taken.' } },
    });

    renderTeamRoutes();

    fireEvent.change(await screen.findByTestId('create-team-name'), { target: { value: 'Derek Squad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create team' }));

    expect(await screen.findByText('Team name is already taken.')).toBeInTheDocument();
    expect(screen.getByTestId('create-team-name')).toHaveValue('Derek Squad');
  });

  it('says why Create team is unavailable while the league is inactive', async () => {
    primeTeam({ league: { isActive: false }, squadId: null, squads: [] });

    renderTeamRoutes();

    expect(await screen.findByTestId('my-team-league-inactive')).toHaveTextContent('you can\'t create a team');
    expect(screen.getByTestId('create-team-save')).toBeDisabled();
  });

  it('tells a root admin who is not a member that they have no team here, with no Create team', async () => {
    primeTeam({ isMember: false, isRootAdmin: true, squadId: null });

    renderTeamRoutes();

    expect(await screen.findByTestId('my-team-none')).toHaveTextContent("You don't have a team in this league");
    expect(screen.queryByRole('button', { name: 'Create team' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('leave-league-section')).not.toBeInTheDocument();
  });
});

describe('My team › Owners', () => {
  it('invites a co-owner by email, confirms it, and clears the field', async () => {
    primeTeam();
    createSquadOwnerInvitationMock.mockResolvedValue(apiSuccess({ invitation: { ...pendingOwnerInvite, email: 'friend@example.com' } }));

    renderTeamRoutes();

    const emailField = await screen.findByRole('textbox', { name: 'Co-owner email' });
    fireEvent.change(emailField, { target: { value: ' friend@example.com ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));

    expect(await screen.findByText('Co-owner invite created.')).toBeInTheDocument();
    expect(createSquadOwnerInvitationMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 'league-1', squadId: 'team-1' },
      body: { email: 'friend@example.com' },
    }));
    expect(emailField).toHaveValue('');
  });

  it('shows the reason and keeps the email when a co-owner invite is rejected', async () => {
    primeTeam();
    createSquadOwnerInvitationMock.mockResolvedValue({
      error: { error: { code: 'SQUAD_OWNER_INVITATION_MEMBER_EXISTS', message: 'That person already belongs to this league.' } },
    });

    renderTeamRoutes();

    fireEvent.change(await screen.findByRole('textbox', { name: 'Co-owner email' }), { target: { value: 'member@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));

    expect(await screen.findByText('That person already belongs to this league.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Co-owner email' })).toHaveValue('member@example.com');
  });

  it('replaces another owner with an invitation to the replacement email, but never offers to replace the viewer', async () => {
    primeTeam({ squads: [buildLeagueSquad({ members: [buildLeagueSquadMember(), coOwner], memberCount: 2 })] });
    replaceSquadOwnerMock.mockResolvedValue(apiSuccess({
      invitation: { ...pendingOwnerInvite, email: 'new@example.com', replacementForUserId: 'user-2' },
    }));

    renderTeamRoutes();

    await screen.findByTestId('my-team-owners');
    expect(screen.getAllByRole('button', { name: 'Replace owner' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Replace owner' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Replacement owner email' }), { target: { value: 'new@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));

    await waitFor(() => expect(replaceSquadOwnerMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 'league-1', squadId: 'team-1', userId: 'user-2' },
      body: { email: 'new@example.com' },
    })));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Replacement owner email' })).not.toBeInTheDocument());
  });

  it('shows a failed replacement\'s reason and keeps the Replace owner form open with the email', async () => {
    primeTeam({ squads: [buildLeagueSquad({ members: [buildLeagueSquadMember(), coOwner], memberCount: 2 })] });
    replaceSquadOwnerMock.mockResolvedValue({
      error: { error: { code: 'SQUAD_OWNER_EMAIL_IN_LEAGUE', message: 'That person is already in this league.' } },
    });

    renderTeamRoutes();

    fireEvent.click(await screen.findByRole('button', { name: 'Replace owner' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Replacement owner email' }), { target: { value: 'taken@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));

    expect(await screen.findByText('That person is already in this league.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Replacement owner email' })).toHaveValue('taken@example.com');
  });

  it('names each owner without their account id and words pending invites as Pending and Replacement invite', async () => {
    primeTeam();
    listSquadOwnerInvitationsMock.mockResolvedValue(apiSuccess({
      invitations: [{ ...pendingOwnerInvite, replacementForUserId: 'user-2' }],
    }));

    renderTeamRoutes();

    const invite = await screen.findByTestId('my-team-owner-invitation-owner-invite-1');
    expect(invite).toHaveTextContent('Pending · Replacement invite');
    expect(invite).not.toHaveTextContent('PENDING');
    expect(screen.getByTestId('my-team-member-user-1')).not.toHaveTextContent('user-1');
  });

  it('shows the reason when revoking a pending owner invite fails', async () => {
    primeTeam();
    listSquadOwnerInvitationsMock.mockResolvedValue(apiSuccess({ invitations: [pendingOwnerInvite] }));
    revokeSquadOwnerInvitationMock.mockResolvedValue({
      error: { error: { code: 'SQUAD_OWNER_INVITATION_NOT_PENDING', message: 'That invite was already accepted.' } },
    });

    renderTeamRoutes();

    expect(await screen.findByText('pending@example.com')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));

    expect(await screen.findByText('That invite was already accepted.')).toBeInTheDocument();
    expect(revokeSquadOwnerInvitationMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 'league-1', invitationId: 'owner-invite-1' },
    }));
  });

  it('warns that pending owner invitations could not be loaded rather than showing none', async () => {
    primeTeam();
    listSquadOwnerInvitationsMock.mockRejectedValue(new Error('Invitations unavailable'));

    renderTeamRoutes();

    expect(await screen.findByTestId('my-team-owners-invitations-error'))
      .toHaveTextContent('Owner invitations are temporarily unavailable');
  });
});

describe('My team › Edit team', () => {
  it('saves the name and icon in one request and returns to My team', async () => {
    primeTeam();
    updateLeagueSquadMock.mockResolvedValue(apiSuccess(updateLeagueSquadData(buildLeagueSquad({ name: 'Renamed' }))));

    renderTeamRoutes('/league/BIGDAWGS/team/edit');

    expect(await screen.findByTestId('edit-team-name')).toHaveValue('Casey Crushers');
    fireEvent.change(screen.getByTestId('edit-team-name'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByTestId(`team-icon-${TeamIconKey.HELMET_BOLT_MIDNIGHT}`));
    fireEvent.click(screen.getByTestId('edit-team-save'));

    expect(await screen.findByTestId('my-team-page')).toBeInTheDocument();
    expect(updateLeagueSquadMock).toHaveBeenCalledTimes(1);
    expect(updateLeagueSquadMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 'league-1', squadId: 'team-1' },
      body: { name: 'Renamed', iconKey: TeamIconKey.HELMET_BOLT_MIDNIGHT },
    }));
  });

  it('shows the reason and keeps the typed name and chosen icon when saving is rejected', async () => {
    primeTeam();
    updateLeagueSquadMock.mockResolvedValue({
      error: { error: { code: 'SQUAD_NAME_TAKEN', message: 'Another team in this league already uses that name.' } },
    });

    renderTeamRoutes('/league/BIGDAWGS/team/edit');

    fireEvent.change(await screen.findByTestId('edit-team-name'), { target: { value: 'Rival Squad' } });
    fireEvent.click(screen.getByTestId(`team-icon-${TeamIconKey.HELMET_BOLT_MIDNIGHT}`));
    fireEvent.click(screen.getByTestId('edit-team-save'));

    expect(await screen.findByText('Another team in this league already uses that name.')).toBeInTheDocument();
    expect(screen.getByTestId('edit-team-name')).toHaveValue('Rival Squad');
    expect(screen.getByTestId(`team-icon-${TeamIconKey.HELMET_BOLT_MIDNIGHT}`)).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps an unsaved name when the team list refetches with new server data', async () => {
    primeTeam();
    const { queryClient } = renderTeamRoutes('/league/BIGDAWGS/team/edit');

    fireEvent.change(await screen.findByTestId('edit-team-name'), { target: { value: 'My draft name' } });
    listLeagueSquadsMock.mockResolvedValue(apiSuccess(listLeagueSquadsData([
      buildLeagueSquad({ name: 'Renamed elsewhere' }),
      rivalTeam,
    ])));
    await queryClient.refetchQueries({ queryKey: QueryKeys.leagueTeams.byLeague('league-1') });

    await waitFor(() => expect(listLeagueSquadsMock).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('edit-team-name')).toHaveValue('My draft name');
  });

  it('sends the edit link back to My team while the league is inactive', async () => {
    primeTeam({ league: { isActive: false } });

    renderTeamRoutes('/league/BIGDAWGS/team/edit');

    expect(await screen.findByTestId('my-team-league-inactive')).toBeInTheDocument();
    expect(screen.queryByTestId('edit-team-page')).not.toBeInTheDocument();
  });

  it('sends the edit link back to My team when the viewer has no team yet', async () => {
    primeTeam({ squadId: null, squads: [] });

    renderTeamRoutes('/league/BIGDAWGS/team/edit');

    expect(await screen.findByTestId('create-team-page')).toBeInTheDocument();
  });
});

describe('Another team\'s page', () => {
  it('shows a member the team and its owners read-only, with no Manage team', async () => {
    primeTeam();

    renderTeamRoutes('/league/BIGDAWGS/teams/team-2');

    expect(await screen.findByTestId('team-page-identity')).toHaveTextContent('Rival Squad');
    const owners = within(screen.getByTestId('team-page-owners'));
    expect(owners.getByRole('link', { name: 'Riley Rival' })).toHaveAttribute('href', '/users/user-3');
    expect(await owners.findByText('Commissioner')).toBeInTheDocument();
    expect(screen.queryByTestId('team-page-manage')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('gives a commissioner a Manage team link into Commissioner tools', async () => {
    primeTeam({ role: 'COMMISSIONER' });

    renderTeamRoutes('/league/BIGDAWGS/teams/team-2');

    expect(await screen.findByTestId('team-page-manage')).toHaveAttribute('href', '/league/BIGDAWGS/admin/teams/team-2');
  });

  it('opens My team when the link is to the viewer\'s own team', async () => {
    primeTeam();

    renderTeamRoutes('/league/BIGDAWGS/teams/team-1');

    expect(await screen.findByTestId('my-team-identity')).toHaveTextContent('Casey Crushers');
  });

  it('says the team is not in this league when it does not exist', async () => {
    primeTeam();

    renderTeamRoutes('/league/BIGDAWGS/teams/missing-team');

    const notFound = await screen.findByTestId('team-page-not-found');
    expect(within(notFound).getByRole('link', { name: 'All teams' })).toHaveAttribute('href', '/league/BIGDAWGS/teams');
  });
});
