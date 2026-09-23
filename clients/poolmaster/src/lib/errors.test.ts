import { describe, expect, it } from 'vitest';
import { ApiError, extractErrorMessage, throwApiError } from './errors';

describe('rule: ApiError wraps SDK error envelopes as real Errors', () => {
  it('extracts the envelope message and code', () => {
    const err = new ApiError({ error: { code: 'NOT_FOUND', message: 'League not found.' } });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('League not found.');
    expect(err.code).toBe('NOT_FOUND');
  });

  it('falls back to the provided fallback message when the envelope has none', () => {
    const err = new ApiError({}, 'League detail response is missing data.');
    expect(err.message).toBe('League detail response is missing data.');
    expect(err.code).toBeUndefined();
  });

  it('falls back to the default message when neither the envelope nor a fallback has text', () => {
    const err = new ApiError(undefined);
    expect(err.message).toBe('Something went wrong. Please try again.');
  });

  it('carries details through from the envelope', () => {
    const err = new ApiError({ error: { code: 'X', message: 'm', details: { field: 'name' } } });
    expect(err.details).toEqual({ field: 'name' });
  });
});

describe('rule: throwApiError normalizes SDK response.error into a real Error', () => {
  it('throws an ApiError built from a plain envelope object', () => {
    expect(() => throwApiError({ error: { code: 'X', message: 'boom' } })).toThrow(ApiError);
    try {
      throwApiError({ error: { code: 'X', message: 'boom' } });
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect(extractErrorMessage(err)).toBe('boom');
    }
  });

  it('re-throws an already-real Error unchanged instead of double-wrapping it', () => {
    const original = new TypeError('Failed to fetch');
    try {
      throwApiError(original);
      throw new Error('unreachable');
    } catch (err) {
      expect(err).toBe(original);
    }
  });

  it('uses the fallback message when the payload has no usable message', () => {
    try {
      throwApiError(null, 'Contest list response is missing data.');
      throw new Error('unreachable');
    } catch (err) {
      expect(extractErrorMessage(err)).toBe('Contest list response is missing data.');
    }
  });

  it('does not let the throw site\'s diagnostic fallback shadow the catch site\'s own fallback for an unmapped error code', () => {
    // Regression: an envelope with a code but no message used to surface the
    // throw site's "<X> response is missing data" text instead of the
    // catch site's generic copy, because that text got baked into the
    // thrown Error's `.message` and extractErrorMessage's plain-object
    // duck-typing treats any `.message` string as the real thing.
    try {
      throwApiError({ code: 'INTERNAL' }, 'Clone season response is missing data.');
      throw new Error('unreachable');
    } catch (err) {
      expect(
        extractErrorMessage(err, { fallback: 'We could not clone this season.' }),
      ).toBe('We could not clone this season.');
    }
  });

  it('still resolves a codeMessages mapping for a payload with a code but no message', () => {
    try {
      throwApiError(
        { code: 'SEASON_YEAR_ALREADY_EXISTS' },
        'Clone season response is missing data.',
      );
      throw new Error('unreachable');
    } catch (err) {
      expect(
        extractErrorMessage(err, {
          codeMessages: { SEASON_YEAR_ALREADY_EXISTS: 'This tour already has a 2027 season.' },
          fallback: 'We could not clone this season.',
        }),
      ).toBe('This tour already has a 2027 season.');
    }
  });
});
