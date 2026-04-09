import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import {
  ConsentHistoryResponseSchema,
  ConsentRecordResponseSchema,
  zodToJsonSchema,
} from '@poolmaster/shared/dto';
import { mapConsentRecordToDto } from '../../mappers';
import { AccountConsentService } from './account-consent-service';

export async function accountConsentModule(fastify: FastifyInstance): Promise<void> {
  const prisma = new PrismaClient();
  const consentService = new AccountConsentService(prisma);

  fastify.post<{ Body: { consentType: string; granted: boolean; version: string; minimumAgeThreshold?: number | null; ageAffirmed?: boolean | null } }>(
    '/consent',
    {
      schema: {
        tags: ['Account'],
        summary: 'Record user consent for a policy type',
        operationId: 'recordConsent',
        response: { 201: zodToJsonSchema(ConsentRecordResponseSchema) },
        body: {
          type: 'object',
          required: ['consentType', 'granted', 'version'],
          properties: {
            consentType: { type: 'string' },
            granted: { type: 'boolean' },
            version: { type: 'string' },
            minimumAgeThreshold: { type: 'integer', minimum: 13, maximum: 18 },
            ageAffirmed: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = request.headers['x-user-id'] as string;
      await consentService.recordConsent({
        userId,
        consentType: request.body.consentType,
        granted: request.body.granted,
        version: request.body.version,
        minimumAgeThreshold: request.body.minimumAgeThreshold ?? null,
        ageAffirmed: request.body.ageAffirmed ?? null,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });
      return reply.status(201).send({ success: true });
    },
  );

  fastify.get('/consent', {
    schema: {
      tags: ['Account'],
      summary: 'Get consent history for current user',
      operationId: 'getConsentHistory',
      response: { 200: zodToJsonSchema(ConsentHistoryResponseSchema) },
    },
    handler: async (request) => {
      const userId = request.headers['x-user-id'] as string;
      const history = await consentService.getConsentHistory(userId);
      return { consents: history.map((record) => mapConsentRecordToDto(record as Record<string, unknown>)) };
    },
  });
}
