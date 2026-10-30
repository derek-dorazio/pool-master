import type { SubmitEvent } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './errors';
import { formPageSave } from './form-page-save';

type Values = { name: string };

function mutation(overrides: Partial<Parameters<typeof formPageSave<Values, unknown, Values>>[1]> = {}) {
  return { error: null, isError: false, isPending: false, mutate: vi.fn(), ...overrides };
}

function submitEvent() {
  return { preventDefault: vi.fn(), persist: vi.fn() } as unknown as SubmitEvent<HTMLFormElement>;
}

describe('formPageSave', () => {
  it('has no error to show and is not pending before any save', () => {
    const { result } = renderHook(() => useForm<Values>({ defaultValues: { name: 'Big Dawgs' } }));

    const props = formPageSave(result.current, mutation(), 'We could not save the league.');

    expect(props.errorMessage).toBeNull();
    expect(props.isPending).toBe(false);
  });

  it('saves the form\'s values on submit', async () => {
    const { result } = renderHook(() => useForm<Values>({ defaultValues: { name: 'Big Dawgs' } }));
    const save = mutation();

    formPageSave(result.current, save, 'We could not save the league.').onSubmit(submitEvent());

    await waitFor(() => expect(save.mutate).toHaveBeenCalledWith({ name: 'Big Dawgs' }));
  });

  it('shows the server\'s reason for a failed save, and the fallback when it gives none', () => {
    const { result } = renderHook(() => useForm<Values>());
    const refused = new ApiError({ error: { code: 'LEAGUE_NAME_TAKEN', message: 'That league name is taken.' } });

    expect(formPageSave(result.current, mutation({ error: refused, isError: true }), 'We could not save the league.').errorMessage)
      .toBe('That league name is taken.');
    expect(formPageSave(result.current, mutation({ error: new ApiError(undefined), isError: true }), 'We could not save the league.').errorMessage)
      .toBe('We could not save the league.');
  });

  it('passes the save\'s pending state through', () => {
    const { result } = renderHook(() => useForm<Values>());
    expect(formPageSave(result.current, mutation({ isPending: true }), 'x').isPending).toBe(true);
  });
});
