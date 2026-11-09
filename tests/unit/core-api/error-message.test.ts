import { errorMessage } from '../../../packages/core-api/src/core/error-message';

describe('errorMessage', () => {
  it('reads an Error by its message, and any other thrown value as text', () => {
    expect(errorMessage(new Error('database unavailable'))).toBe('database unavailable');
    expect(errorMessage('timed out')).toBe('timed out');
    expect(errorMessage(503)).toBe('503');
  });
});
