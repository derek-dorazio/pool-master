import { errorMessage, errorMessageWithCause } from '../../../packages/core-api/src/core/error-message';

describe('errorMessage', () => {
  it('reads an Error by its message, and any other thrown value as text', () => {
    expect(errorMessage(new Error('database unavailable'))).toBe('database unavailable');
    expect(errorMessage('timed out')).toBe('timed out');
    expect(errorMessage(503)).toBe('503');
  });
});

describe('errorMessageWithCause', () => {
  it('follows an Error\'s message with its cause\'s message, so a generic transport error says what went wrong', () => {
    const error = new Error('send failed', { cause: new Error('connection refused') });
    expect(errorMessageWithCause(error)).toBe('send failed: connection refused');
  });

  it('reads an Error with no Error cause by its message alone, and any other thrown value as text', () => {
    expect(errorMessageWithCause(new Error('database unavailable'))).toBe('database unavailable');
    expect(errorMessageWithCause(new Error('database unavailable', { cause: 'socket closed' }))).toBe('database unavailable');
    expect(errorMessageWithCause('timed out')).toBe('timed out');
    expect(errorMessageWithCause(503)).toBe('503');
  });
});
