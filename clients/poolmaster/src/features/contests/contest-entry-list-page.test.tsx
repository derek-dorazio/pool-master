import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { buildPlanEntitlements } from '@/features/plans/test/fixtures';
import { ContestEntryListPage } from './contest-entry-list-page';
import { NFL_TEAMS, pickEmEventFieldFixture, pickEmWeekFixture, survivorWeekFixture, week1Games, week2EventGamesFixture, weekPick } from './test/pick-em-fixtures';
import { squaresBoardFixture } from './test/squares-fixtures';

const {
  enterContestMock,
  getContestMock,
  getEventMock,
  getEventBracketMock,
  getGamePicksMock,
  listContestEntriesMock,
  getLeagueMock,
  getSquaresBoardMock,
  listEventParticipantsMock,
  listEventTiersMock,
  mockLogger,
  updateContestEntryMock,
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
    enterContestMock: vi.fn(),
    getContestMock: vi.fn(),
    getEventMock: vi.fn(),
    getEventBracketMock: vi.fn(),
    getGamePicksMock: vi.fn(),
    getLeagueMock: vi.fn(),
    getSquaresBoardMock: vi.fn(),
    listContestEntriesMock: vi.fn(),
    listEventParticipantsMock: vi.fn(),
    listEventTiersMock: vi.fn(),
    mockLogger: logger,
    updateContestEntryMock: vi.fn(),
  };
});

bindApiMocks({
  enterContest: enterContestMock,
  getContest: getContestMock,
  getEvent: getEventMock,
  // #1751 — the viewer's pick'em entry opens to the week's games and its picks on them.
  getEventBracket: getEventBracketMock,
  getGamePicks: getGamePicksMock,
  // #202 — the contest board reads the league BY ID for the viewer's own squad membership. It
  // used to list every squad in the league and scan each one's members for the signed-in user.
  getLeague: getLeagueMock,
  // #1758 — a squares contest's page is its board, read whole.
  getSquaresBoard: getSquaresBoardMock,
  listContestEntries: listContestEntriesMock,
  // #1740 — a lineup pick's tier or price is its field row's: the event's field and tiers.
  listEventParticipants: listEventParticipantsMock,
  listEventTiers: listEventTiersMock,
  updateContestEntry: updateContestEntryMock,
});

const VIEWER_USER = {
  id: 'user-1',
  email: 'member@example.com',
  username: 'member@example.com',
  firstName: 'Morgan',
  lastName: 'Member',
  isActive: true,
  isRootAdmin: false,
  createdAt: '2026-04-15T00:00:00.000Z',
} as const;

vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    isRootAdmin: false,
    user: {
      id: 'user-1',
      email: 'member@example.com',
      username: 'member@example.com',
      firstName: 'Morgan',
      lastName: 'Member',
      isActive: true,
      isRootAdmin: false,
      createdAt: '2026-04-15T00:00:00.000Z',
    },
    clearSession: vi.fn(),
  }),
}));

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

/** The page's address and how it last moved, so a test can tell a replace from a push. */
function AddressProbe() {
  const location = useLocation();
  return <div data-testid="address">{`${location.search}|${useNavigationType()}`}</div>;
}

function renderContestBoard(search = '') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[{ pathname: '/league/BIGDAWGS/contests/contest-1', search }]}
      >
        <Routes>
          <Route element={<><ContestEntryListPage /><AddressProbe /></>} path="/league/:leagueCode/contests/:contestId" />
          <Route
            element={<div data-testid="contest-entry-page" />}
            path="/league/:leagueCode/contests/:contestId/entries/:entryId"
          />
          <Route element={<div data-testid="league-page" />} path="/league/:leagueCode" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function buildEntry(overrides: Partial<{
  id: string;
  squadId: string;
  squadName: string;
  name: string;
  entryNumber: number;
  picksCount: number;
  status: 'DRAFT' | 'SUBMITTED';
  participants: Array<{
    pickId: string;
    sportEventParticipantId: string;
    sportEventId: string;
    participantId: string;
    participantName: string;
    pickedAt: string;
    teamAffiliation?: string;
    role?: string;
  }> | undefined;
}> = {}) {
  return {
    id: overrides.id ?? 'entry-1',
    contestId: 'contest-1',
    squadId: overrides.squadId ?? 'squad-1',
    squadName: overrides.squadName ?? 'Birdie Hunters',
    entryNumber: overrides.entryNumber ?? 1,
    name: overrides.name ?? 'Birdie Hunters Entry 1',
    // A one-event contest: the entry's status in its event (#713).
    events: [{
      sportEventId: 'event-1',
      status: overrides.status ?? 'SUBMITTED',
      submittedAt: (overrides.status ?? 'SUBMITTED') === 'SUBMITTED' ? '2026-04-15T00:00:00.000Z' : null,
    }],
    tiebreakerValue: null,
    picksCount: overrides.picksCount ?? 0,
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-15T00:00:00.000Z',
    ...(overrides.participants !== undefined ? { participants: overrides.participants } : {}),
  };
}

