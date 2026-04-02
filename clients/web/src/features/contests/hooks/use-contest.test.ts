import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useContest } from './use-contest';

describe('useContest', () => {
  it('returns contest data for a given id', async () => {
    const { result } = renderHook(() => useContest('contest-1'));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data! as any;
    // MSW returns { contest: { id, name, status, contestType, selectionType, scoringEngine, leagueId } }
    const contest = data.contest as any;
    expect(contest).toHaveProperty('id', 'contest-1');
    expect(contest).toHaveProperty('name', 'Test Contest');
    expect(contest).toHaveProperty('status', 'DRAFT');
    expect(contest).toHaveProperty('contestType', 'SINGLE_EVENT');
    expect(contest).toHaveProperty('leagueId', 'league-1');
  });

  it('returns contest with selection and scoring info', async () => {
    const { result } = renderHook(() => useContest('contest-1'));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data! as any;
    const contest = data.contest as any;
    expect(contest).toHaveProperty('selectionType', 'SNAKE_DRAFT');
    expect(contest).toHaveProperty('scoringEngine', 'STROKE_PLAY');
  });

  it('does not fetch when id is undefined', () => {
    const { result } = renderHook(() => useContest(undefined));

    expect(result.current.data).toBeUndefined();
    expect(result.current.fetchStatus).toBe('idle');
  });
});
