import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GamePickPreviewResponse, RosterPickPreviewResponse } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { PickPreviewAction } from './pick-preview-dialog';

const {
  createContestMock,
  getSportLeagueMock,
  previewGamePicksMock,
  previewRosterPicksMock,
  saveGamePicksMock,
  selectContestPickMock,
} = vi.hoisted(() => ({
  createContestMock: vi.fn(),
  getSportLeagueMock: vi.fn(),
  previewGamePicksMock: vi.fn(),
  previewRosterPicksMock: vi.fn(),
  saveGamePicksMock: vi.fn(),
  selectContestPickMock: vi.fn(),
}));

bindApiMocks({
  createContest: createContestMock,
  getSportLeague: getSportLeagueMock,
  previewGamePicks: previewGamePicksMock,
  previewRosterPicks: previewRosterPicksMock,
  saveGamePicks: saveGamePicksMock,
  selectContestPick: selectContestPickMock,
});

const golfer = { one: 'golfer', many: 'golfers' };
const team = { one: 'team', many: 'teams' };
const golfEvent = { id: 'event-golf', name: 'The Masters', sport: 'GOLF', sportLeagueId: 'sl-pga', loadedParticipantCount: 90, pricing: null } as const;
const nflEvent = { id: 'event-nfl', name: 'Week 12', sport: 'AMERICAN_FOOTBALL', sportLeagueId: 'sl-nfl', loadedParticipantCount: 32, pricing: null } as const;

function golferRow(id: string, name: string, selected: readonly string[]) {
  return { sportEventParticipantId: id, participantId: `p-${id}`, participantName: name, seedNumber: null, isAvailable: true, isSelected: selected.includes(id) };
}

/** The Masters' first two tiers, one pick from each, with `selected` the trial picks the server answers with. */
function rosterPreview(selected: readonly string[] = []): RosterPickPreviewResponse {
  const tier = (groupNumber: number, rows: Array<[string, string]>) => ({
    groupId: `tier-${groupNumber}`,
    groupName: `Tier ${groupNumber}`,
    groupNumber,
    picksFromGroup: 1,
    selectedParticipantIds: rows.map(([id]) => id).filter((id) => selected.includes(id)),
    participants: rows.map(([id, name]) => golferRow(id, name, selected)),
  });
  return {
    sportEventId: golfEvent.id,
    selectionType: 'TIERED',
    rosterSize: 2,
    selectionGroups: [
      tier(1, [['sep-scheffler', 'Scottie Scheffler'], ['sep-mcilroy', 'Rory McIlroy']]),
      tier(2, [['sep-aberg', 'Ludvig Aberg'], ['sep-morikawa', 'Collin Morikawa']]),
    ],
    availableParticipantIds: ['sep-scheffler', 'sep-mcilroy', 'sep-aberg', 'sep-morikawa'],
    pickCount: selected.length,
    isComplete: selected.length === 2,
    lineupSummary: null,
  };
}

const bills = { sportEventParticipantId: 'sep-bills', participantId: 'p-bills', name: 'Bills' };
const chiefs = { sportEventParticipantId: 'sep-chiefs', participantId: 'p-chiefs', name: 'Chiefs' };

function gamesPreview(overrides: Partial<GamePickPreviewResponse> = {}, pickedTeam: typeof bills | null = null): GamePickPreviewResponse {
  return {
    sportEventId: nflEvent.id,
    selectionType: 'PICK_EM',
    mode: 'STRAIGHT_UP',
    againstTheSpread: true,
    tiePicksOffered: false,
    pickedCount: pickedTeam ? 1 : 0,
    gameCount: 1,
    tiebreakerMatchId: 'match-1',
    games: [{
      sportEventMatchId: 'match-1',
      matchNumber: 1,
      roundNumber: 1,
      kickoff: '2099-11-22T18:00:00.000Z',
      status: 'SCHEDULED',
      isNeutralSite: false,
      regionLabel: null,
      homeSpread: -3.5,
      home: chiefs,
      away: bills,
      predictedHome: chiefs,
      predictedAway: bills,
      locked: false,
      pick: pickedTeam ? { predictedResult: 'TEAM', sportEventParticipantId: pickedTeam.sportEventParticipantId, confidence: null } : null,
    }],
    ...overrides,
  };
}

