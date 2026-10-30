import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRowCorrections } from './use-row-corrections';

type Draft = { strokes?: string };

const fieldKey = ['field', 'event-1'] as const;

function renderCorrections({
  saveRow,
  onSaveError = vi.fn(),
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }),
}: {
  saveRow: (rowId: string, body: number) => Promise<unknown>;
  onSaveError?: (error: Error) => void;
  queryClient?: QueryClient;
}) {
  const wrapper = function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
  return renderHook(
    ({ scope }: { scope: string }) =>
      useRowCorrections<Draft, number>({ scope, saveRow, invalidates: [fieldKey], onSaveError }),
    { initialProps: { scope: 'event-1:1' }, wrapper },
  );
}

describe('useRowCorrections', () => {
  it('sends one row to its endpoint, marks it saving, then drops only that row draft once it saves', async () => {
    let finish: () => void = () => undefined;
    const saveRow = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { result } = renderCorrections({ saveRow });

    act(() => result.current.setDraft({ a: { strokes: '70' }, b: { strokes: '71' } }));
    act(() => result.current.save('a', 70));

    await waitFor(() => expect(result.current.savingId).toBe('a'));
    expect(saveRow).toHaveBeenCalledWith('a', 70);

    act(() => finish());

    await waitFor(() => expect(result.current.savingId).toBeNull());
    expect(result.current.draft).toEqual({ b: { strokes: '71' } });
    expect(result.current.saveError).toBeNull();
  });

  it('refreshes the read the rows come from after a save', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderCorrections({ saveRow: () => Promise.resolve(), queryClient });

    act(() => result.current.save('a', 70));

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: fieldKey }));
  });

  it('keeps the draft of a rejected save, shows the error and hands it to the caller to log', async () => {
    const rejection = new Error('Strokes must be positive');
    const onSaveError = vi.fn();
    const { result } = renderCorrections({ saveRow: () => Promise.reject(rejection), onSaveError });

    act(() => result.current.setDraft({ a: { strokes: '-1' } }));
    act(() => result.current.save('a', -1));

    await waitFor(() => expect(result.current.saveError).toBe(rejection));
    expect(onSaveError).toHaveBeenCalledWith(rejection);
    expect(result.current.draft).toEqual({ a: { strokes: '-1' } });
  });

  it('clears every draft and the stale save error when the round or game changes', async () => {
    const { result, rerender } = renderCorrections({ saveRow: () => Promise.reject(new Error('rejected')) });

    act(() => result.current.setDraft({ a: { strokes: '-1' }, b: { strokes: '72' } }));
    act(() => result.current.save('a', -1));
    await waitFor(() => expect(result.current.saveError).not.toBeNull());

    rerender({ scope: 'event-1:2' });

    expect(result.current.draft).toEqual({});
    expect(result.current.saveError).toBeNull();
  });

  it('keeps the drafts when the screen re-renders on the same round', () => {
    const { result, rerender } = renderCorrections({ saveRow: () => Promise.resolve() });

    act(() => result.current.setDraft({ a: { strokes: '70' } }));
    rerender({ scope: 'event-1:1' });

    expect(result.current.draft).toEqual({ a: { strokes: '70' } });
  });
});
