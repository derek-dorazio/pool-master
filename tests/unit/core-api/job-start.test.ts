import { JobTrigger } from '@poolmaster/shared/domain';
import {
  currentJobStart,
  JobStartMissingError,
  runWithJobStart,
  runWithJobStartSource,
  SCHEDULE_START,
  SYSTEM_START,
} from '../../../packages/core-api/src/core/job-start';

// The job start scope (#1861): each entry point says what started the work, and a job queued
// where none did throws rather than guessing.

describe('job start scope', () => {
  it('throws JobStartMissingError when no entry point opened a scope', () => {
    expect(() => currentJobStart()).toThrow(JobStartMissingError);
  });

  it('answers the start of the innermost scope, including after an await', async () => {
    await runWithJobStart(SCHEDULE_START, async () => {
      expect(currentJobStart()).toEqual({ trigger: JobTrigger.SCHEDULE });
      await runWithJobStart(SYSTEM_START, async () => {
        await Promise.resolve();
        expect(currentJobStart()).toEqual({ trigger: JobTrigger.SYSTEM });
      });
      expect(currentJobStart()).toEqual({ trigger: JobTrigger.SCHEDULE });
    });
  });

  it('reads a request\'s source when the job is queued, and throws while it says nothing', () => {
    let start: { trigger: typeof JobTrigger.ADMIN; startedByUserId: string } | undefined;
    runWithJobStartSource(() => start, () => {
      expect(() => currentJobStart()).toThrow(JobStartMissingError);
      start = { trigger: JobTrigger.ADMIN, startedByUserId: 'admin-1' };
      expect(currentJobStart()).toEqual({ trigger: JobTrigger.ADMIN, startedByUserId: 'admin-1' });
    });
  });
});
