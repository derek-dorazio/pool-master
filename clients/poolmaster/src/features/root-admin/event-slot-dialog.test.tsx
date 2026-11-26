import { MatchEnding, SlotKind } from '@poolmaster/shared/domain';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SportEventRoundMatchDto, SportEventSlotTiebreakerDto } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { roundSlot } from '@/features/contests/test/round-slots';
import { EventSlotDialog } from './event-slot-dialog';
import { fieldEntryFixture, participantFixture, seasonSlotFixture } from './sport-test-fixtures';

// A slot's dialog on the Event page's Slots tab, with its tiebreaker game (#2048): the game the
// rule or a root admin chose, and Edit choosing another until it starts.

const { chooseMock, listTiebreakersMock, mockLogger } = vi.hoisted(() => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() };
  logger.child.mockReturnValue(logger);
  return { chooseMock: vi.fn(), listTiebreakersMock: vi.fn(), mockLogger: logger };
});

const WEEK = seasonSlotFixture({ id: 'week-18', key: 'WEEK_18', slotKind: 'WEEK', weekNumber: 18, seriesGames: 1, label: null, isTestData: false });

function match(overrides: Pick<SportEventRoundMatchDto, 'id' | 'matchNumber' | 'homeSportEventParticipantId' | 'awaySportEventParticipantId'>): SportEventRoundMatchDto {
  return {
    sportEventId: 'evt-1', roundNumber: 1, slot: roundSlot(SlotKind.WEEK, null, 18), isNeutralSite: false, scheduledDate: null, status: 'SCHEDULED', isUnplayed: true, isFinal: false,
    winnerSide: null, homeScore: null, awayScore: null, homeShootoutScore: null, awayShootoutScore: null, ending: MatchEnding.PLAYED, resultSource: null,
    completedAt: null, advancesToMatchId: null, advancesToSide: null, regionLabel: null, homeSpread: null, periodScores: [], ...overrides,
  };
}

const team = (id: string, name: string) => fieldEntryFixture({ id, participantId: `p-${id}`, participant: participantFixture({ id: `p-${id}`, name }) });

bindApiMocks({
  listEventSlotTiebreakers: listTiebreakersMock,
  chooseEventSlotTiebreakerGame: chooseMock,
  getEventBracket: vi.fn(() => ({
    data: {
      matches: [
        match({ id: 'm-1', matchNumber: 1, homeSportEventParticipantId: 'owls', awaySportEventParticipantId: 'hawks' }),
        match({ id: 'm-2', matchNumber: 2, homeSportEventParticipantId: 'crows', awaySportEventParticipantId: 'doves' }),
      ],
    },
  })),
  listEventParticipants: vi.fn(() => ({ data: { participants: [team('owls', 'Owls'), team('hawks', 'Hawks'), team('crows', 'Crows'), team('doves', 'Doves')] } })),
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

afterEach(() => vi.clearAllMocks());

function tiebreaker(overrides: Partial<SportEventSlotTiebreakerDto> = {}): SportEventSlotTiebreakerDto {
  return {
    seasonSlotId: WEEK.id,
    tiebreakerGameId: 'g-2',
    chosenAt: null,
    chosenByUserId: null,
    editable: true,
    games: [
      { id: 'g-1', sportEventRoundMatchId: 'm-1', gameNumber: 1, scheduledDate: '2027-01-10T18:00:00.000Z', status: 'SCHEDULED', moved: false, choosable: true },
      { id: 'g-2', sportEventRoundMatchId: 'm-2', gameNumber: 1, scheduledDate: '2027-01-12T01:15:00.000Z', status: 'SCHEDULED', moved: false, choosable: true },
    ],
    ...overrides,
  };
}

function renderDialog() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <EventSlotDialog eventId="evt-1" onClose={vi.fn()} slot={WEEK} />
    </QueryClientProvider>,
  );
}

const testId = 'root-admin-event-slot-dialog';

describe('EventSlotDialog, a slot\'s tiebreaker game', () => {
  it('names the game the rule chose by its pairing, and says the rule chose it', async () => {
    listTiebreakersMock.mockResolvedValue({ data: { slots: [tiebreaker()] } });
    renderDialog();

    await waitFor(() => expect(screen.getByTestId(`${testId}-tiebreaker`)).toHaveTextContent('Doves @ Crows'));
    expect(screen.getByTestId(`${testId}-tiebreaker-chosen`)).toHaveTextContent('By the rule');
  });

  it('says a root admin chose it, and when', async () => {
    listTiebreakersMock.mockResolvedValue({ data: { slots: [tiebreaker({ tiebreakerGameId: 'g-1', chosenAt: '2027-01-09T12:00:00.000Z', chosenByUserId: 'admin-1' })] } });
    renderDialog();

    await waitFor(() => expect(screen.getByTestId(`${testId}-tiebreaker`)).toHaveTextContent('Hawks @ Owls'));
    expect(screen.getByTestId(`${testId}-tiebreaker-chosen`)).toHaveTextContent('By a root admin');
  });

  it('chooses another game with Edit, sending the game picked for the slot', async () => {
    listTiebreakersMock.mockResolvedValue({ data: { slots: [tiebreaker()] } });
    chooseMock.mockResolvedValue({ data: { slot: tiebreaker({ tiebreakerGameId: 'g-1', chosenAt: '2027-01-09T12:00:00.000Z', chosenByUserId: 'admin-1' }) } });
    renderDialog();

    await waitFor(() => expect(screen.getByTestId(`${testId}-tiebreaker`)).toHaveTextContent('Doves @ Crows'));
    await userEvent.click(screen.getByTestId(`${testId}-edit`));
    await userEvent.selectOptions(screen.getByTestId(`${testId}-tiebreaker-input`), 'g-1');
    await userEvent.click(screen.getByTestId(`${testId}-save`));

    await waitFor(() => expect(chooseMock).toHaveBeenCalledWith(expect.objectContaining({ path: { eventId: 'evt-1', seasonSlotId: WEEK.id }, body: { gameId: 'g-1' } })));
  });

  it('offers only the games the API says can be chosen', async () => {
    listTiebreakersMock.mockResolvedValue({ data: { slots: [tiebreaker({ games: tiebreaker().games.map((game) => (game.id === 'g-1' ? { ...game, choosable: false } : game)) })] } });
    renderDialog();

    await waitFor(() => expect(screen.getByTestId(`${testId}-tiebreaker`)).toHaveTextContent('Doves @ Crows'));
    await userEvent.click(screen.getByTestId(`${testId}-edit`));

    const options = within(screen.getByTestId(`${testId}-tiebreaker-input`)).getAllByRole('option');
    expect(options.map((option) => option.getAttribute('value'))).toEqual(['g-2']);
  });

  it('offers no Edit once the chosen game has started', async () => {
    listTiebreakersMock.mockResolvedValue({ data: { slots: [tiebreaker({ editable: false, games: tiebreaker().games.map((game) => ({ ...game, choosable: false })) })] } });
    renderDialog();

    await waitFor(() => expect(screen.getByTestId(`${testId}-tiebreaker`)).toHaveTextContent('Doves @ Crows'));
    expect(screen.queryByTestId(`${testId}-edit`)).not.toBeInTheDocument();
  });
});
