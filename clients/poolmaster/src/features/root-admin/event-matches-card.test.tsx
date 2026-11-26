import { MatchEnding, SlotKind } from '@poolmaster/shared/domain';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SportEventRoundMatchDto } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { EventRoundsTab } from './event-rounds-tab';
import { EventTabOutlet } from './test/event-tab-outlet';
import { fieldEntryFixture, participantFixture, sportEventFixture, sportLeagueFixture } from './sport-test-fixtures';
import { roundSlot } from '@/features/contests/test/round-slots';

// The Event page's Matches grid and each match's dialog (#1890). Results come only from the feed
// (#2074), so the grid and dialog show them and offer Settle again, and nothing enters one.

const {
  getEventMock,
  getEventBracketMock,
  listEventParticipantsMock,
  listSportLeaguesMock,
  rebuildEventLeaderboardsMock,
  mockLogger,
} = vi.hoisted(() => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return {
    getEventMock: vi.fn(),
    getEventBracketMock: vi.fn(),
    listEventParticipantsMock: vi.fn(),
    listSportLeaguesMock: vi.fn(),
    rebuildEventLeaderboardsMock: vi.fn(),
    mockLogger: logger,
  };
});

// The tab reads the rounds beside the matches; an empty schedule keeps that grid quiet.
const listEventRoundsMock = vi.fn(() => ({ data: { rounds: [] } }));

