import type { FastifyInstance } from 'fastify';
import {
  ConsentHistoryResponseSchema,
  ConsentRecordRequestSchema,
  ConsentRecordResponseSchema,
  zodToJsonSchema,
} from '@poolmaster/shared/dto';
import { mapConsentRecordToDto } from '../../mappers';
import { AccountConsentService } from './account-consent-service';
import { getAppPrisma } from '../../core/prisma-context';

export async function accountConsentModule(fastify: FastifyInstance): Promise<void> {
  const prisma = getAppPrisma(fastify);
  const consentService = new AccountConsentService(prisma, fastify.log);

  fastify.post<{ Body: { consentType: string; granted: boolean; version: string; minimumAgeThreshold?: number | null; ageAffirmed?: boolean | null } }>(
    '/consent',
    {
      schema: {
        tags: ['Account'],
        summary: 'Record user consent for a policy type',
        description:
          'Records an authenticated user consent decision for a policy/version pair, including age-affirmation context when applicable.',
        operationId: 'recordConsent',
        response: { 201: zodToJsonSchema(ConsentRecordResponseSchema) },
        body: zodToJsonSchema(ConsentRecordRequestSchema),
      },
    },
    async (request, reply) => {
      const logger = request.contextLogger ?? request.log;
      const userId = request.authUser?.userId as string;
      logger.debug({
        action: 'account.consent.record.request',
        data: {
          userId,
          consentType: request.body.consentType,
          granted: request.body.granted,
          version: request.body.version,
          minimumAgeThreshold: request.body.minimumAgeThreshold ?? null,
          ageAffirmed: request.body.ageAffirmed ?? null,
        },
      }, 'Handling account consent record request');
      const consent = await consentService.recordConsent({
        userId,
        consentType: request.body.consentType,
        granted: request.body.granted,
        version: request.body.version,
        minimumAgeThreshold: request.body.minimumAgeThreshold ?? null,
        ageAffirmed: request.body.ageAffirmed ?? null,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });
      logger.info({
        action: 'account.consent.record.succeeded',
        data: {
          userId,
          consentType: request.body.consentType,
          granted: request.body.granted,
        },
      }, 'Recorded account consent');
      return reply.status(201).send({
        consent: mapConsentRecordToDto(consent as Record<string, unknown>),
      });
    },
  );

  fastify.get('/consent', {
    schema: {
      tags: ['Account'],
      summary: 'Get consent history for current user',
      description:
        'Returns the authenticated user consent history so account and compliance surfaces can show what was agreed and when.',
      operationId: 'getConsentHistory',
      response: { 200: zodToJsonSchema(ConsentHistoryResponseSchema) },
    },
    handler: async (request) => {
      const logger = request.contextLogger ?? request.log;
      const userId = request.authUser?.userId as string;
      logger.debug({
        action: 'account.consent.history.request',
        data: {
          userId,
        },
      }, 'Handling account consent history request');
      const history = await consentService.getConsentHistory(userId);
      logger.info({
        action: 'account.consent.history.succeeded',
        data: {
          userId,
          recordCount: history.length,
        },
      }, 'Loaded account consent history');
      return { consents: history.map((record) => mapConsentRecordToDto(record as Record<string, unknown>)) };
    },
  });
}
