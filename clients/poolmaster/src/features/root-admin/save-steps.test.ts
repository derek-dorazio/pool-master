import { describe, expect, it, vi } from 'vitest';
import { PartialSaveError, runSaveSteps } from './save-steps';

describe('runSaveSteps', () => {
  it('runs every step in order', async () => {
    const order: string[] = [];
    await runSaveSteps([
      { what: 'name', run: () => { order.push('name'); return Promise.resolve(); } },
      { what: 'role', run: () => { order.push('role'); return Promise.resolve(); } },
    ]);
    expect(order).toEqual(['name', 'role']);
  });

  it('passes the first step\'s own error through, since nothing was saved', async () => {
    const refused = new Error('Refused');
    const second = vi.fn(() => Promise.resolve());
    await expect(runSaveSteps([{ what: 'name', run: () => Promise.reject(refused) }, { what: 'role', run: second }])).rejects.toBe(refused);
    expect(second).not.toHaveBeenCalled();
  });

  it('names what was saved and what was not when a later step fails', async () => {
    const error = await runSaveSteps([
      { what: 'plan', run: () => Promise.resolve() },
      { what: 'name', run: () => Promise.resolve() },
      { what: 'preview end', run: () => Promise.reject(new Error('Gone')) },
    ]).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PartialSaveError);
    expect((error as PartialSaveError).message).toBe('Saved the plan and the name, but not the preview end: Gone');
  });

  it('says the step was refused when its failure is not an Error', async () => {
    const error = await runSaveSteps([
      { what: 'name', run: () => Promise.resolve() },
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the case under test
      { what: 'role', run: () => Promise.reject('nope') },
    ]).catch((caught: unknown) => caught);
    expect((error as PartialSaveError).message).toBe('Saved the name, but not the role: it was refused');
  });
});
