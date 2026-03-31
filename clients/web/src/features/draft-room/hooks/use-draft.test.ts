import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { api } from '@/lib/api-client';
import { useDraft, useAvailableParticipants, useMakePick } from './use-draft';
import type { DraftState, AvailableParticipant } from './use-draft';

const mockDraftState: DraftState = {
  id: 'draft-42',
  contestId: 'contest-1',
  contestName: 'Test Draft',
  leagueName: 'Test League',
  sport: 'NFL',
  draftType: 'SNAKE',
  mode: 'LIVE',
  status: 'LIVE',
  currentPickNumber: 1,
  totalPicks: 60,
  currentRound: 1,
  totalRounds: 5,
  currentEntryId: 'entry-1',
  currentEntryName: 'My Team',
  isMyPick: true,
  timePerPickSeconds: 90,
  pickDeadline: null,
  entries: [],
  picks: [],
};

const mockAvailable: AvailableParticipant[] = [
  { id: 'p1', name: 'Player One', position: 'QB', team: 'KC', ranking: 1, formRating: 9.0, injuryStatus: 'HEALTHY' },
  { id: 'p2', name: 'Player Two', position: 'WR', team: 'DAL', ranking: 2, formRating: 8.5, injuryStatus: 'HEALTHY' },
];

describe('useDraft', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns draft state from API on success', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce(mockDraftState);
    const { result } = renderHook(() => useDraft('draft-42'));

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toMatchObject({ id: 'draft-42', sport: 'NFL', draftType: 'SNAKE' });
  });

  it('calls correct API endpoint', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValueOnce(mockDraftState);
    renderHook(() => useDraft('draft-99'));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith('/v1/drafts/draft-99');
  });

  it('returns fallback data when API fails', async () => {
    vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('Network error'));
    const { result } = renderHook(() => useDraft('draft-fallback'));

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.id).toBe('draft-fallback');
    expect(result.current.data!.isMyPick).toBe(true);
  });

  it('returns data with expected shape', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce(mockDraftState);
    const { result } = renderHook(() => useDraft('draft-42'));

    await waitFor(() => expect(result.current.data).toBeDefined());
    const data = result.current.data!;
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('currentPickNumber');
    expect(data).toHaveProperty('entries');
    expect(data).toHaveProperty('picks');
  });
});

describe('useAvailableParticipants', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns available participants from API', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce(mockAvailable);
    const { result } = renderHook(() => useAvailableParticipants('draft-1', {}));

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.length).toBe(2);
    expect(result.current.data![0]).toHaveProperty('name');
    expect(result.current.data![0]).toHaveProperty('formRating');
  });

  it('builds query params from filters', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValueOnce([]);
    renderHook(() => useAvailableParticipants('draft-1', { query: 'mahomes', position: 'QB', sort: 'name' }));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    const url = spy.mock.calls[0][0];
    expect(url).toContain('/v1/drafts/draft-1/available');
    expect(url).toContain('q=mahomes');
    expect(url).toContain('position=QB');
    expect(url).toContain('sort=name');
  });

  it('returns filtered fallback data when API fails', async () => {
    vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('Network'));
    const { result } = renderHook(() => useAvailableParticipants('draft-1', { position: 'QB' }));

    await waitFor(() => expect(result.current.data).toBeDefined());
    const data = result.current.data!;
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((p) => p.position === 'QB')).toBe(true);
  });
});

describe('useMakePick', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('posts pick to correct endpoint', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useMakePick('draft-1'));

    result.current.mutate('player-99');
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith('/v1/drafts/draft-1/pick', { participantId: 'player-99' });
  });

  it('returns success on API response', async () => {
    vi.spyOn(api, 'post').mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useMakePick('draft-1'));

    result.current.mutate('player-1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ success: true });
  });

  it('returns fallback success when API fails', async () => {
    vi.spyOn(api, 'post').mockRejectedValueOnce(new Error('Server down'));
    const { result } = renderHook(() => useMakePick('draft-1'));

    result.current.mutate('player-1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ success: true });
  });
});
