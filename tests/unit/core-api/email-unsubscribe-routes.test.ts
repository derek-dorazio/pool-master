import Fastify, { type FastifyInstance } from 'fastify';
import { FASTIFY_AJV_OPTIONS } from '../../../packages/core-api/src/plugins/string-transforms';
import { globalErrorHandler } from '../../../packages/core-api/src/core/error-handler';
import { emailUnsubscribeModule } from '../../../packages/core-api/src/modules/email/email-unsubscribe-routes';
import {
  EmailUnsubscribeLinkInvalidError,
  type EmailPreferencesService,
} from '../../../packages/core-api/src/modules/email/email-preferences-service';

// One-click unsubscribe (#844) on its own, without the request logging context the app adds:
// the request's own logger is handed to the service, a bad link is a 400 and any other failure
// is left to the app's error handler.

const unsubscribe = jest.fn<ReturnType<EmailPreferencesService['unsubscribe']>, Parameters<EmailPreferencesService['unsubscribe']>>();
let app: FastifyInstance;

beforeEach(async () => {
  unsubscribe.mockReset();
  app = Fastify({ logger: false, ajv: FASTIFY_AJV_OPTIONS });
  app.setErrorHandler(globalErrorHandler);
  await app.register(emailUnsubscribeModule, { preferences: { unsubscribe } as unknown as EmailPreferencesService });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

const post = () => app.inject({ method: 'POST', url: '/unsubscribe?token=some-token' });

describe('POST /unsubscribe', () => {
  it('turns off the category the token names, logging on the request logger when no context logger is set', async () => {
    unsubscribe.mockResolvedValue('RECEIPTS');

    const response = await post();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ category: 'RECEIPTS' });
    expect(unsubscribe).toHaveBeenCalledWith('some-token', expect.objectContaining({ warn: expect.any(Function) as unknown }));
  });

  it('accepts a mail app\'s one-click form post, whose body says only List-Unsubscribe=One-Click', async () => {
    unsubscribe.mockResolvedValue('RECEIPTS');

    const response = await app.inject({
      method: 'POST',
      url: '/unsubscribe?token=some-token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'List-Unsubscribe=One-Click',
    });

    expect(response.statusCode).toBe(200);
    expect(unsubscribe).toHaveBeenCalledWith('some-token', expect.anything());
  });

  it('refuses a link this app did not issue with 400 EMAIL_UNSUBSCRIBE_LINK_INVALID', async () => {
    unsubscribe.mockRejectedValue(new EmailUnsubscribeLinkInvalidError());

    const response = await post();

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'EMAIL_UNSUBSCRIBE_LINK_INVALID' } });
  });

  it('leaves any other failure to the app error handler as a 500, not a bad-link 400', async () => {
    unsubscribe.mockRejectedValue(new Error('database down'));

    const response = await post();

    expect(response.statusCode).toBe(500);
  });
});
