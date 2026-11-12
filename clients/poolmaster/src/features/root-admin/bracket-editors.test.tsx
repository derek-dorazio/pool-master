import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchEnding, MatchSide } from '@poolmaster/shared/domain';
import { bindApiMocks } from '@/test/msw-api';
import { EarlyEndingResult } from './bracket-early-ending';
import { BracketMatchRow } from './bracket-match-row';
import { PairingEditor } from './bracket-pairing-editor';
import { TieResult } from './bracket-tie-result';
import { awayTeam, bracketContext, bracketMatch, homeTeam, renderWithQueries } from './bracket-test-context';
import { fieldEntryFixture, participantFixture } from './sport-test-fixtures';

const { cancelEventMatchMock, recordEventMatchResultMock, updateEventBracketMatchMock, mockLogger } = vi.hoisted(() => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() };
  logger.child.mockReturnValue(logger);
  return { cancelEventMatchMock: vi.fn(), recordEventMatchResultMock: vi.fn(), updateEventBracketMatchMock: vi.fn(), mockLogger: logger };
});

bindApiMocks({
  cancelEventMatch: cancelEventMatchMock,
  recordEventMatchResult: recordEventMatchResultMock,
  updateEventBracketMatch: updateEventBracketMatchMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function refusal(code: string, message: string) {
  return { error: { error: { code, message } }, response: { status: 409 } };
}

afterEach(() => {
  vi.clearAllMocks();
  mockLogger.child.mockReturnValue(mockLogger);
});

describe('EarlyEndingResult', () => {
  it('opens on the ending already saved for a match that stopped early, and saves the picked winner with no score', async () => {
    recordEventMatchResultMock.mockResolvedValue({ data: {} });
    const match = bracketMatch({ status: 'COMPLETED', ending: MatchEnding.WALKOVER, winnerSide: MatchSide.AWAY });
    renderWithQueries(<EarlyEndingResult away={awayTeam} context={bracketContext({ bracket: [match] })} home={homeTeam} match={match} />);

    await userEvent.click(screen.getByTestId('root-admin-bracket-early-1'));
    expect(screen.getByTestId('root-admin-bracket-early-1-ending')).toHaveValue(MatchEnding.WALKOVER);
    expect(screen.getByTestId('root-admin-bracket-early-1-winner')).toHaveValue(MatchSide.AWAY);
    await userEvent.selectOptions(screen.getByTestId('root-admin-bracket-early-1-ending'), MatchEnding.DEFAULT);
    await userEvent.click(screen.getByTestId('root-admin-bracket-early-1-save'));

    await waitFor(() => expect(recordEventMatchResultMock).toHaveBeenCalledWith(expect.objectContaining({
      body: { winnerSide: MatchSide.AWAY, homeScore: null, awayScore: null, ending: MatchEnding.DEFAULT },
    })));
    await waitFor(() => expect(screen.queryByTestId('root-admin-bracket-early-1-editor')).not.toBeInTheDocument());
  });

  it('shows the server\'s reason when an early ending is refused, and closes on Cancel without saving again', async () => {
    recordEventMatchResultMock.mockResolvedValue(refusal('INTERNAL_ERROR', 'The bracket store is unavailable.'));
    const match = bracketMatch();
    renderWithQueries(<EarlyEndingResult away={awayTeam} context={bracketContext({ bracket: [match] })} home={homeTeam} match={match} />);

    await userEvent.click(screen.getByTestId('root-admin-bracket-early-1'));
    expect(screen.getByTestId('root-admin-bracket-early-1-ending')).toHaveValue(MatchEnding.RETIREMENT);
    await userEvent.click(screen.getByTestId('root-admin-bracket-early-1-save'));

    expect(await screen.findByTestId('root-admin-bracket-early-1-error')).toHaveTextContent('The bracket store is unavailable.');
    expect(mockLogger.warn).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('root-admin-bracket-early-1')).toBeInTheDocument();
    expect(recordEventMatchResultMock).toHaveBeenCalledTimes(1);
  });
});

describe('TieResult', () => {
  it('shows a saved draw with its score and lets no second draw be entered', () => {
    const match = bracketMatch({ status: 'COMPLETED', winnerSide: null, homeScore: 1, awayScore: 1 });
    renderWithQueries(<TieResult context={bracketContext({ bracket: [match] })} match={match} />);

    expect(screen.getByTestId('root-admin-bracket-tie-1')).toHaveTextContent('Draw 1-1');
    expect(screen.getByTestId('root-admin-bracket-tie-1')).toBeDisabled();
  });

  it('saves a draw only once a whole-number score is typed, and says why a refused one failed', async () => {
    recordEventMatchResultMock.mockResolvedValue(refusal('INTERNAL_ERROR', 'Results are locked.'));
    const match = bracketMatch();
    renderWithQueries(<TieResult context={bracketContext({ bracket: [match] })} match={match} />);

    await userEvent.click(screen.getByTestId('root-admin-bracket-tie-1'));
    expect(screen.getByTestId('root-admin-bracket-tie-1-save')).toBeDisabled();
    await userEvent.type(screen.getByTestId('root-admin-bracket-tie-1-score'), '2');
    await userEvent.click(screen.getByTestId('root-admin-bracket-tie-1-save'));

    await waitFor(() => expect(recordEventMatchResultMock).toHaveBeenCalledWith(expect.objectContaining({
      body: { winnerSide: null, homeScore: 2, awayScore: 2 },
    })));
    expect(await screen.findByTestId('root-admin-bracket-tie-1-error')).toHaveTextContent('Results are locked.');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('root-admin-bracket-tie-1-editor')).not.toBeInTheDocument();
  });
});

