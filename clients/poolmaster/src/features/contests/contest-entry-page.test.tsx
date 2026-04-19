import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContestEntryPage } from './contest-entry-page';

const getContestMock = vi.fn();
const getDraftStateMock = vi.fn();
const getLeagueMock = vi.fn();
const listContestEntriesMock = vi.fn();
const submitContestSelectionMock = vi.fn();
const updateContestEntryMock = vi.fn();

vi.mock('@/lib/api', () => ({
  getContest: (...args: unknown[]) => getContestMock(...args),
  getDraftState: (...args: unknown[]) => getDraftStateMock(...args),
  getLeague: (...args: unknown[]) => getLeagueMock(...args),
  listContestEntries: (...args: unknown[]) => listContestEntriesMock(...args),
  submitContestSelection: (...args: unknown[]) => submitContestSelectionMock(...args),
  updateContestEntry: (...args: unknown[]) => updateContestEntryMock(...args),
}));

function renderContestEntryPage() {
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
        initialEntries={[
          {
            pathname: '/contests/contest-1/entries/entry-1',
            state: { leagueCode: 'BIGDAWGS' },
          },
        ]}
      >
        <Routes>
          <Route element={<ContestEntryPage />} path="/contests/:contestId/entries/:entryId" />
          <Route element={<div data-testid="contest-page" />} path="/contests/:contestId" />
          <Route element={<div data-testid="league-page" />} path="/league/:leagueCode" />
          <Route element={<div data-testid="team-page" />} path="/league/:leagueCode/team" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function primeCommonMocks(overrides?: {
  contestStatus?: 'OPEN' | 'LOCKED' | 'ACTIVE' | 'COMPLETED';
}) {
  getContestMock.mockResolvedValue({
    data: {
      contest: {
        id: 'contest-1',
        leagueId: 'league-1',
        name: 'Bohler Masters Tiered',
        status: overrides?.contestStatus ?? 'OPEN',
        contestType: 'SINGLE_EVENT',
        selectionType: 'TIERED',
        scoringEngine: 'STROKE_PLAY',
        lockAt: '2026-04-22T16:00:00.000Z',
      },
    },
  });

  getLeagueMock.mockResolvedValue({
    data: {
      league: {
        id: 'league-1',
        leagueCode: 'BIGDAWGS',
        name: 'Big Dawgs',
        role: 'MEMBER',
      },
    },
  });

  listContestEntriesMock.mockResolvedValue({
    data: {
      contestId: 'contest-1',
      total: 1,
      isJoined: true,
      myEntryId: 'entry-1',
      myEntryIds: ['entry-1'],
      entries: [
        {
          id: 'entry-1',
          contestId: 'contest-1',
          squadId: 'squad-1',
          squadName: 'Birdie Hunters',
          entryNumber: 1,
          name: 'Birdie Hunters Entry 1',
          status: 'ACTIVE',
          tiebreakerValue: 271,
          totalScore: 18,
          standingsPosition: 2,
          isEliminated: false,
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-16T00:00:00.000Z',
        },
      ],
    },
  });
}

describe('ContestEntryPage', () => {
  afterEach(() => {
    getContestMock.mockReset();
    getDraftStateMock.mockReset();
    getLeagueMock.mockReset();
    listContestEntriesMock.mockReset();
    submitContestSelectionMock.mockReset();
    updateContestEntryMock.mockReset();
  });

  it('renders tiered selection groups and saves entry details while open', async () => {
    primeCommonMocks();
    getDraftStateMock.mockResolvedValue({
      data: {
        contestId: 'contest-1',
        contestName: 'Bohler Masters Tiered',
        selectionType: 'TIERED',
        isTurnBased: false,
        isCommissioner: false,
        rosterSize: 2,
        contestConfiguration: {
          isExclusive: false,
          rosterSize: 2,
          tierConfig: [
            { tierId: 'tier-1', tierName: 'Tier 1', tierNumber: 1, picksFromTier: 1 },
            { tierId: 'tier-2', tierName: 'Tier 2', tierNumber: 2, picksFromTier: 1 },
          ],
        },
        status: 'LIVE',
        currentPickNumber: 1,
        currentRound: 1,
        totalPicks: 2,
        totalRounds: 2,
        currentEntryId: 'entry-1',
        currentEntryName: 'Birdie Hunters Entry 1',
        myEntryId: 'entry-1',
        isMyPick: true,
        currentTurnStartedAt: null,
        timePerPickSeconds: 0,
        entries: [
          { id: 'entry-1', userId: 'user-1', name: 'Birdie Hunters Entry 1', isOnClock: false },
        ],
        selectedEntryId: 'entry-1',
        selectedEntryName: 'Birdie Hunters Entry 1',
        tiebreakerValue: 271,
        selectionGroups: [
          {
            groupId: 'tier-1',
            groupName: 'Tier 1',
            groupNumber: 1,
            picksFromGroup: 1,
            selectedParticipantIds: [],
            participants: [
              {
                sportEventParticipantId: 'sep-1',
                participantId: 'participant-1',
                participantName: 'Scottie Scheffler',
                position: 'GOLFER',
                team: null,
                status: 'ACTIVE',
                price: null,
                ranking: 1,
                orderIndex: 1,
                isAvailable: true,
                unavailableReason: null,
                isSelected: false,
              },
            ],
          },
          {
            groupId: 'tier-2',
            groupName: 'Tier 2',
            groupNumber: 2,
            picksFromGroup: 1,
            selectedParticipantIds: [],
            participants: [
              {
                sportEventParticipantId: 'sep-2',
                participantId: 'participant-2',
                participantName: 'Rory McIlroy',
                position: 'GOLFER',
                team: null,
                status: 'ACTIVE',
                price: null,
                ranking: 2,
                orderIndex: 2,
                isAvailable: true,
                unavailableReason: null,
                isSelected: false,
              },
            ],
          },
        ],
        draftPickHistories: [],
        availableParticipantIds: ['sep-1', 'sep-2'],
        isComplete: false,
      },
    });
    updateContestEntryMock.mockResolvedValue({
      data: {
        contestId: 'contest-1',
        entry: {
          id: 'entry-1',
          contestId: 'contest-1',
          squadId: 'squad-1',
          squadName: 'Birdie Hunters',
          entryNumber: 1,
          name: 'Sunday Charge',
          status: 'ACTIVE',
          tiebreakerValue: 269,
          totalScore: 18,
          standingsPosition: 2,
          isEliminated: false,
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-16T00:00:00.000Z',
        },
      },
    });
    submitContestSelectionMock.mockResolvedValue({
      data: {
        contestId: 'contest-1',
      },
    });

    renderContestEntryPage();

    expect(await screen.findByText('Build your lineup')).toBeInTheDocument();
    expect(screen.getByText('World rank #1')).toBeInTheDocument();
    expect(screen.getAllByText('0/2')).toHaveLength(2);
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(screen.getByTestId('contest-entry-group-toggle-tier-1')).toBeInTheDocument();
    expect(screen.queryByText('Rory McIlroy')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('contest-entry-group-toggle-tier-2'));
    expect(await screen.findByText('Rory McIlroy')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('contest-entry-name-input'), {
      target: { value: 'Sunday Charge' },
    });
    fireEvent.change(screen.getByTestId('contest-entry-tiebreaker-input'), {
      target: { value: '269' },
    });
    fireEvent.click(screen.getByTestId('contest-entry-save-details'));

    await waitFor(() =>
      expect(updateContestEntryMock).toHaveBeenCalledWith({
        path: { contestId: 'contest-1', entryId: 'entry-1' },
        body: {
          name: 'Sunday Charge',
          tiebreakerValue: 269,
        },
      }),
    );

    fireEvent.click(screen.getByTestId('contest-entry-group-toggle-tier-1'));
    fireEvent.click(await screen.findByTestId('contest-entry-participant-sep-1'));

    await waitFor(() =>
      expect(submitContestSelectionMock).toHaveBeenCalledWith({
        path: { contestId: 'contest-1' },
        body: {
          entryId: 'entry-1',
          participantId: 'sep-1',
        },
      }),
    );
  });

  it('shows read-only entry detail once the contest is locked', async () => {
    primeCommonMocks({ contestStatus: 'LOCKED' });
    getDraftStateMock.mockResolvedValue({
      data: {
        contestId: 'contest-1',
        contestName: 'Bohler Masters Tiered',
        selectionType: 'TIERED',
        isTurnBased: false,
        isCommissioner: false,
        rosterSize: 1,
        contestConfiguration: { isExclusive: false, rosterSize: 1, tierConfig: [] },
        status: 'COMPLETE',
        currentPickNumber: 1,
        currentRound: 1,
        totalPicks: 1,
        totalRounds: 1,
        currentEntryId: null,
        currentEntryName: null,
        myEntryId: 'entry-1',
        isMyPick: false,
        currentTurnStartedAt: null,
        timePerPickSeconds: 0,
        entries: [
          { id: 'entry-1', userId: 'user-1', name: 'Birdie Hunters Entry 1', isOnClock: false },
        ],
        selectedEntryId: 'entry-1',
        selectedEntryName: 'Birdie Hunters Entry 1',
        tiebreakerValue: 271,
        selectionGroups: [
          {
            groupId: 'tier-1',
            groupName: 'Tier 1',
            groupNumber: 1,
            picksFromGroup: 1,
            selectedParticipantIds: ['sep-1'],
            participants: [
              {
                sportEventParticipantId: 'sep-1',
                participantId: 'participant-1',
                participantName: 'Scottie Scheffler',
                position: 'GOLFER',
                team: null,
                status: 'ACTIVE',
                price: null,
                ranking: 1,
                orderIndex: 1,
                isAvailable: true,
                unavailableReason: null,
                isSelected: true,
              },
            ],
          },
        ],
        draftPickHistories: [],
        availableParticipantIds: [],
        isComplete: true,
      },
    });

    renderContestEntryPage();

    expect(await screen.findByText('Saved lineup detail')).toBeInTheDocument();
    expect(screen.getByTestId('contest-entry-readonly-tiebreaker')).toHaveTextContent(
      'Winning score prediction: 271',
    );
    expect(screen.getByTestId('contest-entry-selected-tier-1-sep-1')).toHaveTextContent(
      'Scottie Scheffler',
    );
    expect(screen.getByTestId('contest-entry-locked-participant-tier-1-sep-1')).toHaveTextContent(
      'Scottie Scheffler',
    );
    expect(screen.queryByTestId('contest-entry-save-details')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contest-entry-participant-sep-1')).not.toBeInTheDocument();
  });
});
