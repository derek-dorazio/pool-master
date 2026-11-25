import { describe, expect, it } from 'vitest';
import { displayString } from '@poolmaster/shared/display-strings';
import { ApiError, errorCodeMessage, extractErrorMessage, hasErrorCode, isErrorEnvelope, throwApiError } from './errors';

function caught(run: () => never): Error {
  try {
    run();
  } catch (err) {
    if (err instanceof Error) {
      return err;
    }
    throw new Error(`expected an Error to be thrown, got ${String(err)}`, { cause: err });
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
  it('takes message, code and details from a backend error envelope', () => {
    const err = new ApiError({ error: { code: 'NOT_FOUND', message: 'League not found.', details: { field: 'name' } } });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('League not found.');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.details).toEqual({ field: 'name' });
  });

  it('leaves code unset and uses the throw site fallback as its message when the payload is not an envelope', () => {
    const err = new ApiError({ code: 'INTERNAL' }, 'League detail response is missing data.');
    expect(err.message).toBe('League detail response is missing data.');
    expect(err.code).toBeUndefined();
  });

  it('uses the generic default message when neither an envelope nor a fallback is given', () => {
    expect(new ApiError(undefined).message).toBe('Something went wrong. Please try again.');
  });
});

describe('extractErrorMessage', () => {
  it('shows the code\'s display string, never the backend\'s own message', () => {
    const err = new ApiError({ error: { code: 'CONTEST_FULL', message: 'contest 42 is at capacity (50/50)' } });
    expect(extractErrorMessage(err)).toBe('This contest is full.');
    expect(extractErrorMessage(err)).toBe(displayString('error.CONTEST_FULL'));
  });

  it('shows the screen\'s context wording for a code it words, with the screen\'s words in its placeholders', () => {
    const err = new ApiError({ error: { code: 'BRACKET_MATCH_NOT_FOUND', message: 'Match m-1 is not in event e-1.' } });
    expect(extractErrorMessage(err, {
      context: 'bracketAdmin',
      values: { match: 'game' },
    })).toBe('That game is no longer in the bracket. Refresh the page.');
  });

  it('shows the code\'s own display string when the screen\'s context has no wording for that code', () => {
    const err = new ApiError({ error: { code: 'CONTEST_FULL', message: 'Full.' } });
    expect(extractErrorMessage(err, { context: 'createEvent' })).toBe('This contest is full.');
  });

  it('tries a screen\'s contexts in order, so the first with wording for the code wins', () => {
    const notPriced = new ApiError({ error: { code: 'CONTEST_EVENT_NOT_PRICED', message: 'x' } });
    const locked = new ApiError({ error: { code: 'CONTEST_EVENTS_LOCKED', message: 'x' } });
    const context = ['contestEvents', 'contestSetup'] as const;
    expect(extractErrorMessage(notPriced, { context })).toBe('This event’s field has no prices yet, so it cannot hold a budget contest.');
    expect(extractErrorMessage(locked, { context })).toBe('An event in this contest has started, so its events can no longer be removed.');
  });

  it('refuses at typecheck a context no screen wording names, such as a misspelled one', () => {
    const err = new ApiError({ error: { code: 'CONTEST_FULL', message: 'Full.' } });
    // @ts-expect-error -- not an error context in the display strings
    expect(extractErrorMessage(err, { context: 'leagueYears' })).toBe('This contest is full.');
  });

  it('shows the caller fallback, not the backend message, for a code this build does not know', () => {
    const err = new ApiError({ error: { code: 'A_CODE_FROM_A_NEWER_API', message: 'Backend says no.' } });
    expect(extractErrorMessage(err, { fallback: 'We could not save that.' })).toBe('We could not save that.');
    expect(extractErrorMessage(err)).toBe('Something went wrong. Please try again.');
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

describe('errorCodeMessage', () => {
  it('gives a code\'s words with no error in hand, from the screen\'s context first', () => {
    expect(errorCodeMessage('CONTEST_FULL')).toBe('This contest is full.');
    expect(errorCodeMessage('RACE_RESULT_ROWS_INVALID', { context: 'raceResult', values: { participant: 'driver' } }))
      .toBe('A row does not match one driver in the field, or has a problem. Preview again to see which.');
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
    expect(hasErrorCode(new ApiError(envelope), 'SPORT_EVENT_NOT_FOUND')).toBe(false);
    expect(hasErrorCode(new Error('SETTINGS_CONFLICT'), 'SETTINGS_CONFLICT')).toBe(false);
    expect(hasErrorCode(undefined, 'SETTINGS_CONFLICT')).toBe(false);
  });

  it('refuses at typecheck a code the API never sends, such as a misspelled one', () => {
    // @ts-expect-error -- not one of the API's error codes
    expect(hasErrorCode(new Error('x'), 'SETTINGS_CONFLICTED')).toBe(false);
  });
});

describe('throwApiError', () => {
  it('throws an ApiError carrying the backend code and message for an error envelope', () => {
    const err = caught(() => throwApiError({ error: { code: 'CONTEST_FULL', message: 'boom' } }));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('boom');
    expect(extractErrorMessage(err)).toBe('This contest is full.');
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
