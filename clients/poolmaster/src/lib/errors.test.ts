import { describe, expect, it } from 'vitest';
import { ApiError, extractErrorMessage, hasErrorCode, isErrorEnvelope, throwApiError, type ErrorCodeMessages } from './errors';

function caught(run: () => never): Error {
  try {
    run();
  } catch (err) {
    if (err instanceof Error) {
      return err;
    }
    throw new Error(`expected an Error to be thrown, got ${String(err)}`);
  }
}

describe('isErrorEnvelope', () => {
  it('accepts the backend envelope with code, message and optional details', () => {
    expect(isErrorEnvelope({ error: { code: 'NOT_FOUND', message: 'League not found.' } })).toBe(true);
    expect(isErrorEnvelope({ error: { code: 'X', message: 'm', details: { field: 'name' } } })).toBe(true);
  });

  it('rejects payloads missing the nested error, its code, or its message', () => {
    expect(isErrorEnvelope(null)).toBe(false);
    expect(isErrorEnvelope('<html>Bad gateway</html>')).toBe(false);
    expect(isErrorEnvelope({ code: 'INTERNAL', message: 'top-level fields are not the envelope' })).toBe(false);
    expect(isErrorEnvelope({ error: { code: 'INTERNAL' } })).toBe(false);
    expect(isErrorEnvelope({ error: { message: 'no code' } })).toBe(false);
  });
});

describe('ApiError', () => {
  it('takes message, code and details from a backend error envelope and marks the message as the backend\'s own', () => {
    const err = new ApiError({ error: { code: 'NOT_FOUND', message: 'League not found.', details: { field: 'name' } } });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('League not found.');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.details).toEqual({ field: 'name' });
    expect(err.hasOwnMessage).toBe(true);
  });

  it('leaves code unset and uses the throw site fallback as a non-own message when the payload is not an envelope', () => {
    const err = new ApiError({ code: 'INTERNAL' }, 'League detail response is missing data.');
    expect(err.message).toBe('League detail response is missing data.');
    expect(err.code).toBeUndefined();
    expect(err.hasOwnMessage).toBe(false);
  });

  it('uses the generic default message when neither an envelope nor a fallback is given', () => {
    expect(new ApiError(undefined).message).toBe('Something went wrong. Please try again.');
  });
});

describe('extractErrorMessage', () => {
  it('returns the codeMessages copy for an ApiError whose code is mapped', () => {
    const err = new ApiError({ error: { code: 'EVENT_YEAR_NOT_EMPTY', message: 'Year has events.' } });
    expect(
      extractErrorMessage(err, {
        codeMessages: { EVENT_YEAR_NOT_EMPTY: 'This tour already has tournaments in 2027.' },
      }),
    ).toBe('This tour already has tournaments in 2027.');
  });

  it('returns the backend message for an ApiError whose code is not mapped', () => {
    const err = new ApiError({ error: { code: 'OTHER', message: 'Backend says no.' } });
    expect(extractErrorMessage(err, { codeMessages: { EVENT_YEAR_NOT_EMPTY: 'x' } })).toBe('Backend says no.');
  });

  it('refuses at typecheck copy keyed by a code the API never sends, such as a misspelled one', () => {
    const messages: ErrorCodeMessages = {
      // @ts-expect-error -- a misspelling of EVENT_YEAR_NOT_EMPTY is not one of the API's error codes
      EVENT_YEAR_NOT_EMTPY: 'This tour already has tournaments in 2027.',
    };
    const err = new ApiError({ error: { code: 'EVENT_YEAR_NOT_EMPTY', message: 'Year has events.' } });
    expect(extractErrorMessage(err, { codeMessages: messages })).toBe('Year has events.');
  });

  it('returns the caller fallback, not the throw site diagnostic, for an ApiError built from a non-envelope payload', () => {
    const err = new ApiError({ code: 'INTERNAL' }, 'Clone year response is missing data.');
    expect(extractErrorMessage(err, { fallback: 'We could not clone this year.' })).toBe('We could not clone this year.');
  });

  it('returns a plain Error\'s message, or the fallback when that message is empty', () => {
    expect(extractErrorMessage(new TypeError('Failed to fetch'))).toBe('Failed to fetch');
    expect(extractErrorMessage(new Error(''), { fallback: 'Try later.' })).toBe('Try later.');
  });

  it('returns the fallback, or the generic default, for null and undefined', () => {
    expect(extractErrorMessage(null, { fallback: 'Try later.' })).toBe('Try later.');
    expect(extractErrorMessage(undefined)).toBe('Something went wrong. Please try again.');
  });
});

describe('hasErrorCode', () => {
  it('matches the code on an ApiError and on a raw backend error envelope', () => {
    const envelope = { error: { code: 'SETTINGS_CONFLICT', message: 'Settings changed.' } };
    expect(hasErrorCode(new ApiError(envelope), 'SETTINGS_CONFLICT')).toBe(true);
    expect(hasErrorCode(envelope, 'SETTINGS_CONFLICT')).toBe(true);
  });

  it('does not match a different code, a plain Error, or a payload that is not an envelope', () => {
    const envelope = { error: { code: 'SETTINGS_CONFLICT', message: 'Settings changed.' } };
    expect(hasErrorCode(new ApiError(envelope), 'LIVE_SIMULATION_NOT_RUNNING')).toBe(false);
    expect(hasErrorCode(new Error('SETTINGS_CONFLICT'), 'SETTINGS_CONFLICT')).toBe(false);
    expect(hasErrorCode(undefined, 'SETTINGS_CONFLICT')).toBe(false);
  });

  it('refuses at typecheck a code the API never sends, such as a misspelled one', () => {
    // @ts-expect-error -- not one of the API's error codes
    expect(hasErrorCode(new Error('x'), 'SETTINGS_CONFLICTED')).toBe(false);
  });
});

describe('throwApiError', () => {
  it('throws an ApiError carrying the backend message for an error envelope', () => {
    const err = caught(() => throwApiError({ error: { code: 'X', message: 'boom' } }));
    expect(err).toBeInstanceOf(ApiError);
    expect(extractErrorMessage(err)).toBe('boom');
  });

  it('re-throws an already-real Error unchanged instead of double-wrapping it', () => {
    const original = new TypeError('Failed to fetch');
    expect(caught(() => throwApiError(original))).toBe(original);
  });

  it('throws a plain Error with the fallback message when there is no payload', () => {
    const err = caught(() => throwApiError(null, 'Contest list response is missing data.'));
    expect(err).not.toBeInstanceOf(ApiError);
    expect(extractErrorMessage(err)).toBe('Contest list response is missing data.');
  });
});
