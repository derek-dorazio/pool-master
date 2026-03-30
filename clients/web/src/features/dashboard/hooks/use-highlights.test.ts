import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useHighlights } from './use-highlights';

describe('useHighlights', () => {
  it('returns season highlights data', async () => {
    const { result } = renderHook(() => useHighlights());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const highlights = result.current.data!;
    expect(highlights).toHaveProperty('recentWin');
    expect(highlights).toHaveProperty('personalBest');
    expect(highlights).toHaveProperty('currentStreak');
    expect(highlights).toHaveProperty('seasonRecord');
  });

  it('returns season record with wins and losses', async () => {
    const { result } = renderHook(() => useHighlights());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const { seasonRecord } = result.current.data!;
    expect(typeof seasonRecord.wins).toBe('number');
    expect(typeof seasonRecord.losses).toBe('number');
  });
});