bindApiMocks({
  listEventRounds: listEventRoundsMock,
  getEvent: getEventMock,
  getEventBracket: getEventBracketMock,
  listEventParticipants: listEventParticipantsMock,
  listSportLeagues: listSportLeaguesMock,
  rebuildEventLeaderboards: rebuildEventLeaderboardsMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

const tournament = sportEventFixture({
  id: 'evt-1',
  sport: 'BASKETBALL',
  name: 'Harbour Classic',
  status: 'IN_PROGRESS',
  rounds: 2,
  roundsPar: null,
  allowedTransitions: [],
});

const duke = fieldEntryFixture({ id: 'sep-1', participantId: 'p-1', seedNumber: 1, participant: participantFixture({ id: 'p-1', name: 'Duke' }) });
const vermont = fieldEntryFixture({ id: 'sep-2', participantId: 'p-2', seedNumber: 16, participant: participantFixture({ id: 'p-2', name: 'Vermont' }) });
const houston = fieldEntryFixture({ id: 'sep-3', participantId: 'p-3', seedNumber: null, participant: participantFixture({ id: 'p-3', name: 'Houston' }) });
const texas = fieldEntryFixture({ id: 'sep-4', participantId: 'p-4', seedNumber: 15, participant: participantFixture({ id: 'p-4', name: 'Texas' }) });

function match(overrides: Partial<SportEventRoundMatchDto> & Pick<SportEventRoundMatchDto, 'id' | 'matchNumber' | 'roundNumber'>): SportEventRoundMatchDto {
  return {
    sportEventId: 'evt-1',
    slot: overrides.roundNumber === 2 ? roundSlot(SlotKind.FINAL, 'Final') : roundSlot(SlotKind.SEMIFINAL, 'Semifinals'),
    homeSportEventParticipantId: null,
    awaySportEventParticipantId: null,
    isNeutralSite: true,
    scheduledDate: null,
    status: 'SCHEDULED',
    isUnplayed: true,
    isFinal: false,
    winnerSide: null,
    homeScore: null,
    awayScore: null,
    homeShootoutScore: null,
    awayShootoutScore: null,
    ending: MatchEnding.PLAYED,
    resultSource: null,
    completedAt: null,
    advancesToMatchId: null,
    advancesToSide: null,
    regionLabel: null,
    homeSpread: null,
    periodScores: [],
    ...overrides,
  };
}

const MATCHES = [
  match({
    id: 'm-1', matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: 'sep-1', awaySportEventParticipantId: 'sep-2',
    status: 'COMPLETED', isUnplayed: false, isFinal: true, winnerSide: 'HOME', homeScore: 80, awayScore: 61, resultSource: 'PROVIDER', completedAt: '2026-03-20T22:00:00.000Z',
  }),
  match({
    id: 'm-2', matchNumber: 2, roundNumber: 1, homeSportEventParticipantId: 'sep-3', awaySportEventParticipantId: 'sep-4', isNeutralSite: false,
    status: 'COMPLETED', isUnplayed: false, isFinal: true, winnerSide: 'AWAY', homeScore: 1, awayScore: 1, homeShootoutScore: 3, awayShootoutScore: 4, resultSource: 'PROVIDER',
  }),
  match({ id: 'm-3', matchNumber: 1, roundNumber: 2, homeSportEventParticipantId: 'sep-1' }),
  match({
    id: 'm-4', matchNumber: 2, roundNumber: 2, homeSportEventParticipantId: 'sep-2', awaySportEventParticipantId: 'sep-4',
    status: 'COMPLETED', isUnplayed: false, isFinal: true, homeScore: 70, awayScore: 70, resultSource: 'PROVIDER',
  }),
];

function seed(matches: SportEventRoundMatchDto[] = MATCHES) {
  getEventMock.mockResolvedValue({ data: { event: tournament } });
  listSportLeaguesMock.mockResolvedValue({
    data: { sportLeagues: [sportLeagueFixture({ id: tournament.sportLeagueId, name: 'NCAA Men\'s Basketball', matchPeriodLayout: null })] },
  });
  listEventParticipantsMock.mockResolvedValue({ data: { participants: [duke, vermont, houston, texas] } });
  getEventBracketMock.mockResolvedValue({ data: { matches } });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/manage/sports/basketball/events/evt-1/rounds']}>
        <Routes>
          <Route element={<EventTabOutlet />} path="/manage/sports/:sport/events/:eventId">
            <Route element={<EventRoundsTab />} path="rounds" />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openMatch(roundNumber: number, matchNumber: number) {
  const row = await screen.findByTestId(`root-admin-event-match-${String(roundNumber)}-${String(matchNumber)}`);
  await userEvent.click(within(row).getByTestId('data-grid-row-opens-dialog'));
  return screen.findByTestId('root-admin-event-match-dialog');
}

describe('The Event page\'s Matches grid', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('names each match by its seeded sides, "vs" on a neutral site and away @ home otherwise, TBD for a side not decided yet', async () => {
    seed();
    renderPage();

    expect(await screen.findByTestId('root-admin-event-match-1-1')).toHaveTextContent('(1) Duke vs (16) Vermont');
    expect(screen.getByTestId('root-admin-event-match-1-2')).toHaveTextContent('(15) Texas @ Houston');
    expect(screen.getByTestId('root-admin-event-match-2-1')).toHaveTextContent('(1) Duke vs TBD');
  });

  it('shows each score home first, with the shoot-out after it, and nothing for a match not yet scored', async () => {
    seed();
    renderPage();

    expect(await screen.findByTestId('root-admin-event-match-1-1')).toHaveTextContent('80–61');
    expect(screen.getByTestId('root-admin-event-match-1-2')).toHaveTextContent('1–1 (3–4 shoot-out)');
    expect(screen.getByTestId('root-admin-event-match-2-1')).not.toHaveTextContent('–');
  });

  it('says the matches could not load when the bracket read fails', async () => {
    seed();
    getEventBracketMock.mockResolvedValue({ error: { error: { code: 'INTERNAL', message: 'Down for a moment.' } } });
    renderPage();

    expect(await screen.findByTestId('root-admin-event-matches-state-error')).toBeInTheDocument();
  });

  it('opens a final match\'s details with its winner, the feed as its source and when it was settled, and offers Settle again', async () => {
    seed();
    renderPage();

    const dialog = await openMatch(1, 1);
    expect(within(dialog).getByTestId('root-admin-event-match-dialog-score')).toHaveTextContent('80–61');
    expect(within(dialog).getByTestId('root-admin-event-match-dialog-winner')).toHaveTextContent('(1) Duke');
    expect(within(dialog).getByTestId('root-admin-event-match-dialog-source')).toHaveTextContent('Feed');
    expect(within(dialog).getByTestId('root-admin-event-match-dialog-settled')).not.toHaveTextContent('Not yet');
    expect(within(dialog).getByTestId('root-admin-event-match-dialog-settle-again')).toBeInTheDocument();
  });

  it('names the away side the winner when the away side won', async () => {
    seed();
    renderPage();

    const dialog = await openMatch(1, 2);
    expect(within(dialog).getByTestId('root-admin-event-match-dialog-winner')).toHaveTextContent('(15) Texas');
  });

  it('calls a final match with no winner a tie', async () => {
    seed();
    renderPage();

    const dialog = await openMatch(2, 2);
    expect(within(dialog).getByTestId('root-admin-event-match-dialog-winner')).toHaveTextContent('Tie');
  });

  it('shows an unplayed match as not announced, not decided and with no result, and offers no Settle again', async () => {
    seed();
    renderPage();

    const dialog = await openMatch(2, 1);
    expect(within(dialog).getByTestId('root-admin-event-match-dialog-starts')).toHaveTextContent('Not announced');
    expect(within(dialog).getByTestId('root-admin-event-match-dialog-score')).toHaveTextContent('None yet');
    expect(within(dialog).getByTestId('root-admin-event-match-dialog-winner')).toHaveTextContent('Not decided');
    expect(within(dialog).getByTestId('root-admin-event-match-dialog-source')).toHaveTextContent('No result yet');
    expect(within(dialog).getByTestId('root-admin-event-match-dialog-settled')).toHaveTextContent('Not yet');
    expect(within(dialog).queryByTestId('root-admin-event-match-dialog-settle-again')).not.toBeInTheDocument();
  });

  it('queues a rebuild of the event\'s boards from Settle again once confirmed, and closes the dialog on close', async () => {
    seed();
    rebuildEventLeaderboardsMock.mockResolvedValue({ data: { queued: true } });
    renderPage();

    const dialog = await openMatch(1, 1);
    await userEvent.click(within(dialog).getByTestId('root-admin-event-match-dialog-settle-again'));
    await userEvent.click(await screen.findByTestId('root-admin-event-match-dialog-settle-again-confirm'));
    await waitFor(() => expect(rebuildEventLeaderboardsMock).toHaveBeenCalledTimes(1));

    const reopened = await screen.findByTestId('root-admin-event-match-dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(reopened).not.toBeInTheDocument());
  });
});
