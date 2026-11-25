import { act, renderHook } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import { useSectionDialog } from './use-section-dialog';

type Values = { displayName: string };

function renderSectionDialog(valuesNow: () => Values) {
  const mutation = { isPending: false, mutateAsync: vi.fn().mockResolvedValue(undefined), reset: vi.fn() };
  const view = renderHook(() => {
    const form = useForm<Values>({ defaultValues: { displayName: 'Old' } });
    return { form, dialog: useSectionDialog({ form, mutation, valuesNow }) };
  });
  return { view, mutation };
}

describe('useSectionDialog', () => {
  it('opens through the modal on the values as they stand now, with the last failure cleared', () => {
    const { view, mutation } = renderSectionDialog(() => ({ displayName: 'Saved name' }));

    act(() => view.result.current.dialog.modalProps.onOpenChange(true));

    expect(view.result.current.dialog.modalProps.open).toBe(true);
    expect(view.result.current.form.getValues()).toEqual({ displayName: 'Saved name' });
    expect(mutation.reset).toHaveBeenCalledTimes(1);
  });

  it('shuts when the modal reports it closed, as Escape does', () => {
    const { view } = renderSectionDialog(() => ({ displayName: 'Saved name' }));
    act(() => view.result.current.dialog.openDialog());

    act(() => view.result.current.dialog.modalProps.onOpenChange(false));

    expect(view.result.current.dialog.modalProps.open).toBe(false);
  });
});