function primeMocks(opts?: {
  contestStatus?: 'DRAFT' | 'OPEN' | 'ACTIVE' | 'COMPLETED';
  picksRevealed?: boolean;
  entries?: ReturnType<typeof buildEntry>[];
  myTeamId?: string;
  role?: 'MEMBER' | 'COMMISSIONER';
  /** The contest event's scheduled start; far in the future unless given. */
  eventStartDate?: string;
  /** The contest event's scheduled end, as the contest read carries it; none unless given. */
  eventEndDate?: string;
  endsAt?: string;
  /** The contest's own entry cap, from its plan and any expansion; no limit unless given. */
  entriesPerContest?: number;
  /** The league plan's entries per contest; the contest's own cap unless given. */
  planEntriesPerContest?: number;
  selectionType?: 'TIERED' | 'BUDGET_PICK' | 'RANDOM_DRAW' | 'PICK_EM' | 'BRACKET' | 'SQUARES' | 'SURVIVOR';
  allEntryCount?: number;
  /** The event's field rows' tier ids and prices, by field row id; none unless given. */
  field?: Record<string, { tierId?: string; price?: number }>;
  /** The event's tiers, by id; none unless given. */
  tiers?: Record<string, number>;
  /** The budget contests' cap on the event; none unless given. */
  salaryCap?: number;
}) {
  const contestStatus = opts?.contestStatus ?? 'OPEN';
  const picksRevealed = opts?.picksRevealed ?? (contestStatus !== 'OPEN' && contestStatus !== 'DRAFT');
  const entries = opts?.entries ?? [];
  const myTeamId = opts?.myTeamId ?? 'squad-1';
  const myEntries = entries.filter((entry) => entry.squadId === myTeamId);

  getContestMock.mockResolvedValue({
    data: {
      contest: {
        id: 'contest-1',
        name: 'Masters Pick 6',
        status: contestStatus,
        contestFormat: opts?.selectionType === 'PICK_EM' || opts?.selectionType === 'BRACKET' || opts?.selectionType === 'SURVIVOR' ? 'PREDICTION' : 'ROSTER',
        selectionType: opts?.selectionType ?? 'TIERED',
        leagueId: 'league-1',
        sport: 'GOLF',
        entryCount: entries.length,
        // Every team's entries, drafts included, as the cap counts them.
        allEntryCount: opts?.allEntryCount ?? entries.length,
        entriesPerContest: opts?.entriesPerContest ?? null,
        sportEvents: [{
          sportEventId: 'event-1',
          sequence: 1,
          name: 'The Masters',
          startDate: opts?.eventStartDate ?? '2099-04-09T12:40:00.000Z',
          endDate: opts?.eventEndDate ?? null,
          status: 'SCHEDULED',
        }],
        myEntryIds: myEntries.map((entry) => entry.id),
        ...(opts?.endsAt ? { endsAt: opts.endsAt } : {}),
      },
    },
  });

  listEventParticipantsMock.mockResolvedValue({
    data: {
      participants: Object.entries(opts?.field ?? {}).map(([id, values]) => ({
        id,
        sportEventId: 'event-1',
        valuation: {
          id: `valuation-${id}`,
          sportEventTierId: values.tierId ?? null,
          tierOrderIndex: null,
          tierAssignedSource: null,
          price: values.price ?? null,
          priceAssignedSource: null,
        },
      })),
    },
  });
  listEventTiersMock.mockResolvedValue({
    data: {
      tiers: Object.entries(opts?.tiers ?? {}).map(([id, tierNumber]) => ({
        id, sportEventId: 'event-1', tierKey: `tier-${tierNumber}`, label: `Tier ${tierNumber}`, tierNumber,
      })),
    },
  });
  getEventMock.mockResolvedValue({
    data: {
      event: {
        id: 'event-1',
        name: 'The Masters',
        pricing: opts?.salaryCap === undefined ? null : { salaryCap: opts.salaryCap },
      },
    },
  });

  listContestEntriesMock.mockResolvedValue({
    data: {
      contestId: 'contest-1',
      total: entries.length,
      picksRevealed,
      entries,
    },
  });

  // #202 (A8) — the league context: the league plus the viewer's own edges in it, once. Which
  // squad is the viewer's is their `squadMembership`, not a flag on a squad row.
  getLeagueMock.mockResolvedValue({
    data: {
      league: {
        id: 'league-1',
        leagueCode: 'BIGDAWGS',
        name: 'Big Dawgs',
        isActive: true,
        iconKey: 'TROPHY',
        memberCount: 3,
        activeContestCount: 1,
        createdAt: '2026-04-15T00:00:00.000Z',
        planEntitlements: buildPlanEntitlements({
          caps: { ENTRIES_PER_CONTEST: opts?.planEntriesPerContest ?? opts?.entriesPerContest ?? null, SPORTS_LEAGUES_PER_YEAR: null },
        }),
      },
      membership: {
        id: 'league-membership-1',
        leagueId: 'league-1',
        userId: 'user-1',
        user: VIEWER_USER,
        role: opts?.role ?? 'MEMBER',
        status: 'ACTIVE',
        joinedAt: '2026-04-15T00:00:00.000Z',
        createdAt: '2026-04-15T00:00:00.000Z',
        updatedAt: '2026-04-15T00:00:00.000Z',
      },
      squadMembership: {
        id: 'squad-membership-1',
        squadId: myTeamId,
        leagueId: 'league-1',
        userId: 'user-1',
        user: VIEWER_USER,
        status: 'ACTIVE',
        joinedAt: '2026-04-15T00:00:00.000Z',
        createdAt: '2026-04-15T00:00:00.000Z',
        updatedAt: '2026-04-15T00:00:00.000Z',
      },
    },
  });
}