type ActionProps = ComponentProps<typeof PickPreviewAction>;

function renderAction(overrides: Partial<ActionProps> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PickPreviewAction
          configuration={{ selectionType: 'TIERED', picksPerTier: 1, countedScores: 2 }}
          contestName="Masters Pool"
          event={golfEvent}
          leagueId="league-1"
          participant={golfer}
          rulesError={null}
          selectionType="TIERED"
          tierCount={2}
          {...overrides}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const openPreview = () => fireEvent.click(screen.getByRole('button', { name: 'Preview contest entry' }));

describe('Preview contest entry', () => {
  afterEach(() => {
    for (const mock of [createContestMock, getSportLeagueMock, previewGamePicksMock, previewRosterPicksMock, saveGamePicksMock, selectContestPickMock]) {
      mock.mockReset();
    }
  });

  it('opens a golf setup\'s tier screen under the ribbon, from the form\'s unsaved rules, with no trial picks', async () => {
    previewRosterPicksMock.mockResolvedValue({ data: rosterPreview() });
    renderAction();

    openPreview();

    const dialog = await screen.findByTestId('pick-preview-dialog');
    expect(within(dialog).getByRole('heading', { name: 'Masters Pool · The Masters' })).toBeInTheDocument();
    expect(within(dialog).getByTestId('pick-preview-ribbon')).toHaveTextContent('Preview · this is what members pick from. Nothing is saved.');
    expect(await within(dialog).findByText('Scottie Scheffler')).toBeInTheDocument();
    expect(previewRosterPicksMock).toHaveBeenCalledWith({
      path: { id: 'league-1' },
      body: { sportEventId: golfEvent.id, rules: { selectionType: 'TIERED', picksPerTier: 1, countedScores: 2 }, sportEventParticipantIds: [] },
    });
  });

  it('closes the preview from its Close button, leaving the setup form as it was', async () => {
    previewRosterPicksMock.mockResolvedValue({ data: rosterPreview() });
    renderAction();
    openPreview();
    const dialog = await screen.findByTestId('pick-preview-dialog');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(screen.queryByTestId('pick-preview-dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Preview contest entry' })).toBeEnabled();
    expect(createContestMock).not.toHaveBeenCalled();
  });

  it('sends each tapped golfer as a trial pick and saves nothing: no contest, entry or pick is written', async () => {
    previewRosterPicksMock.mockImplementation(({ body }: { body: { sportEventParticipantIds: string[] } }) =>
      Promise.resolve({ data: rosterPreview(body.sportEventParticipantIds) }));
    renderAction();
    openPreview();

    fireEvent.click(await screen.findByTestId('contest-entry-participant-sep-scheffler'));

    await waitFor(() => expect(previewRosterPicksMock).toHaveBeenLastCalledWith(expect.objectContaining({
      body: expect.objectContaining({ sportEventParticipantIds: ['sep-scheffler'] }) as unknown,
    })));
    expect(await screen.findByTestId('contest-entry-progress')).toHaveTextContent('1 of 2 picked');
    // The ribbon says nothing is saved, so the tier counts what is picked, never "saved".
    expect(screen.getByTestId('contest-entry-group-count-tier-1')).toHaveTextContent('1/1 picked');
    expect(createContestMock).not.toHaveBeenCalled();
    expect(selectContestPickMock).not.toHaveBeenCalled();
    expect(saveGamePicksMock).not.toHaveBeenCalled();
  });

  it('draws a pick\'em setup\'s games with their spreads, and a tap only asks for the screen again', async () => {
    previewGamePicksMock.mockImplementation(({ body }: { body: { picks: unknown[] } }) =>
      Promise.resolve({ data: gamesPreview({}, body.picks.length ? bills : null) }));
    renderAction({
      configuration: { selectionType: 'PICK_EM', mode: 'STRAIGHT_UP', againstTheSpread: true },
      contestName: 'Week 12 Pick\'em',
      event: nflEvent,
      participant: team,
      selectionType: 'PICK_EM',
      tierCount: 0,
    });
    openPreview();

    const billsChoice = await screen.findByTestId('pick-em-game-1-team-sep-bills');
    expect(billsChoice).toHaveTextContent('+3.5');
    expect(screen.getByRole('heading', { name: 'Week 12 Pick\'em' })).toBeInTheDocument();
    fireEvent.click(billsChoice);

    await waitFor(() => expect(previewGamePicksMock).toHaveBeenLastCalledWith({
      path: { id: 'league-1' },
      body: {
        sportEventId: nflEvent.id,
        rules: { selectionType: 'PICK_EM', mode: 'STRAIGHT_UP', againstTheSpread: true },
        picks: [{ sportEventMatchId: 'match-1', predictedResult: 'TEAM', sportEventParticipantId: 'sep-bills' }],
      },
    }));
    expect(saveGamePicksMock).not.toHaveBeenCalled();
  });

  it('takes a pick\'em preview\'s tiebreaker as typed, with no Save button and nothing reading "saved"', async () => {
    previewGamePicksMock.mockResolvedValue({ data: gamesPreview() });
    renderAction({
      configuration: { selectionType: 'PICK_EM', mode: 'STRAIGHT_UP', againstTheSpread: false },
      event: nflEvent,
      participant: team,
      selectionType: 'PICK_EM',
      tierCount: 0,
    });
    openPreview();

    const input = await screen.findByTestId('pick-em-tiebreaker-input');
    expect(screen.queryByTestId('pick-em-tiebreaker-save')).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: '47' } });

    expect(screen.getByTestId('pick-em-tiebreaker-input')).toHaveValue(47);
    expect(screen.queryByTestId('pick-em-tiebreaker-saved')).not.toBeInTheDocument();
    expect(saveGamePicksMock).not.toHaveBeenCalled();
  });

  it('draws a bracket setup on the bracket board from its starting round', async () => {
    getSportLeagueMock.mockResolvedValue({ data: { sportLeague: { id: 'sl-nfl', name: 'NFL', roundNames: [] } } });
    previewGamePicksMock.mockResolvedValue({ data: gamesPreview({ selectionType: 'BRACKET', mode: null, againstTheSpread: false }) });
    renderAction({
      configuration: { selectionType: 'BRACKET', startsAtRound: 1 },
      contestName: 'Playoff Bracket',
      event: nflEvent,
      participant: team,
      selectionType: 'BRACKET',
      tierCount: 0,
    });
    openPreview();

    expect(await screen.findByTestId('bracket-board')).toBeInTheDocument();
    expect(previewGamePicksMock).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ rules: { selectionType: 'BRACKET', startsAtRound: 1 } }) as unknown,
    }));
  });

  it('keeps the button off, with why behind a (?), while the event\'s field is not loaded', () => {
    renderAction({ event: { ...golfEvent, loadedParticipantCount: 0 } });

    expect(screen.getByRole('button', { name: 'Preview contest entry' })).toBeDisabled();
    expect(screen.getByTestId('pick-preview-unavailable')).toBeInTheDocument();
    expect(previewRosterPicksMock).not.toHaveBeenCalled();
  });

  it('keeps the button off for a random draw, which has no picks page', () => {
    renderAction({ configuration: { selectionType: 'RANDOM_DRAW', picksPerEntry: 4, countedScores: 4 }, selectionType: 'RANDOM_DRAW' });

    expect(screen.getByRole('button', { name: 'Preview contest entry' })).toBeDisabled();
  });
});
