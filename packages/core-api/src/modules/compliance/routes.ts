/**
 * Compliance module — consent, data export, deletion, self-exclusion, enforcement.
 */

import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import {
  zodToJsonSchema,
} from '@poolmaster/shared/dto';
const complianceDtoModule = require('../../../../shared/dto/compliance.dto.ts') as typeof import('../../../../shared/dto/compliance.dto');
const {
  ActivityLimitResponseSchema,
  ActivityLimitUpdateRequestSchema,
  AgeVerificationResponseSchema,
  ConsentHistoryResponseSchema,
  DataExportAcceptedResponseSchema,
  DataExportResponseSchema,
  DataExportStatusResponseSchema,
  AccountDeletionAcceptedResponseSchema,
  AccountDeletionStatusResponseSchema,
  AccountDeletionCancelledResponseSchema,
  SelfExclusionCreatedResponseSchema,
  SelfExclusionDurationSchema,
  ActiveExclusionResponseSchema,
  SessionReminderResponseSchema,
  SessionReminderUpdateRequestSchema,
  EnforcementCreatedResponseSchema,
  EnforcementHistoryResponseSchema,
  RetentionCleanupResponseSchema,
} = complianceDtoModule;
import { ComplianceService, verifyAge } from './compliance-service';
import {
  mapConsentRecordToDto,
  mapEnforcementActionToDto,
  mapSelfExclusionToDto,
} from '../../mappers';

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
        response: { 200: zodToJsonSchema(AgeVerificationResponseSchema) },
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
        response: { 201: { type: 'object', properties: { success: { type: 'boolean' } }, required: ['success'] } },
        body: {
          type: 'object',
          required: ['consentType', 'granted', 'version'],
          properties: {
            consentType: {
              type: 'string',
              enum: [
                'terms_of_service',
                'privacy_policy',
                'marketing_email',
                'analytics_cookies',
                'third_party_integrations',
                'do_not_sell',
              ],
            },
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
      response: { 200: zodToJsonSchema(ConsentHistoryResponseSchema) },
    },
    handler: async (request) => {
      const userId = request.headers['x-user-id'] as string;
      const history = await complianceService.getConsentHistory(userId);
      return { consents: history.map((record) => mapConsentRecordToDto(record as Record<string, unknown>)) };
    },
  });

  // --- Data Export ---

  fastify.post('/data-export', {
    schema: {
      tags: ['Account'],
      summary: 'Request personal data export (GDPR)',
      operationId: 'requestDataExport',
      response: { 202: zodToJsonSchema(DataExportAcceptedResponseSchema) },
    },
    handler: async (request, reply) => {
      const userId = request.headers['x-user-id'] as string;
      const id = await complianceService.requestDataExport(userId);
      return reply.status(202).send({ requestId: id, message: 'Export request accepted' });
    },
  });

  fastify.get('/data-export', {
    schema: {
      tags: ['Account'],
      summary: 'Check current personal data export status',
      operationId: 'getDataExportStatus',
      response: { 200: zodToJsonSchema(DataExportStatusResponseSchema) },
    },
    handler: async (request) => {
      const userId = request.headers['x-user-id'] as string;
      return complianceService.getDataExportStatus(userId);
    },
  });

  fastify.get<{ Params: { id: string } }>('/data-export/:id', {
    schema: {
      tags: ['Account'],
      summary: 'Get data export status and download',
      operationId: 'getDataExport',
      response: { 200: zodToJsonSchema(DataExportResponseSchema) },
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
      body: {
        type: 'object',
        properties: {
          reason: { type: 'string' },
        },
      },
      response: { 202: zodToJsonSchema(AccountDeletionAcceptedResponseSchema) },
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

  fastify.get('/delete-account', {
    schema: {
      tags: ['Account'],
      summary: 'Get current account deletion request status',
      operationId: 'getAccountDeletionStatus',
      response: { 200: zodToJsonSchema(AccountDeletionStatusResponseSchema) },
    },
    handler: async (request) => {
      const userId = request.headers['x-user-id'] as string;
      return complianceService.getDeletionStatus(userId);
    },
  });

  // --- Session Reminders ---

  fastify.get('/activity-limit', {
    schema: {
      tags: ['Account'],
      summary: 'Get activity limit settings for current user',
      operationId: 'getActivityLimit',
      response: { 200: zodToJsonSchema(ActivityLimitResponseSchema) },
    },
    handler: async (request) => {
      const userId = request.headers['x-user-id'] as string;
      const activityLimit = await complianceService.getActivityLimit(userId);
      return { activityLimit };
    },
  });

  fastify.put('/activity-limit', {
    schema: {
      tags: ['Account'],
      summary: 'Update activity limit settings for current user',
      operationId: 'updateActivityLimit',
      body: zodToJsonSchema(ActivityLimitUpdateRequestSchema),
      response: { 200: zodToJsonSchema(ActivityLimitResponseSchema) },
    },
    handler: async (request) => {
      const userId = request.headers['x-user-id'] as string;
      const body = request.body as z.infer<typeof ActivityLimitUpdateRequestSchema>;
      const activityLimit = await complianceService.updateActivityLimit(
        userId,
        body.enabled,
        body.weeklyContestLimit,
      );
      return { activityLimit };
    },
  });

  fastify.get('/session-reminder', {
    schema: {
      tags: ['Account'],
      summary: 'Get session reminder settings for current user',
      operationId: 'getSessionReminder',
      response: { 200: zodToJsonSchema(SessionReminderResponseSchema) },
    },
    handler: async (request) => {
      const userId = request.headers['x-user-id'] as string;
      const sessionReminder = await complianceService.getSessionReminder(userId);
      return { sessionReminder };
    },
  });

  fastify.put('/session-reminder', {
    schema: {
      tags: ['Account'],
      summary: 'Update session reminder settings for current user',
      operationId: 'updateSessionReminder',
      body: zodToJsonSchema(SessionReminderUpdateRequestSchema),
      response: { 200: zodToJsonSchema(SessionReminderResponseSchema) },
    },
    handler: async (request) => {
      const userId = request.headers['x-user-id'] as string;
      const body = request.body as z.infer<typeof SessionReminderUpdateRequestSchema>;
      const sessionReminder = await complianceService.updateSessionReminder(
        userId,
        body.enabled,
        body.intervalMinutes,
      );
      return { sessionReminder };
    },
  });

  fastify.post<{ Params: { id: string } }>('/delete-account/:id/cancel', {
    schema: {
      tags: ['Account'],
      summary: 'Cancel a pending account deletion',
      operationId: 'cancelAccountDeletion',
      response: { 200: zodToJsonSchema(AccountDeletionCancelledResponseSchema) },
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
      response: { 201: zodToJsonSchema(SelfExclusionCreatedResponseSchema) },
        body: {
          type: 'object',
          required: ['type', 'duration'],
          properties: {
            type: { type: 'string', enum: ['COOL_DOWN', 'SELF_EXCLUSION'] },
            duration: zodToJsonSchema(SelfExclusionDurationSchema),
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
      response: { 200: zodToJsonSchema(ActiveExclusionResponseSchema) },
    },
    handler: async (request) => {
      const userId = request.headers['x-user-id'] as string;
      const exclusion = await complianceService.getActiveExclusion(userId);
      return { exclusion: mapSelfExclusionToDto(exclusion as Record<string, unknown> | null) };
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
        response: { 201: zodToJsonSchema(EnforcementCreatedResponseSchema) },
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
      response: { 200: zodToJsonSchema(EnforcementHistoryResponseSchema) },
    },
    handler: async (request) => {
      const history = await complianceService.getEnforcementHistory(request.params.userId);
      return { enforcement: history.map((entry) => mapEnforcementActionToDto(entry as Record<string, unknown>)) };
    },
  });

  fastify.put<{ Params: { id: string }; Body: { status: string } }>(
    '/enforcement/:id/appeal',
    {
      schema: {
        tags: ['Account'],
        summary: 'Update enforcement appeal status',
        operationId: 'updateAppealStatus',
        response: { 200: { type: 'object', properties: { success: { type: 'boolean' } }, required: ['success'] } },
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
      response: { 200: zodToJsonSchema(RetentionCleanupResponseSchema) },
    },
    handler: async () => {
      return complianceService.runRetentionCleanup();
    },
  });
}
