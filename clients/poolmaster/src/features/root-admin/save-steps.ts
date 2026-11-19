/**
 * A Save that takes more than one write (#1883): a name then a role, a plan then a preview end.
 * The writes run in order. When one fails after another went through, the error says what was
 * saved and what was not, so the dialog never shows a plain failure for a half-applied save.
 */
export type SaveStep = { what: string; run: () => Promise<void> };

/** The save went part way: `saved` went through, then `failed` was refused. */
export class PartialSaveError extends Error {
  constructor(
    readonly saved: readonly string[],
    readonly failed: string,
    cause: unknown,
  ) {
    const reason = cause instanceof Error ? cause.message : 'it was refused';
    super(`Saved the ${saved.join(' and the ')}, but not the ${failed}: ${reason}`, { cause });
    this.name = 'PartialSaveError';
  }
}

export async function runSaveSteps(steps: readonly SaveStep[]): Promise<void> {
  const saved: string[] = [];
  for (const step of steps) {
    try {
      await step.run();
    } catch (error) {
      if (saved.length === 0) throw error;
      throw new PartialSaveError(saved, step.what, error);
    }
    saved.push(step.what);
  }
}
