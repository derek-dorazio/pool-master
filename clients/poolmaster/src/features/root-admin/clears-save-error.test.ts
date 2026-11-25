import { describe, expect, it, vi } from 'vitest';
import { clearsSaveError } from './clears-save-error';

describe('clearsSaveError', () => {
  it('clears a failed save once the admin types again', () => {
    const reset = vi.fn();

    clearsSaveError({ isError: true, reset })();

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('leaves a save that has not failed alone, so a success toast already showing stays', () => {
    const reset = vi.fn();

    clearsSaveError({ isError: false, reset })();

    expect(reset).not.toHaveBeenCalled();
  });
});
