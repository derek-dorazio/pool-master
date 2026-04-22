import { API_ROUTES } from '@poolmaster/shared/api-routes';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto';
import { getFunctionalBaseUrl } from './setup';

describe('client log ingestion functional API', () => {
  it('accepts a valid browser log batch without authentication', async () => {
    const response = await fetch(`${getFunctionalBaseUrl()}${API_ROUTES.observability.clientLogs}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Trace-Id': '11111111-1111-4111-8111-111111111111',
        'X-Client-Request-Id': '22222222-2222-4222-8222-222222222222',
      },
      body: JSON.stringify({
        schemaVersion: 1,
        clientTraceId: '11111111-1111-4111-8111-111111111111',
        webappVersion: '1.2.3',
        userAgent: 'functional-test',
        entries: [
          {
            level: 'info',
            action: 'app.loaded',
            msg: 'App loaded',
            ts: '2026-04-22T16:00:00.000Z',
            route: '/',
            sessionId: null,
            userId: null,
            clientRequestId: '33333333-3333-4333-8333-333333333333',
            data: {
              sourcePage: 'home',
            },
          },
        ],
      }),
    });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it('returns the shared error envelope for oversized batches', async () => {
    const response = await fetch(`${getFunctionalBaseUrl()}${API_ROUTES.observability.clientLogs}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schemaVersion: 1,
        clientTraceId: 'trace-oversized',
        webappVersion: '1.2.3',
        userAgent: 'functional-test',
        entries: [
          {
            level: 'info',
            action: 'app.loaded',
            ts: '2026-04-22T16:00:00.000Z',
            data: {
              large: 'x'.repeat(70_000),
            },
          },
        ],
      }),
    });

    expect(response.status).toBe(413);
    expect(ErrorEnvelopeSchema.safeParse(await response.json()).success).toBe(true);
  });
});
