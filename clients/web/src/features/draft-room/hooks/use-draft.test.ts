import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
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
  it('returns draft state from API on success', async () => {
    server.use(
      http.get('/api/v1/drafts/draft-42', () => {
        return HttpResponse.json(mockDraftState);
      }),
    );
    const { result } = renderHook(() => useDraft('draft-42'));

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toMatchObject({ id: 'draft-42', sport: 'NFL', draftType: 'SNAKE' });
  });

  it('fetches from the correct API endpoint', async () => {
    let requestUrl = '';
    server.use(
      http.get('/api/v1/drafts/draft-99', ({ request }) => {
        requestUrl = new URL(request.url).pathname;
        return HttpResponse.json(mockDraftState);
      }),
    );
    renderHook(() => useDraft('draft-99'));

    await waitFor(() => expect(requestUrl).toBe('/api/v1/drafts/draft-99'));
  });

  it('returns error state when API fails', async () => {
    server.use(
      http.get('/api/v1/drafts/draft-fallback', () => {
        return HttpResponse.json({ message: 'Not found' }, { status: 404 });
      }),
    );
    const { result } = renderHook(() => useDraft('draft-fallback'));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it('returns data with expected shape', async () => {
    server.use(
      http.get('/api/v1/drafts/draft-42', () => {
        return HttpResponse.json(mockDraftState);
      }),
    );
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
  it('returns available participants from API', async () => {
    server.use(
      http.get('/api/v1/drafts/draft-1/available', () => {
        return HttpResponse.json(mockAvailable);
      }),
    );
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
    spy.mockRestore();
  });

  it('returns error state when API fails', async () => {
    server.use(
      http.get('/api/v1/drafts/draft-1/available', () => {
        return HttpResponse.json({ message: 'Server error' }, { status: 500 });
      }),
    );
    const { result } = renderHook(() => useAvailableParticipants('draft-1', { position: 'QB' }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});

describe('useMakePick', () => {
  it('posts pick to correct endpoint', async () => {
    let capturedPath = '';
    let capturedBody: Record<string, unknown> = {};
    server.use(
      http.post('/api/v1/drafts/draft-1/pick', async ({ request }) => {
        capturedPath = new URL(request.url).pathname;
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ success: true });
      }),
    );
    const { result } = renderHook(() => useMakePick('draft-1'));

    result.current.mutate('player-99');
    await waitFor(() => expect(capturedPath).toBe('/api/v1/drafts/draft-1/pick'));
    expect(capturedBody).toEqual({ participantId: 'player-99' });
  });

  it('returns success on API response', async () => {
    server.use(
      http.post('/api/v1/drafts/draft-1/pick', () => {
        return HttpResponse.json({ success: true });
      }),
    );
    const { result } = renderHook(() => useMakePick('draft-1'));

    result.current.mutate('player-1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('returns error state when API fails', async () => {
    server.use(
      http.post('/api/v1/drafts/draft-1/pick', () => {
        return HttpResponse.json({ message: 'Server error' }, { status: 500 });
      }),
    );
    const { result } = renderHook(() => useMakePick('draft-1'));

    result.current.mutate('player-1');
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
