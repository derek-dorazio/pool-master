import { waitFor } from '@testing-library/react';
import { renderHook } from '@/test-utils';
import { vi } from 'vitest';
import { useAvailableParticipants, useMakePick } from './use-draft';

const { mockClient, mockSearchPoolParticipants, mockSubmitDraftPick } = vi.hoisted(() => ({
  mockClient: {
    post: vi.fn(),
    delete: vi.fn(),
  },
  mockSearchPoolParticipants: vi.fn(),
  mockSubmitDraftPick: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  client: mockClient,
  extendPickDeadline: vi.fn(),
  getDraftState: vi.fn(),
  pauseDraft: vi.fn(),
  resumeDraft: vi.fn(),
  searchPoolParticipants: (...args: unknown[]) => mockSearchPoolParticipants(...args),
  submitDraftPick: (...args: unknown[]) => mockSubmitDraftPick(...args),
}));

const draftSearchResponse = {
  participants: [
    {
      participantId: 'p-2',
      displayName: 'Bravo Contestant',
      photoUrl: '',
      sport: 'GOLF',
      position: 'G',
      teamAffiliation: 'Team B',
      ranking: 1,
      budgetPrice: 17_000,
      tier: 'Tier 1',
      injuryStatus: { status: 'HEALTHY' },
      isAvailable: true,
      isDrafted: false,
    },
    {
      participantId: 'p-3',
      displayName: 'Alpha Contestant',
      photoUrl: '',
      sport: 'GOLF',
      position: 'G',
      teamAffiliation: 'Team A',
      ranking: 3,
      budgetPrice: 15_000,
      tier: 'Tier 2',
      injuryStatus: { status: 'HEALTHY' },
      isAvailable: true,
      isDrafted: false,
    },
    {
      participantId: 'p-1',
      displayName: 'Charlie Contestant',
      photoUrl: '',
      sport: 'GOLF',
      position: 'G',
      teamAffiliation: 'Team C',
      ranking: 2,
      budgetPrice: 18_000,
      tier: 'Tier 1',
      injuryStatus: { status: 'HEALTHY' },
      isAvailable: true,
      isDrafted: false,
    },
  ],
  total: 3,
  facets: {
    positions: [],
    teams: [],
    nationalities: [],
    tiers: [],
    injuryStatuses: [],
  },
};

describe('useAvailableParticipants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchPoolParticipants.mockResolvedValue({
      data: draftSearchResponse,
      error: null,
    });
  });

  it('maps the API response into stable room participants and forwards the drafted ids filter', async () => {
    const { result } = renderHook(() =>
      useAvailableParticipants('contest-1', ['drafted-9'], {
        query: 'contestant',
        position: 'G',
        sort: 'name',
      }),
    );

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(mockSearchPoolParticipants).toHaveBeenCalledWith(expect.objectContaining({
      client: mockClient,
      path: { contestId: 'contest-1' },
      query: expect.objectContaining({
        q: 'contestant',
        position: 'G',
        undraftedOnly: 'true',
        availableOnly: 'true',
        draftedIds: 'drafted-9',
        limit: '100',
        offset: '0',
      }),
    }));

    expect(result.current.data).toEqual([
      expect.objectContaining({
        id: 'p-3',
        name: 'Alpha Contestant',
        ranking: 3,
        formRating: 3,
        injuryStatus: 'HEALTHY',
        price: 15_000,
        tier: 'Tier 2',
      }),
      expect.objectContaining({
        id: 'p-2',
        name: 'Bravo Contestant',
        ranking: 1,
        formRating: 1,
        injuryStatus: 'HEALTHY',
        price: 17_000,
        tier: 'Tier 1',
      }),
      expect.objectContaining({
        id: 'p-1',
        name: 'Charlie Contestant',
        ranking: 2,
        formRating: 2,
        injuryStatus: 'HEALTHY',
        price: 18_000,
        tier: 'Tier 1',
      }),
    ]);
  });

  it('sorts by price and form using the mapped room participant shape', async () => {
    const priceResult = renderHook(() =>
      useAvailableParticipants('contest-1', [], {
        sort: 'price',
      }),
    );

    await waitFor(() => expect(priceResult.result.current.data).toBeDefined());
    expect(priceResult.result.current.data?.map((participant) => participant.id)).toEqual([
      'p-3',
      'p-2',
      'p-1',
    ]);

    const formResult = renderHook(() =>
      useAvailableParticipants('contest-1', [], {
        sort: 'form',
      }),
    );

    await waitFor(() => expect(formResult.result.current.data).toBeDefined());
    expect(formResult.result.current.data?.map((participant) => participant.id)).toEqual([
      'p-3',
      'p-1',
      'p-2',
    ]);
  });
});

describe('useMakePick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubmitDraftPick.mockResolvedValue({
      data: { ok: true },
      error: null,
    });
    mockClient.post.mockResolvedValue({
      data: { ok: true },
      error: null,
    });
  });

  it('uses the contest pick SDK for a simple real-entry pick', async () => {
    const { result } = renderHook(() => useMakePick('contest-1'));

    result.current.mutate({
      entryId: 'entry-1',
      participantId: 'p-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockSubmitDraftPick).toHaveBeenCalledWith({
      client: mockClient,
      path: { contestId: 'contest-1' },
      body: {
        entryId: 'entry-1',
        participantId: 'p-1',
      },
    });
    expect(mockClient.post).not.toHaveBeenCalled();
  });

  it('uses the extended draft endpoint for pick-em or bracket payloads', async () => {
    const { result } = renderHook(() => useMakePick('contest-1'));

    result.current.mutate({
      entryId: 'entry-1',
      participantId: 'p-1',
      eventId: 'event-1',
      period: 1,
      matchupIndex: 2,
      confidenceWeight: 7,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockClient.post).toHaveBeenCalledWith({
      url: '/api/v1/drafts/contest-1/pick',
      body: {
        entryId: 'entry-1',
        participantId: 'p-1',
        eventId: 'event-1',
        period: 1,
        matchupIndex: 2,
        confidenceWeight: 7,
      },
    });
    expect(mockSubmitDraftPick).not.toHaveBeenCalled();
  });
});
