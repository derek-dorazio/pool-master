import { z } from 'zod';
import { JobErrorType } from '@poolmaster/shared/domain';
import { jobErrorTypeOf, jobErrorTypeOfStatus } from '../../../packages/core-api/src/modules/background-jobs/job-error-type';
import {
  BalldontlieContractError,
  BalldontlieRequestError,
} from '../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-client';
import { ProviderLeagueRefusedError } from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';

// The kind of failure a job's error is, for Activity's Error column (#1861).

function named(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

describe('job error type', () => {
  it('reads a provider\'s status: 429 is RATE_LIMITED, any other error status PROVIDER_ERROR', () => {
    expect(jobErrorTypeOfStatus(429)).toBe(JobErrorType.RATE_LIMITED);
    expect(jobErrorTypeOfStatus(503)).toBe(JobErrorType.PROVIDER_ERROR);
  });

  it('classifies a BALLDONTLIE request error by its status, and one with no answer as TIMEOUT only when the request timed out', () => {
    expect(jobErrorTypeOf(new BalldontlieRequestError('/a', 429, 'slow down'))).toBe(JobErrorType.RATE_LIMITED);
    expect(jobErrorTypeOf(new BalldontlieRequestError('/a', 502, 'bad gateway'))).toBe(JobErrorType.PROVIDER_ERROR);
    expect(jobErrorTypeOf(new BalldontlieRequestError('/a', null, 'timed out', { cause: named('TimeoutError') }))).toBe(JobErrorType.TIMEOUT);
    expect(jobErrorTypeOf(new BalldontlieRequestError('/a', null, 'reset', { cause: new Error('ECONNRESET') }))).toBe(JobErrorType.PROVIDER_ERROR);
  });

  it('classifies a response that broke the provider\'s contract as BAD_DATA, and a refused league as PROVIDER_ERROR', () => {
    expect(jobErrorTypeOf(new BalldontlieContractError('/a', ['missing id']))).toBe(JobErrorType.BAD_DATA);
    expect(jobErrorTypeOf(new ProviderLeagueRefusedError('BALLDONTLIE', 'NBA', 403))).toBe(JobErrorType.PROVIDER_ERROR);
  });

  it('reads the cause chain: an aborted fetch is TIMEOUT and a schema failure BAD_DATA, however deep', () => {
    expect(jobErrorTypeOf(named('AbortError'))).toBe(JobErrorType.TIMEOUT);
    expect(jobErrorTypeOf(new Error('sync failed', { cause: new Error('read failed', { cause: named('TimeoutError') }) }))).toBe(JobErrorType.TIMEOUT);
    const schemaFailure = z.object({ id: z.string() }).safeParse({}).error;
    expect(jobErrorTypeOf(new Error('bad payload', { cause: schemaFailure }))).toBe(JobErrorType.BAD_DATA);
  });

  it('calls anything else OTHER, including a value that is not an error and a cycle of causes', () => {
    const looped = new Error('first');
    looped.cause = new Error('second', { cause: looped });
    expect(jobErrorTypeOf(new Error('boom'))).toBe(JobErrorType.OTHER);
    expect(jobErrorTypeOf('boom')).toBe(JobErrorType.OTHER);
    expect(jobErrorTypeOf(looped)).toBe(JobErrorType.OTHER);
  });
});