describe('PairingEditor', () => {
  const extra = fieldEntryFixture({ id: 'sep-3', participantId: 'p-3', seedNumber: 3, participant: participantFixture({ id: 'p-3', name: 'Benfica' }) });
  const placed = fieldEntryFixture({ id: 'sep-4', participantId: 'p-4', seedNumber: 4, participant: participantFixture({ id: 'p-4', name: 'Ajax' }) });

  it('offers only teams not placed in another match, refuses a team against itself, and saves the two picked sides', async () => {
    updateEventBracketMatchMock.mockResolvedValue({ data: {} });
    const onDone = vi.fn();
    const match = bracketMatch({ homeSportEventParticipantId: null, awaySportEventParticipantId: null });
    const other = bracketMatch({ id: 'm-2', matchNumber: 2, homeSportEventParticipantId: 'sep-4', awaySportEventParticipantId: null });
    const context = bracketContext({ bracket: [match, other], field: [homeTeam, awayTeam, extra, placed] });
    renderWithQueries(<PairingEditor awayFed={false} context={context} homeFed={false} match={match} onDone={onDone} />);

    const home = screen.getByTestId(`root-admin-bracket-side-1-${MatchSide.HOME}`);
    expect(home).toHaveTextContent('Benfica');
    expect(home).not.toHaveTextContent('Ajax');
    await userEvent.selectOptions(home, 'sep-3');
    await userEvent.selectOptions(screen.getByTestId(`root-admin-bracket-side-1-${MatchSide.AWAY}`), 'sep-3');
    expect(screen.getByText("A team can't play itself. Pick two different teams.")).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-bracket-save-1')).toBeDisabled();

    await userEvent.selectOptions(screen.getByTestId(`root-admin-bracket-side-1-${MatchSide.AWAY}`), '');
    await userEvent.click(screen.getByTestId('root-admin-bracket-save-1'));

    await waitFor(() => expect(updateEventBracketMatchMock).toHaveBeenCalledWith(expect.objectContaining({
      body: { homeSportEventParticipantId: 'sep-3', awaySportEventParticipantId: null },
    })));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('keeps a side an earlier match fills as text, names neutral-site sides first and second, and says why a refused pairing failed', async () => {
    updateEventBracketMatchMock.mockResolvedValue(refusal('INTERNAL_ERROR', 'The draw is locked.'));
    const match = bracketMatch({ isNeutralSite: true });
    renderWithQueries(<PairingEditor awayFed={false} context={bracketContext({ bracket: [match] })} homeFed match={match} onDone={vi.fn()} />);

    expect(screen.queryByTestId(`root-admin-bracket-side-1-${MatchSide.HOME}`)).not.toBeInTheDocument();
    expect(screen.getByText('Second team')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('root-admin-bracket-save-1'));

    await waitFor(() => expect(updateEventBracketMatchMock).toHaveBeenCalledWith(expect.objectContaining({
      body: { awaySportEventParticipantId: 'sep-2' },
    })));
    expect(await screen.findByText('The draw is locked.')).toBeInTheDocument();
  });
});

describe('BracketMatchRow cancelling a postponed game', () => {
  it('keeps a released week game when the cancel confirmation is dismissed, without cancelling it', async () => {
    const match = bracketMatch();
    renderWithQueries(
      <table>
        <tbody>
          <BracketMatchRow context={bracketContext({ bracket: [match] })} match={match} released />
        </tbody>
      </table>,
    );

    await userEvent.click(screen.getByTestId('root-admin-bracket-cancel-1'));
    await userEvent.click(await screen.findByRole('button', { name: /^Keep / }));

    await waitFor(() => expect(screen.queryByRole('button', { name: /^Keep / })).not.toBeInTheDocument());
    expect(cancelEventMatchMock).not.toHaveBeenCalled();
  });
});