const PICKS = [
  { pickId: 'pick-2', sportEventParticipantId: 'sep-2', sportEventId: 'event-1', participantId: 'participant-2', participantName: 'Scottie Scheffler', pickedAt: '2026-04-01T00:00:00.000Z' },
  { pickId: 'pick-1', sportEventParticipantId: 'sep-1', sportEventId: 'event-1', participantId: 'participant-1', participantName: 'Rory McIlroy', pickedAt: '2026-04-01T00:00:00.000Z', teamAffiliation: 'Northern Ireland' },
];

const MINE = buildEntry({ id: 'entry-1', squadId: 'squad-1', name: 'Birdie Hunters 1', picksCount: 2, participants: PICKS });
const MY_DRAFT = buildEntry({ id: 'entry-2', squadId: 'squad-1', name: 'Birdie Hunters 2', entryNumber: 2, picksCount: 1, status: 'DRAFT', participants: [] });
const THEIRS = buildEntry({ id: 'entry-3', squadId: 'squad-other', squadName: 'Other Team', name: 'Other Team 1', picksCount: 6 });

describe('ContestEntryListPage — a contest\'s page while entries are open', () => {
  afterEach(() => {
    enterContestMock.mockReset();
    getContestMock.mockReset();
    getEventMock.mockReset();
    getEventBracketMock.mockReset();
    getGamePicksMock.mockReset();
    listContestEntriesMock.mockReset();
    listEventParticipantsMock.mockReset();
    listEventTiersMock.mockReset();
    getLeagueMock.mockReset();
    getSquaresBoardMock.mockReset();
    updateContestEntryMock.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.child.mockClear();
  });

  it('holds a placeholder header with no tab row while the contest loads, since a contest page has no tabs', async () => {
    primeMocks();
    getContestMock.mockReturnValue(new Promise(() => {}));

    renderContestBoard();

    expect(await screen.findByTestId('contest-page-pending-header')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByTestId('contest-page-pending-header-tabs')).not.toBeInTheDocument();
  });

  it('names the way to play in words in the fact line, with a (?) beside it linking to How to Play on that format at its sport', async () => {
    primeMocks();

    renderContestBoard();

    expect(await screen.findByTestId('contest-page-summary')).toHaveTextContent('Tiered');
    expect(screen.getByTestId('contest-page-summary')).not.toHaveTextContent(/TIERED|STROKE_PLAY/);
    fireEvent.click(screen.getByTestId('contest-how-to-play'));
    expect(await screen.findByTestId('contest-how-to-play-link')).toHaveAttribute('href', '/how-to-play?sport=golf&format=TIERED');
  });

  it('has no tabs, no How to Play box, no Rename button and no "My entries only" checkbox', async () => {
    primeMocks({ entries: [MINE, THEIRS] });

    renderContestBoard();

    await screen.findByTestId('contest-board-entry-entry-1');
    expect(screen.queryByRole('navigation', { name: 'Contest pages' })).not.toBeInTheDocument();
    expect(screen.queryByText('How to play this contest')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Rename/ })).not.toBeInTheDocument();
    expect(screen.queryByText('My entries only')).not.toBeInTheDocument();
  });

  it('has no Back to league button, the Home breadcrumb being the way back', async () => {
    primeMocks();

    renderContestBoard();

    await screen.findByRole('heading', { name: 'Masters Pick 6' });
    expect(screen.queryByRole('link', { name: 'Back to league' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Contest breadcrumbs' })).getByRole('link', { name: 'Home' }))
      .toHaveAttribute('href', '/league/BIGDAWGS?focus=contest-1');
  });

  it('shows when the contest starts and ends from the events the contest read carries, reading no event', async () => {
    primeMocks({ eventStartDate: '2026-04-09T12:00:00.000Z', eventEndDate: '2026-04-12T23:00:00.000Z' });

    renderContestBoard();

    // A visitor with no saved zone sees US Eastern, named.
    expect(await screen.findByTestId('contest-page-starts')).toHaveTextContent('Starts Apr 9, 2026, 8:00 AM EDT');
    expect(screen.getByTestId('contest-page-ends')).toHaveTextContent('Ends Apr 12, 2026, 7:00 PM EDT');
    expect(getEventMock).not.toHaveBeenCalled();
  });

  it('shows the contest\'s own end once it has one, over the event\'s scheduled end', async () => {
    primeMocks({ eventStartDate: '2026-04-09T12:00:00.000Z', eventEndDate: '2026-04-12T23:00:00.000Z', endsAt: '2026-04-14T18:00:00.000Z' });

    renderContestBoard();

    expect(await screen.findByTestId('contest-page-ends')).toHaveTextContent('Ends Apr 14, 2026, 2:00 PM EDT');
  });

  it('lists the viewer\'s entries first, marked Yours and highlighted, each with its status and ✎ to its pick screen', async () => {
    primeMocks({ entries: [MINE, MY_DRAFT, THEIRS] });

    renderContestBoard();

    const rows = within(await screen.findByTestId('contest-board-entries')).getAllByTestId(/^contest-board-entry-entry-\d$/);
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
      'contest-board-entry-entry-1',
      'contest-board-entry-entry-2',
      'contest-board-entry-entry-3',
    ]);
    const mine = within(rows[0]);
    // Which entries are the viewer's comes from their team, which the league context names.
    await waitFor(() => expect(rows[0]).toHaveAttribute('data-mine', 'true'));
    expect(mine.getByText('Yours')).toBeInTheDocument();
    expect(screen.getByTestId('contest-board-entry-status-entry-1')).toHaveTextContent(/^Submitted$/);
    expect(screen.getByTestId('contest-board-entry-status-entry-2')).toHaveTextContent(/^Draft · 1 pick$/);
    expect(screen.getByTestId('contest-board-edit-entry-entry-1')).toHaveAttribute('href', '/league/BIGDAWGS/contests/contest-1/entries/entry-1');
    expect(screen.getByTestId('contest-board-edit-entry-entry-2')).toHaveAttribute('href', '/league/BIGDAWGS/contests/contest-1/entries/entry-2');
  });

  it('shows another team\'s entry by its name and (i) alone: no status, no picks, no open button and no ✎', async () => {
    primeMocks({ entries: [MINE, THEIRS] });

    renderContestBoard();

    const theirs = await screen.findByTestId('contest-board-entry-entry-3');
    expect(theirs).toHaveTextContent('Other Team 1');
    expect(theirs).not.toHaveAttribute('data-mine');
    expect(within(theirs).getByRole('button', { name: 'About Other Team 1' })).toBeInTheDocument();
    expect(screen.queryByTestId('contest-board-entry-status-entry-3')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contest-board-toggle-entry-3')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contest-board-edit-entry-entry-3')).not.toBeInTheDocument();
    expect(theirs).not.toHaveTextContent('6 picks');
  });

  it('opens the viewer\'s own entry a link names (?entry=) and scrolls to it, and closing it drops ?entry= by replace', async () => {
    const scrolled: Element[] = [];
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function scrollIntoView(this: Element) {
      scrolled.push(this);
    });
    primeMocks({ entries: [MINE, MY_DRAFT, THEIRS] });

    renderContestBoard('?entry=entry-2');

    const toggle = await screen.findByTestId('contest-board-toggle-entry-2');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(scrolled).toEqual([screen.getByTestId('contest-board-entry-entry-2')]);

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('address')).toHaveTextContent(/^\|REPLACE$/);
    scroll.mockRestore();
  });

  it('does nothing for another team\'s entry a link names before the contest locks: nothing opens, scrolls or shows its picks', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => undefined);
    primeMocks({ entries: [MINE, THEIRS] });

    renderContestBoard('?entry=entry-3');

    const theirs = await screen.findByTestId('contest-board-entry-entry-3');
    expect(screen.queryByTestId('contest-board-toggle-entry-3')).not.toBeInTheDocument();
    expect(theirs).not.toHaveTextContent('6 picks');
    expect(scroll).not.toHaveBeenCalled();
    expect(screen.getByTestId('address')).toHaveTextContent('?entry=entry-3|POP');
    scroll.mockRestore();
  });

  it('opens the viewer\'s tiered entry to its picks, tier 1 first, each with its tier and team, and closes it again', async () => {
    primeMocks({ entries: [MINE], field: { 'sep-1': { tierId: 'tier-b' }, 'sep-2': { tierId: 'tier-a' } }, tiers: { 'tier-a': 1, 'tier-b': 2 } });

    renderContestBoard();

    const picks = await screen.findByTestId('contest-entry-picks-entry-1');
    await waitFor(() => expect(within(picks).getAllByTestId(/^contest-entry-pick-entry-1-participant/).map((row) => row.textContent)).toEqual([
      'Scottie Scheffler1',
      'Rory McIlroy · Northern Ireland2',
    ]));
    expect(within(picks).getByTestId('contest-entry-picks-head-entry-1')).toHaveTextContent(/^GolferTier$/);
    expect(listEventParticipantsMock).toHaveBeenCalledWith(expect.objectContaining({ path: { eventId: 'event-1' } }));
    expect(getEventMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('contest-board-toggle-entry-1'));
    expect(screen.queryByTestId('contest-entry-picks-entry-1')).not.toBeInTheDocument();
  });

  it('shows a budget entry\'s picks dearest first with their prices, and what they cost of the cap on its status line', async () => {
    primeMocks({ entries: [MINE], selectionType: 'BUDGET_PICK', field: { 'sep-1': { price: 12_000 }, 'sep-2': { price: 9_500 } }, salaryCap: 50_000 });

    renderContestBoard();

    const picks = await screen.findByTestId('contest-entry-picks-entry-1');
    await waitFor(() => expect(within(picks).getAllByTestId(/^contest-entry-pick-entry-1-participant/).map((row) => row.textContent)).toEqual([
      'Rory McIlroy · Northern Ireland$12,000',
      'Scottie Scheffler$9,500',
    ]));
    expect(within(picks).getByTestId('contest-entry-picks-head-entry-1')).toHaveTextContent(/^GolferPrice$/);
    expect(await screen.findByText('Submitted · $21,500 of $50,000')).toBeInTheDocument();
    expect(listEventTiersMock).not.toHaveBeenCalled();
  });

  it('shows a random draw entry\'s drawn picks by name with nothing beside them, reading nothing of the event', async () => {
    primeMocks({ entries: [MINE], selectionType: 'RANDOM_DRAW' });

    renderContestBoard();

    const picks = await screen.findByTestId('contest-entry-picks-entry-1');
    expect(within(picks).getAllByTestId(/^contest-entry-pick-entry-1-participant/).map((row) => row.textContent)).toEqual([
      'Rory McIlroy · Northern Ireland',
      'Scottie Scheffler',
    ]);
    expect(screen.getByTestId('contest-board-entry-status-entry-1')).toHaveTextContent(/^Submitted$/);
    expect(listEventParticipantsMock).not.toHaveBeenCalled();
    expect(listEventTiersMock).not.toHaveBeenCalled();
  });

  it('shows a Clutch Card pick with its team and playing role beside its name', async () => {
    const player = { pickId: 'pick-9', sportEventParticipantId: 'sep-9', sportEventId: 'event-1', participantId: 'participant-9', participantName: 'Patrick Mahomes', pickedAt: '2026-04-01T00:00:00.000Z', teamAffiliation: 'KC', role: 'QB' };
    primeMocks({ entries: [buildEntry({ id: 'entry-1', name: 'Birdie Hunters 1', picksCount: 1, participants: [player] })], field: { 'sep-9': { tierId: 'tier-a' } }, tiers: { 'tier-a': 1 } });

    renderContestBoard();

    expect(await screen.findByTestId('contest-entry-pick-entry-1-participant-9')).toHaveTextContent('Patrick Mahomes · KC QB');
  });

  it('leaves out an entry\'s picks in the contest\'s other events', async () => {
    const elsewhere = { ...PICKS[0], pickId: 'pick-7', participantId: 'participant-7', participantName: 'Jon Rahm', sportEventId: 'event-0' };
    primeMocks({ entries: [buildEntry({ id: 'entry-1', name: 'Birdie Hunters 1', picksCount: 3, participants: [...PICKS, elsewhere] })] });

    renderContestBoard();

    await screen.findByTestId('contest-entry-picks-entry-1');
    expect(screen.queryByText('Jon Rahm')).not.toBeInTheDocument();
  });

  it('says an own entry has no picks yet when it is opened before any is chosen', async () => {
    primeMocks({ entries: [MY_DRAFT] });

    renderContestBoard();

    expect(await within(await screen.findByTestId('contest-board-entry-entry-2')).findByText('No picks yet.')).toBeInTheDocument();
  });

  it('closes and opens every own row with Hide all details and Show all details', async () => {
    primeMocks({ entries: [MINE, MY_DRAFT, THEIRS] });

    renderContestBoard();

    await screen.findByTestId('contest-entry-picks-entry-1');
    const toggleAll = screen.getByTestId('contest-board-toggle-all');
    expect(toggleAll).toHaveTextContent('Hide all details');

    fireEvent.click(toggleAll);
    expect(toggleAll).toHaveTextContent('Show all details');
    expect(screen.queryByTestId('contest-entry-picks-entry-1')).not.toBeInTheDocument();
    expect(screen.queryByText('No picks yet.')).not.toBeInTheDocument();

    fireEvent.click(toggleAll);
    expect(screen.getByTestId('contest-entry-picks-entry-1')).toBeInTheDocument();
    expect(screen.getByText('No picks yet.')).toBeInTheDocument();
  });

  it('offers no Show all details when the viewer has no entry, since no row opens', async () => {
    primeMocks({ entries: [THEIRS] });

    renderContestBoard();

    await screen.findByTestId('contest-board-entry-entry-3');
    expect(screen.queryByTestId('contest-board-toggle-all')).not.toBeInTheDocument();
  });

  it('opens the viewer\'s pick\'em entry to every game of the week, each with its kickoff and the entry\'s pick, with ✎ to its pick screen', async () => {
    primeMocks({ selectionType: 'PICK_EM', entries: [MINE] });
    listEventParticipantsMock.mockResolvedValue({ data: { participants: pickEmEventFieldFixture('event-1') } });
    getEventBracketMock.mockResolvedValue({ data: { matches: week2EventGamesFixture() } });
    getGamePicksMock.mockResolvedValue({ data: pickEmWeekFixture({
      games: week1Games({
        1: { sportEventMatchId: 'week2-game-3', pick: weekPick(NFL_TEAMS.packers) },
        2: { sportEventMatchId: 'week2-game-1', pick: weekPick(NFL_TEAMS.chiefs) },
      }),
    }) });

    renderContestBoard();

    const picks = await screen.findByTestId('contest-entry-picks-entry-1');
    await waitFor(() => expect(within(picks).getAllByTestId(/^contest-entry-pick-value-entry-1-/).map((cell) => cell.textContent)).toEqual(['KC', '—', 'GB']));
    expect(within(picks).getByTestId('contest-entry-pick-entry-1-week2-game-1')).toHaveTextContent('BUF at KC');
    expect(getGamePicksMock).toHaveBeenCalledWith(expect.objectContaining({ path: { contestId: 'contest-1', entryId: 'entry-1', sportEventId: 'event-1' } }));
    expect(screen.getByTestId('contest-board-edit-entry-entry-1')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('contest-board-toggle-entry-1'));
    expect(screen.queryByTestId('contest-entry-picks-entry-1')).not.toBeInTheDocument();
  });

  it('names the team on the status line of the viewer\'s own survivor entry, by the week it is picked for, and another team\'s pick nowhere', async () => {
    primeMocks({ selectionType: 'SURVIVOR', entries: [MINE, THEIRS] });
    getGamePicksMock.mockResolvedValue({ data: survivorWeekFixture({
      status: 'SUBMITTED',
      survivor: { eliminatedInWeek: null, usedTeams: [], roundWeeks: [{ roundNumber: 1, weekNumber: 1 }] },
      games: week1Games({ 3: { pick: weekPick(NFL_TEAMS.eagles) } }),
    }) });

    renderContestBoard();

    await waitFor(() => expect(screen.getByTestId('contest-board-entry-status-entry-1')).toHaveTextContent(/^Submitted · Week 1: Eagles$/));
    expect(screen.getByTestId('contest-board-edit-entry-entry-1')).toBeInTheDocument();
    expect(screen.queryByTestId('contest-board-entry-status-entry-3')).not.toBeInTheDocument();
    expect(getGamePicksMock).toHaveBeenCalledTimes(1);
  });

  it('shows a squares contest\'s board as its entry list, with no Entries section below it, since every entry is on the board by its boxes', async () => {
    primeMocks({ selectionType: 'SQUARES', entries: [MINE, THEIRS] });
    getSquaresBoardMock.mockResolvedValue({ data: squaresBoardFixture() });

    renderContestBoard();

    expect(await screen.findByTestId('squares-grid')).toBeInTheDocument();
    expect(screen.queryByTestId('contest-board-entries-section')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contest-board-entries')).not.toBeInTheDocument();
  });

  it('shades the viewer\'s own squares entry a link names (?entry=) on the board and scrolls to it', async () => {
    const scrolled: Element[] = [];
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function scrollIntoView(this: Element) {
      scrolled.push(this);
    });
    primeMocks({ selectionType: 'SQUARES', entries: [MINE, THEIRS] });
    getSquaresBoardMock.mockResolvedValue({ data: squaresBoardFixture() });

    renderContestBoard('?entry=entry-1');

    const grid = await screen.findByTestId('squares-grid');
    await waitFor(() => expect(screen.getByTestId('squares-box-0-0')).toHaveAttribute('data-linked', 'true'));
    expect(scrolled).toEqual([grid]);
    scroll.mockRestore();
  });

  it('shades nothing for another team\'s squares entry a link names before lock', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => undefined);
    primeMocks({ selectionType: 'SQUARES', entries: [MINE, buildEntry({ id: 'entry-2', squadId: 'squad-other', squadName: 'Other Team', name: 'Other Team 1' })] });
    getSquaresBoardMock.mockResolvedValue({ data: squaresBoardFixture() });

    renderContestBoard('?entry=entry-2');

    await screen.findByTestId('squares-grid');
    await screen.findByTestId('squares-box-1-1');
    expect(screen.getByTestId('squares-box-1-1')).not.toHaveAttribute('data-linked');
    expect(scroll).not.toHaveBeenCalled();
    scroll.mockRestore();
  });

  it('opens another team\'s squares entry a commissioner\'s link names, shading its boxes and claiming for it until they choose another', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => undefined);
    primeMocks({ role: 'COMMISSIONER', selectionType: 'SQUARES', entries: [MINE, buildEntry({ id: 'entry-2', squadId: 'squad-other', squadName: 'Other Team', name: 'Other Team 1' })] });
    getSquaresBoardMock.mockResolvedValue({ data: squaresBoardFixture() });

    renderContestBoard('?entry=entry-2');

    expect(await screen.findByTestId('squares-claim-for')).toHaveValue('entry-2');
    await waitFor(() => expect(screen.getByTestId('squares-box-1-1')).toHaveAttribute('data-linked', 'true'));
    scroll.mockRestore();
  });

  it('gives a bracket entry of the viewer\'s a bracket icon before its name, "Edit bracket" to its pick page, in place of ✎, and another team\'s entry none', async () => {
    primeMocks({ selectionType: 'BRACKET', entries: [MINE, THEIRS] });

    renderContestBoard();

    const edit = await screen.findByTestId('contest-board-edit-entry-entry-1');
    expect(edit).toHaveAttribute('href', '/league/BIGDAWGS/contests/contest-1/entries/entry-1');
    expect(edit).toHaveAttribute('title', 'Edit bracket');
    expect(edit).toHaveAccessibleName('Edit bracket: Birdie Hunters 1');
    expect(edit).not.toHaveTextContent('✎');
    const mine = screen.getByTestId('contest-board-entry-entry-1');
    expect(within(mine).getAllByRole('link').filter((link) => link.getAttribute('href') === edit.getAttribute('href'))).toEqual([edit]);
    expect(screen.queryByTestId('contest-board-edit-entry-entry-3')).not.toBeInTheDocument();
  });

  it('gives an open contest nobody has entered the Home hero\'s countdown to the close and its own Make your picks', async () => {
    primeMocks({ entries: [] });

    renderContestBoard();

    const empty = within(await screen.findByTestId('contest-board-no-entries'));
    expect(empty.getByRole('heading', { name: 'No entries yet' })).toBeInTheDocument();
    expect(empty.getByTestId('contest-board-countdown')).toHaveAccessibleName(/^Entries close in \d+ days/);
    expect(empty.getByText('until entries close')).toBeInTheDocument();
    expect(await empty.findByRole('button', { name: 'Make your picks' })).toBeInTheDocument();
  });

  it('says only No entries yet, with no countdown or button, once entries have closed', async () => {
    primeMocks({ entries: [], eventStartDate: '2020-04-09T12:40:00.000Z' });

    renderContestBoard();

    const empty = within(await screen.findByTestId('contest-board-no-entries'));
    expect(empty.getByRole('heading', { name: 'No entries yet' })).toBeInTheDocument();
    expect(empty.queryByTestId('contest-board-countdown')).not.toBeInTheDocument();
    expect(empty.queryByRole('button')).not.toBeInTheDocument();
  });

  it('heads the page with Make your picks when the viewer has no entry, and Create another entry once they have one', async () => {
    primeMocks({ entries: [THEIRS] });
    const { unmount } = renderContestBoard();
    expect(await screen.findByTestId('contest-board-create-entry')).toHaveTextContent('Make your picks');
    unmount();

    primeMocks({ entries: [MINE] });
    renderContestBoard();
    await screen.findByTestId('contest-entry-picks-entry-1');
    expect(screen.getByTestId('contest-board-create-entry')).toHaveTextContent('Create another entry');
  });

  it('starts a new entry and opens its pick screen straight away, reading the contest again for its counts', async () => {
    primeMocks({ entries: [] });
    enterContestMock.mockResolvedValue({ data: { entry: buildEntry({ id: 'entry-9' }) } });

    renderContestBoard();

    fireEvent.click(await screen.findByTestId('contest-board-create-entry'));

    expect(await screen.findByTestId('contest-entry-page')).toBeInTheDocument();
    expect(enterContestMock).toHaveBeenCalledWith(expect.objectContaining({ path: { contestId: 'contest-1' } }));
    await waitFor(() => expect(getContestMock).toHaveBeenCalledTimes(2));
  });

  it('shows why a new entry was refused and stays on the page', async () => {
    primeMocks({ entries: [] });
    enterContestMock.mockResolvedValue({
      error: { error: { code: 'CONTEST_ENTRY_LIMIT_REACHED', message: 'Your team already has the most entries allowed.' } },
      status: 409,
    });

    renderContestBoard();

    fireEvent.click(await screen.findByTestId('contest-board-create-entry'));

    expect(await screen.findByTestId('contest-board-create-entry-error')).toHaveTextContent('Your team already has the most entries allowed.');
    expect(screen.queryByTestId('contest-entry-page')).not.toBeInTheDocument();
  });

  it('offers no new entry and no ✎ on an OPEN contest once its event\'s scheduled start has passed', async () => {
    primeMocks({
      eventStartDate: new Date(Date.now() - 60 * 60_000).toISOString(),
      eventEndDate: new Date(Date.now() + 3 * 24 * 60 * 60_000).toISOString(),
      entries: [MINE],
    });

    renderContestBoard();

    await screen.findByTestId('contest-board-entry-entry-1');
    expect(screen.queryByTestId('contest-board-create-entry')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contest-board-edit-entry-entry-1')).not.toBeInTheDocument();
  });

  it('shows a commissioner a contest being set up with its Set up chip, a one-line note, Manage contest and no entry list or count', async () => {
    primeMocks({ contestStatus: 'DRAFT', role: 'COMMISSIONER' });

    renderContestBoard();

    expect(await screen.findByTestId('contest-draft-note')).toHaveTextContent(/^Only commissioners can see this contest\.$/);
    expect(within(screen.getByTestId('contest-page-header')).getByText('Set up')).toBeInTheDocument();
    expect(await screen.findByTestId('contest-board-manage')).toHaveAttribute('href', '/league/BIGDAWGS/admin/contests/contest-1');
    expect(screen.queryByTestId('contest-board-create-entry')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contest-board-entries-section')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contest-board-total-count')).not.toBeInTheDocument();
  });

  it('tells a commissioner a squares board appears once the contest opens', async () => {
    primeMocks({ contestStatus: 'DRAFT', role: 'COMMISSIONER', selectionType: 'SQUARES' });

    renderContestBoard();

    expect(await screen.findByTestId('contest-board-squares-pending-note')).toHaveTextContent('The board appears when the contest opens.');
  });

  // #947 — the league's plan caps how many entries a contest takes, every squad's drafts included.
  describe('a contest at its entry limit', () => {
    it('counts every entry, drafts the list leaves out included, against the limit, and offers a new entry while there is room', async () => {
      primeMocks({ entries: [THEIRS], allEntryCount: 1, entriesPerContest: 2 });

      renderContestBoard();

      expect(await screen.findByTestId('contest-board-create-entry')).toBeInTheDocument();
      expect(screen.getByTestId('contest-board-total-count')).toHaveTextContent(/^1 of 2 entered$/);
      expect(screen.queryByTestId('contest-board-full')).not.toBeInTheDocument();
    });

    it('tells a member the contest is full in place of the button, with no way to expand it', async () => {
      // One entry is listed; the other team's draft fills the contest without being shown.
      primeMocks({ entries: [THEIRS], allEntryCount: 2, entriesPerContest: 2 });

      renderContestBoard();

      expect(await screen.findByTestId('contest-board-full')).toHaveTextContent(/^This contest is full · 2 of 2$/);
      expect(screen.getByTestId('contest-board-total-count')).toHaveTextContent('2 of 2 entered');
      expect(screen.queryByTestId('contest-board-create-entry')).not.toBeInTheDocument();
      expect(screen.queryByTestId('contest-board-full-expand-link')).not.toBeInTheDocument();
    });

    it('links a commissioner to expanding the full contest on its Commissioner tools page', async () => {
      primeMocks({ entries: [THEIRS], allEntryCount: 2, entriesPerContest: 2, role: 'COMMISSIONER' });

      renderContestBoard();

      await waitFor(() => expect(screen.getByTestId('contest-board-full')).toHaveTextContent('This contest is full · 2 of 2 Expand contest'));
      expect(screen.getByTestId('contest-board-full-expand-link')).toHaveAttribute('href', '/league/BIGDAWGS/admin/contests/contest-1');
    });

    it('counts against the contest\'s own cap once it was expanded past its plan\'s', async () => {
      primeMocks({ entries: [THEIRS], allEntryCount: 2, entriesPerContest: 50, planEntriesPerContest: 2 });

      renderContestBoard();

      expect(await screen.findByTestId('contest-board-create-entry')).toBeInTheDocument();
      expect(screen.getByTestId('contest-board-total-count')).toHaveTextContent('2 of 50 entered');
    });

    it('shows no limit on an unlimited plan', async () => {
      primeMocks({ entries: [THEIRS], allEntryCount: 2 });

      renderContestBoard();

      expect(await screen.findByTestId('contest-board-create-entry')).toBeInTheDocument();
      expect(screen.getByTestId('contest-board-total-count')).toHaveTextContent(/^2 entered$/);
    });
  });

  it('shows the load error when the contest cannot be read, and logs it', async () => {
    primeMocks();
    getContestMock.mockResolvedValue({ error: { error: { code: 'CONTEST_NOT_FOUND', message: 'No contest' } }, status: 404 });

    renderContestBoard();

    expect(await screen.findByText("We couldn't load this contest.")).toBeInTheDocument();
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.objectContaining({ action: 'contestPage.contest.failed' }), expect.any(String));
  });

  it('shows an entries error, not an empty list, when the entries cannot be read', async () => {
    primeMocks();
    listContestEntriesMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR', message: 'Boom' } }, status: 500 });

    renderContestBoard();

    expect(await screen.findByText("We couldn't load the current contest entries.")).toBeInTheDocument();
    expect(screen.queryByText('Nobody has entered yet.')).not.toBeInTheDocument();
  });
});
