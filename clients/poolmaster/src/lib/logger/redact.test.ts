import { describe, expect, it } from 'vitest';
import { redactPayload } from './redact';

describe('redact payload', () => {
  it('redacts sensitive keys at the top level', () => {
    const redacted = redactPayload({
      action: 'auth.login',
      data: {
        password: 'secret',
        authorization: 'Bearer token',
        keep: 'value',
      },
    });

    expect(redacted).toEqual({
      action: 'auth.login',
      data: {
        password: '[REDACTED]',
        authorization: '[REDACTED]',
        keep: 'value',
      },
    });
  });

  it('redacts nested objects and arrays', () => {
    const redacted = redactPayload({
      action: 'account.update',
      data: {
        nested: {
          refreshToken: 'refresh-secret',
        },
        items: [
          {
            cookie: 'sensitive-cookie',
          },
        ],
      },
    });

    expect(redacted).toEqual({
      action: 'account.update',
      data: {
        nested: {
          refreshToken: '[REDACTED]',
        },
        items: [
          {
            cookie: '[REDACTED]',
          },
        ],
      },
    });
  });

  it('serializes and redacts error objects', () => {
    const error = new Error('boom');
    const redacted = redactPayload({
      action: 'app.error',
      err: error,
    });

    expect(redacted.err).toMatchObject({
      name: 'Error',
      message: 'boom',
    });
  });

  it('passes through primitive payload values unchanged', () => {
    const redacted = redactPayload({
      action: 'contest.load',
      err: 'bad request',
    });

    expect(redacted).toEqual({
      action: 'contest.load',
      err: 'bad request',
    });
  });
});
