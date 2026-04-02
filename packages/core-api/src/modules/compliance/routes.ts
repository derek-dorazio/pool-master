/**
 * Compliance module — consent, data export, deletion, self-exclusion, enforcement.
 */

import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { zodToJsonSchema, SuccessSchema } from '@poolmaster/shared/dto';
import { ComplianceService, verifyAge } from './compliance-service';

export async function complianceModule(fastify: FastifyInstance): Promise<void> {
  const prisma = new PrismaClient();
  const complianceService = new ComplianceService(prisma);

  // --- Age Verification ---

  fastify.post<{ Body: { birthYear: number } }>(
    '/verify-age',
    {
      schema: {
        tags: ['Account'],
        summary: 'Verify user meets minimum age requirement',
        operationId: 'verifyAge',
        response: { 200: zodToJsonSchema(SuccessSchema) },
        body: {
          type: 'object',
          required: ['birthYear'],
          properties: { birthYear: { type: 'integer', minimum: 1900, maximum: 2025 } },
        },
      },
    },
    async (request) => verifyAge(request.body.birthYear),
  );

  // --- Consent ---

  fastify.post<{ Body: { consentType: string; granted: boolean; version: string } }>(
    '/consent',
    {
      schema: {
        tags: ['Account'],
        summary: 'Record user consent for a policy type',
        operationId: 'recordConsent',
        response: { 201: zodToJsonSchema(SuccessSchema) },
        body: {
          type: 'object',
          required: ['consentType', 'granted', 'version'],
          properties: {
            consentType: { type: 'string', enum: ['terms_of_service', 'privacy_policy', 'marketing_email', 'analytics_cookies'] },
            granted: { type: 'boolean' },
            version: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = request.headers['x-user-id'] as string;
      await complianceService.recordConsent({
        userId,
        consentType: request.body.consentType,
        granted: request.body.granted,
        version: request.body.version,
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
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: async (request) => {
      const userId = request.headers['x-user-id'] as string;
      const history = await complianceService.getConsentHistory(userId);
      return { consents: history };
    },
  });

  // --- Data Export ---

  fastify.post('/data-export', {
    schema: {
      tags: ['Account'],
      summary: 'Request personal data export (GDPR)',
      operationId: 'requestDataExport',
      response: { 202: zodToJsonSchema(SuccessSchema) },
    },
    handler: async (request, reply) => {
      const userId = request.headers['x-user-id'] as string;
      const id = await complianceService.requestDataExport(userId);
      return reply.status(202).send({ requestId: id, message: 'Export request accepted' });
    },
  });

  fastify.get<{ Params: { id: string } }>('/data-export/:id', {
    schema: {
      tags: ['Account'],
      summary: 'Get data export status and download',
      operationId: 'getDataExport',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: async (request) => {
      return complianceService.processDataExport(request.params.id);
    },
  });

  // --- Account Deletion ---

  fastify.post<{ Body: { reason?: string } }>('/delete-account', {
    schema: {
      tags: ['Account'],
      summary: 'Request account deletion',
      operationId: 'requestAccountDeletion',
      response: { 202: zodToJsonSchema(SuccessSchema) },
    },
    handler: async (request, reply) => {
      const userId = request.headers['x-user-id'] as string;
      const id = await complianceService.requestDeletion(userId, request.body.reason);
      return reply.status(202).send({
        requestId: id,
        message: 'Deletion scheduled in 14 days. You can cancel before then.',
      });
    },
  });

  fastify.post<{ Params: { id: string } }>('/delete-account/:id/cancel', {
    schema: {
      tags: ['Account'],
      summary: 'Cancel a pending account deletion',
      operationId: 'cancelAccountDeletion',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: async (request) => {
      await complianceService.cancelDeletion(request.params.id);
      return { success: true, message: 'Deletion cancelled' };
    },
  });

  // --- Self-Exclusion ---

  fastify.post<{ Body: { type: string; duration: string } }>(
    '/self-exclusion',
    {
      schema: {
        tags: ['Account'],
        summary: 'Create self-exclusion or cool-down period',
        operationId: 'createSelfExclusion',
        response: { 201: zodToJsonSchema(SuccessSchema) },
        body: {
          type: 'object',
          required: ['type', 'duration'],
          properties: {
            type: { type: 'string', enum: ['COOL_DOWN', 'SELF_EXCLUSION'] },
            duration: { type: 'string', enum: ['24H', '7D', '30D', '6M', '1Y', 'INDEFINITE'] },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = request.headers['x-user-id'] as string;
      const id = await complianceService.createSelfExclusion(
        userId,
        request.body.type as 'COOL_DOWN' | 'SELF_EXCLUSION',
        request.body.duration,
      );
      return reply.status(201).send({ exclusionId: id });
    },
  );

  fastify.get('/self-exclusion', {
    schema: {
      tags: ['Account'],
      summary: 'Get active self-exclusion status',
      operationId: 'getActiveExclusion',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: async (request) => {
      const userId = request.headers['x-user-id'] as string;
      const exclusion = await complianceService.getActiveExclusion(userId);
      return { exclusion };
    },
  });

  // --- Enforcement (admin) ---

  fastify.post<{
    Body: {
      userId: string;
      level: string;
      reason: string;
      trigger: string;
      durationDays?: number;
    };
  }>(
    '/enforcement',
    {
      schema: {
        tags: ['Account'],
        summary: 'Create enforcement action against a user',
        operationId: 'createEnforcementAction',
        response: { 201: zodToJsonSchema(SuccessSchema) },
        body: {
          type: 'object',
          required: ['userId', 'level', 'reason', 'trigger'],
          properties: {
            userId: { type: 'string' },
            level: { type: 'string', enum: ['WARNING', 'TEMPORARY_SUSPENSION', 'PERMANENT_BAN'] },
            reason: { type: 'string' },
            trigger: { type: 'string' },
            durationDays: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const enforcedBy = request.headers['x-user-id'] as string;
      const id = await complianceService.enforceAction({
        ...request.body,
        level: request.body.level as 'WARNING' | 'TEMPORARY_SUSPENSION' | 'PERMANENT_BAN',
        enforcedBy,
      });
      return reply.status(201).send({ enforcementId: id });
    },
  );

  fastify.get<{ Params: { userId: string } }>('/enforcement/:userId', {
    schema: {
      tags: ['Account'],
      summary: 'Get enforcement history for a user',
      operationId: 'getEnforcementHistory',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: async (request) => {
      const history = await complianceService.getEnforcementHistory(request.params.userId);
      return { enforcement: history };
    },
  });

  fastify.put<{ Params: { id: string }; Body: { status: string } }>(
    '/enforcement/:id/appeal',
    {
      schema: {
        tags: ['Account'],
        summary: 'Update enforcement appeal status',
        operationId: 'updateAppealStatus',
        response: { 200: zodToJsonSchema(SuccessSchema) },
      },
    },
    async (request) => {
      await complianceService.updateAppealStatus(
        request.params.id,
        request.body.status as 'PENDING' | 'GRANTED' | 'DENIED',
      );
      return { success: true };
    },
  );

  // --- Retention Cleanup (admin/cron trigger) ---

  fastify.post('/retention/cleanup', {
    schema: {
      tags: ['Account'],
      summary: 'Trigger retention data cleanup',
      operationId: 'runRetentionCleanup',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: async () => {
      return complianceService.runRetentionCleanup();
    },
  });
}
