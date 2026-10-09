import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TeamIconKey } from '@poolmaster/shared/domain';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { AuthProvider } from '@/features/auth/auth-provider';
import { parseRouteState } from '@/routes/route-state';
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
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

bindApiMocks({
  acceptInvitation: acceptInvitationMock,
  getUser: getCurrentUserMock,
  getInvitationPreview: getInvitationPreviewMock,
  listLeagueSquads: listLeagueSquadsMock,
  logoutUser: logoutUserMock,
  refreshToken: refreshTokenMock,
  updateLeagueSquad: updateLeagueSquadMock,
});

/** Stands in for League Home and shows whether the join page asked it to report a failed team setup. */
function LeagueDestination() {
  const { teamSetupFailed = false } = parseRouteState(useLocation().state);
  return <div data-team-setup-failed={String(teamSetupFailed)} data-testid="league-destination" />;
}

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
            <Route element={<LeagueDestination />} path="/league/:leagueCode" />
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
            user: buildCurrentUser({ firstName: 'Derek', lastName: 'Dorazio' }),
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
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Vitest asymmetric-matcher sentinel, typed any by design.
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
        error: {
          code: 'INVITATION_ALREADY_ACCEPTED',
          message: 'This invitation has already been accepted.',
        },
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

describe('Joining a league from an invite link', () => {
  afterEach(() => {
    for (const mock of [
      acceptInvitationMock, getCurrentUserMock, getInvitationPreviewMock, listLeagueSquadsMock,
      logoutUserMock, refreshTokenMock, updateLeagueSquadMock,
    ]) {
      mock.mockReset();
    }
  });

  function signIn() {
    getCurrentUserMock.mockResolvedValue(apiSuccess({
      user: buildCurrentUser({ firstName: 'Derek', lastName: 'Dorazio' }),
    }));
    refreshTokenMock.mockResolvedValue({ data: null });
  }

  function viewersNewTeam(overrides: Parameters<typeof buildLeagueSquad>[0] = {}) {
    return buildLeagueSquad({
      name: "Derek Dorazio's Team",
      iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
      members: [buildLeagueSquadMember()],
      ...overrides,
    });
  }

  it('asks a signed-out visitor to sign in or create an account, returning them to this invite, with no join button', async () => {
    getCurrentUserMock.mockResolvedValue({ error: { error: { code: 'AUTH_SESSION_REQUIRED', message: 'Sign in.' } } });
    refreshTokenMock.mockResolvedValue({ error: { error: { code: 'AUTH_SESSION_REQUIRED', message: 'Sign in.' } } });
    getInvitationPreviewMock.mockResolvedValue(apiSuccess(getInvitationPreviewData(buildInvitationPreview())));

    renderJoinLeaguePage();

    expect(await screen.findByRole('heading', { name: 'Join Big Dawgs' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in to continue' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Create account' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Join league' })).not.toBeInTheDocument();
  });

  it('says the invitation could not be loaded and offers no join button when the preview fails', async () => {
    signIn();
    getInvitationPreviewMock.mockResolvedValue({ error: { error: { code: 'INVITATION_NOT_FOUND', message: 'Not found.' } }, status: 404 });

    renderJoinLeaguePage();

    expect(await screen.findByText('We could not load this invitation.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Join league' })).not.toBeInTheDocument();
  });

  it.each([
    ['EXPIRED', 'This invitation has expired. Ask the commissioner for a new one.'],
    ['REVOKED', 'This invitation was withdrawn. Ask the commissioner for a new one.'],
    ['ACCEPTED', 'This invitation has already been used.'],
  ] as const)('explains a %s invitation cannot be used and offers no join button', async (status, message) => {
    signIn();
    getInvitationPreviewMock.mockResolvedValue(apiSuccess(getInvitationPreviewData(buildInvitationPreview({ status }))));

    renderJoinLeaguePage();

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Join league' })).not.toBeInTheDocument();
    expect(acceptInvitationMock).not.toHaveBeenCalled();
  });

  it('will not join with a blank team name', async () => {
    signIn();
    getInvitationPreviewMock.mockResolvedValue(apiSuccess(getInvitationPreviewData(buildInvitationPreview())));

    renderJoinLeaguePage();

    const joinButton = await screen.findByRole('button', { name: 'Join league' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Team name' }), { target: { value: '   ' } });
    expect(joinButton).toBeDisabled();
  });

  it('joins without renaming the new team when the viewer keeps its default name and icon', async () => {
    signIn();
    getInvitationPreviewMock.mockResolvedValue(apiSuccess(getInvitationPreviewData(buildInvitationPreview())));
    acceptInvitationMock.mockResolvedValue(apiSuccess(acceptInvitationData(buildAcceptedLeagueMembership())));
    listLeagueSquadsMock.mockResolvedValue(apiSuccess(listLeagueSquadsData([viewersNewTeam()])));

    renderJoinLeaguePage();

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Team name' })).toHaveValue("Derek Dorazio's Team"));
    fireEvent.click(screen.getByRole('button', { name: 'Join league' }));

    expect(await screen.findByTestId('league-destination')).toBeInTheDocument();
    expect(acceptInvitationMock).toHaveBeenCalledWith({ body: { inviteCode: 'LEAGUE123' } });
    expect(updateLeagueSquadMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('league-destination')).toHaveAttribute('data-team-setup-failed', 'false');
  });

  it('still takes the viewer into the league they joined when saving their chosen team name fails afterwards', async () => {
    signIn();
    getInvitationPreviewMock.mockResolvedValue(apiSuccess(getInvitationPreviewData(buildInvitationPreview())));
    acceptInvitationMock.mockResolvedValue(apiSuccess(acceptInvitationData(buildAcceptedLeagueMembership())));
    listLeagueSquadsMock.mockResolvedValue(apiSuccess(listLeagueSquadsData([viewersNewTeam()])));
    updateLeagueSquadMock.mockResolvedValue({
      error: { error: { code: 'SQUAD_NAME_TAKEN', message: 'That team name is already taken in this league.' } },
    });

    renderJoinLeaguePage();

    fireEvent.change(await screen.findByRole('textbox', { name: 'Team name' }), { target: { value: 'Taken Name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join league' }));

    expect(await screen.findByTestId('league-destination')).toBeInTheDocument();
    expect(acceptInvitationMock).toHaveBeenCalledTimes(1);
  });

  it('tells League Home the chosen team name and icon did not save, so it can say so', async () => {
    signIn();
    getInvitationPreviewMock.mockResolvedValue(apiSuccess(getInvitationPreviewData(buildInvitationPreview())));
    acceptInvitationMock.mockResolvedValue(apiSuccess(acceptInvitationData(buildAcceptedLeagueMembership())));
    listLeagueSquadsMock.mockResolvedValue(apiSuccess(listLeagueSquadsData([viewersNewTeam()])));
    updateLeagueSquadMock.mockResolvedValue({
      error: { code: 'SQUAD_NAME_TAKEN', message: 'That team name is already taken in this league.' },
    });

    renderJoinLeaguePage();

    fireEvent.change(await screen.findByRole('textbox', { name: 'Team name' }), { target: { value: 'Taken Name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join league' }));

    expect(await screen.findByTestId('league-destination')).toHaveAttribute('data-team-setup-failed', 'true');
  });

  it('tells League Home the chosen team name and icon did not save when the new team cannot be looked up', async () => {
    signIn();
    getInvitationPreviewMock.mockResolvedValue(apiSuccess(getInvitationPreviewData(buildInvitationPreview())));
    acceptInvitationMock.mockResolvedValue(apiSuccess(acceptInvitationData(buildAcceptedLeagueMembership())));
    listLeagueSquadsMock.mockResolvedValue({ error: { code: 'INTERNAL_ERROR', message: 'Try again.' }, status: 500 });

    renderJoinLeaguePage();

    fireEvent.change(await screen.findByRole('textbox', { name: 'Team name' }), { target: { value: 'Fresh Name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join league' }));

    expect(await screen.findByTestId('league-destination')).toHaveAttribute('data-team-setup-failed', 'true');
    expect(updateLeagueSquadMock).not.toHaveBeenCalled();
  });

  it('tells League Home the chosen team name and icon did not save when the viewer\'s new team is not in the league list', async () => {
    signIn();
    getInvitationPreviewMock.mockResolvedValue(apiSuccess(getInvitationPreviewData(buildInvitationPreview())));
    acceptInvitationMock.mockResolvedValue(apiSuccess(acceptInvitationData(buildAcceptedLeagueMembership())));
    listLeagueSquadsMock.mockResolvedValue(apiSuccess(listLeagueSquadsData([])));

    renderJoinLeaguePage();

    fireEvent.change(await screen.findByRole('textbox', { name: 'Team name' }), { target: { value: 'Fresh Name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join league' }));

    expect(await screen.findByTestId('league-destination')).toHaveAttribute('data-team-setup-failed', 'true');
  });

  it('does not report a failed team setup when the chosen team name and icon save', async () => {
    signIn();
    getInvitationPreviewMock.mockResolvedValue(apiSuccess(getInvitationPreviewData(buildInvitationPreview())));
    acceptInvitationMock.mockResolvedValue(apiSuccess(acceptInvitationData(buildAcceptedLeagueMembership())));
    const team = viewersNewTeam();
    listLeagueSquadsMock.mockResolvedValue(apiSuccess(listLeagueSquadsData([team])));
    updateLeagueSquadMock.mockResolvedValue(apiSuccess(updateLeagueSquadData({ ...team, name: 'Fresh Name' })));

    renderJoinLeaguePage();

    fireEvent.change(await screen.findByRole('textbox', { name: 'Team name' }), { target: { value: 'Fresh Name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join league' }));

    expect(await screen.findByTestId('league-destination')).toHaveAttribute('data-team-setup-failed', 'false');
    expect(updateLeagueSquadMock).toHaveBeenCalledTimes(1);
  });
});
