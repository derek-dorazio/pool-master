import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSportDefinition, Sport, type SportMatchPeriods } from '@poolmaster/shared/domain';
import type { SportEventMatchDto } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import type { BracketContext } from './bracket-match-row';
import { MatchScoresRow } from './match-scores-row';
import { fieldEntryFixture, participantFixture } from './sport-test-fixtures';

// MSW hands path parameters over as strings, so a match number reads '1'.
// #791: a bracket match's final score in a sport that holds shoot-outs. No sport does until
// soccer, so the context carries a test-only shoot-out ("pens").

const { recordEventMatchResultMock, recordEventMatchPeriodScoreMock, clearEventMatchPeriodScoreMock, mockLogger } = vi.hoisted(() => {
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
    recordEventMatchResultMock: vi.fn(),
    recordEventMatchPeriodScoreMock: vi.fn(),
    clearEventMatchPeriodScoreMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  recordEventMatchResult: recordEventMatchResultMock,
  recordEventMatchPeriodScore: recordEventMatchPeriodScoreMock,
  clearEventMatchPeriodScore: clearEventMatchPeriodScoreMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

const HALVES: SportMatchPeriods = { count: 2, label: { one: 'half', many: 'halves' } };

const arsenal = fieldEntryFixture({ id: 'sep-1', participantId: 'p-1', seedNumber: 1, participant: participantFixture({ id: 'p-1', name: 'Arsenal' }) });
const porto = fieldEntryFixture({ id: 'sep-2', participantId: 'p-2', seedNumber: 2, participant: participantFixture({ id: 'p-2', name: 'Porto' }) });

function knockoutMatch(overrides: Partial<SportEventMatchDto> = {}): SportEventMatchDto {
  return {
    id: 'm-1',
    sportEventId: 'evt-1',
    roundNumber: 1,
    matchNumber: 1,
    homeSportEventParticipantId: 'sep-1',
    awaySportEventParticipantId: 'sep-2',
    isNeutralSite: false,
    scheduledDate: null,
    status: 'SCHEDULED',
    winnerSide: null,
    homeScore: null,
    awayScore: null,
    homeShootoutScore: null,
    awayShootoutScore: null,
    advancesToMatchId: 'm-2',
    advancesToSide: 'HOME',
    regionLabel: null,
    homeSpread: null,
    periodScores: [],
    ...overrides,
  };
}

function renderRow(match: SportEventMatchDto, shootout: BracketContext['shootout'] = { label: 'pens' }) {
  const context: BracketContext = {
    eventId: 'evt-1',
    vocabulary: getSportDefinition(Sport.HOCKEY).vocabulary,
    bracket: [match],
    field: [arsenal, porto],
    fieldById: new Map([arsenal, porto].map((entry) => [entry.id, entry])),
    spreads: false,
    periods: HALVES,
    shootout,
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <table>
        <tbody>
          <MatchScoresRow columns={5} context={context} match={match} periods={HALVES} />
        </tbody>
      </table>
    </QueryClientProvider>,
  );
}

async function enterFinal(away: string, home: string) {
  await userEvent.click(await screen.findByTestId('root-admin-bracket-score-1-final-edit'));
  await userEvent.type(screen.getByTestId('root-admin-bracket-score-1-final-away'), away);
  await userEvent.type(screen.getByTestId('root-admin-bracket-score-1-final-home'), home);
}

describe('MatchScoresRow shoot-outs', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('asks for the shoot-out once the final score is level, and saves the shoot-out\'s winner with both scores', async () => {
    recordEventMatchResultMock.mockResolvedValue({ data: { matches: [] } });
    renderRow(knockoutMatch());

    await enterFinal('1', '1');
    expect(screen.getByText('Level after extra time: enter the shoot-out (pens).')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-bracket-score-1-final-save')).toBeDisabled();
    await userEvent.type(screen.getByTestId('root-admin-bracket-score-1-final-shootout-away'), '4');
    await userEvent.type(screen.getByTestId('root-admin-bracket-score-1-final-shootout-home'), '3');
    await userEvent.click(screen.getByTestId('root-admin-bracket-score-1-final-save'));

    expect(recordEventMatchResultMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { eventId: 'evt-1', matchNumber: '1' },
      body: { winnerSide: 'AWAY', homeScore: 1, awayScore: 1, homeShootoutScore: 3, awayShootoutScore: 4 },
    }));
  });

  it('refuses a level shoot-out before sending it', async () => {
    renderRow(knockoutMatch());

    await enterFinal('2', '2');
    await userEvent.type(screen.getByTestId('root-admin-bracket-score-1-final-shootout-away'), '5');
    await userEvent.type(screen.getByTestId('root-admin-bracket-score-1-final-shootout-home'), '5');

    expect(screen.getByText('The shoot-out can\'t be level: the winner\'s is the higher.')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-bracket-score-1-final-save')).toBeDisabled();
  });

  it('asks for no shoot-out when the final score has a winner, and sends none', async () => {
    recordEventMatchResultMock.mockResolvedValue({ data: { matches: [] } });
    renderRow(knockoutMatch());

    await enterFinal('0', '2');
    expect(screen.queryByTestId('root-admin-bracket-score-1-final-shootout-away')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('root-admin-bracket-score-1-final-save'));

    expect(recordEventMatchResultMock).toHaveBeenCalledWith(expect.objectContaining({
      body: { winnerSide: 'HOME', homeScore: 2, awayScore: 0 },
    }));
  });

  it('refuses a level final score where no shoot-out is held, as before', async () => {
    renderRow(knockoutMatch(), null);

    await enterFinal('1', '1');

    expect(screen.queryByTestId('root-admin-bracket-score-1-final-shootout-away')).not.toBeInTheDocument();
    expect(screen.getByText('The final score can\'t be a tie: the winner\'s score is the higher.')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-bracket-score-1-final-save')).toBeDisabled();
  });

  it('shows a saved shoot-out after the final score, away side first, and fills it in to change', async () => {
    renderRow(knockoutMatch({ status: 'COMPLETED', winnerSide: 'AWAY', homeScore: 1, awayScore: 1, homeShootoutScore: 3, awayShootoutScore: 4 }));

    expect(await screen.findByTestId('root-admin-bracket-score-1-final-value')).toHaveTextContent('Porto 1, Arsenal 1 (4-3 pens)');
    await userEvent.click(screen.getByTestId('root-admin-bracket-score-1-final-edit'));
    expect(screen.getByTestId('root-admin-bracket-score-1-final-shootout-away')).toHaveValue(4);
    expect(screen.getByTestId('root-admin-bracket-score-1-final-shootout-home')).toHaveValue(3);
  });
});
