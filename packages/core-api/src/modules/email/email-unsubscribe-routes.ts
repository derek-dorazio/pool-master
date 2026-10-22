/**
 * One-click unsubscribe (#844 slice 5, plans/email-delivery-ses.md §7):
 *   POST /unsubscribe?token= — public; the token is its whole authority
 *
 * Mail apps post here from an email's List-Unsubscribe header (RFC 8058, body
 * `List-Unsubscribe=One-Click`), and the "Stop these emails" page posts here when the person
 * confirms. It is a POST so that a link scanner fetching the URL unsubscribes nobody.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { EmailUnsubscribeQuery } from '@poolmaster/shared/dto';
// Registers ErrorEnvelope, which this module's responses $ref (#192).
import '@poolmaster/shared/dto/errors.dto';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
// Registers the named components this module's routes $ref (#192).
import '@poolmaster/shared/dto/email-preferences.dto';
import { sendError } from '../../core/error-handler';
import { EmailUnsubscribeLinkInvalidError, type EmailPreferencesService } from './email-preferences-service';

export interface EmailUnsubscribeModuleOptions {
  preferences: EmailPreferencesService;
}

export function emailUnsubscribeModule(fastify: FastifyInstance, opts: EmailUnsubscribeModuleOptions): void {
  void fastify.register(schemaComponentsPlugin);

  // A one-click unsubscribe posts a form body that says only "List-Unsubscribe=One-Click".
  fastify.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
    done(null, body);
  });

  fastify.post<{ Querystring: EmailUnsubscribeQuery }>('/unsubscribe', {
    schema: {
      tags: ['Email'],
      summary: 'Unsubscribe from one category of email by its link',
      description:
        'Public; the token from an email\'s "Stop these emails" link or List-Unsubscribe header is its whole authority. It turns off the category of email the token names for the user it names, the same switch as on their account. Repeating it changes nothing. A token this app did not issue, or one for an account since deleted, is 400 EMAIL_UNSUBSCRIBE_LINK_INVALID.',
      operationId: 'unsubscribeFromEmail',
      querystring: schemaRef('EmailUnsubscribeQuery'),
      response: {
        200: schemaRef('EmailUnsubscribeResponse'),
        400: schemaRef('ErrorEnvelope'),
      },
    },
  }, async (request: FastifyRequest<{ Querystring: EmailUnsubscribeQuery }>, reply: FastifyReply) => {
    const logger = request.contextLogger ?? request.log;
    try {
      const category = await opts.preferences.unsubscribe(request.query.token, logger);
      return reply.status(200).send({ category });
    } catch (err) {
      if (err instanceof EmailUnsubscribeLinkInvalidError) {
        return sendError(reply, 400, err.code, err.message);
      }
      throw err;
    }
  });
}
