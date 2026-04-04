/**
 * Admin Config Routes — sub-module that groups all configuration management
 * routes under the /config prefix.
 *
 * Covers scoring templates, selection templates, notification templates,
 * push trigger configuration, and rate limit configuration.
 *
 * Registered as a sub-plugin inside the main admin module so that
 * the adminAuth preHandler is inherited automatically.
 */

import type { FastifyInstance } from 'fastify';
import {
  AdminScoringTemplateListResponseSchema,
  AdminScoringTemplateResponseSchema,
  SelectionTemplateListResponseSchema,
  SelectionTemplateResponseSchema,
  SuccessSchema,
  zodToJsonSchema,
} from '@poolmaster/shared/dto';
import { TemplateConfigService } from './template-config-service';
import { createTemplateConfigHandlers } from './template-config-handler';
import { NotificationConfigService } from './notification-config-service';
import { createNotificationConfigHandlers } from './notification-config-handler';
import { PushTriggerConfigService } from './push-trigger-config-service';
import { createPushTriggerConfigHandlers } from './push-trigger-config-handler';
import { RateLimitConfigService } from './rate-limit-config-service';
import { createRateLimitConfigHandlers } from './rate-limit-config-handler';

export async function configRoutes(fastify: FastifyInstance): Promise<void> {
  // --- Services ---
  const templateConfigService = new TemplateConfigService();
  const notificationConfigService = new NotificationConfigService();
  const pushTriggerConfigService = new PushTriggerConfigService();
  const rateLimitConfigService = new RateLimitConfigService();

  // --- Handlers ---
  const templateConfig = createTemplateConfigHandlers(templateConfigService);
  const notificationConfig = createNotificationConfigHandlers(notificationConfigService);
  const pushTriggerConfig = createPushTriggerConfigHandlers(pushTriggerConfigService);
  const rateLimitConfig = createRateLimitConfigHandlers(rateLimitConfigService);

  // -----------------------------------------------------------------------
  // Scoring Template Routes
  // Permission: config.scoring_templates
  // -----------------------------------------------------------------------

  fastify.get('/config/scoring-templates', {
    schema: {
      tags: ['Admin'],
      summary: 'List scoring templates',
      operationId: 'adminListScoringTemplates',
      response: { 200: zodToJsonSchema(AdminScoringTemplateListResponseSchema) },
    },
    handler: templateConfig.listScoringTemplates,
  });

  fastify.get('/config/scoring-templates/:id', {
    schema: {
      tags: ['Admin'],
      summary: 'Get scoring template by ID',
      operationId: 'adminGetScoringTemplate',
      response: { 200: zodToJsonSchema(AdminScoringTemplateResponseSchema) },
    },
    handler: templateConfig.getScoringTemplate,
  });

  fastify.post('/config/scoring-templates', {
    schema: {
      tags: ['Admin'],
      summary: 'Create a scoring template',
      operationId: 'adminCreateScoringTemplate',
      response: { 201: zodToJsonSchema(AdminScoringTemplateResponseSchema) },
      body: {
        type: 'object',
        required: ['id', 'sport', 'name', 'description', 'config'],
        properties: {
          id: { type: 'string', minLength: 1 },
          sport: { type: 'string', minLength: 1 },
          name: { type: 'string', minLength: 1 },
          description: { type: 'string', minLength: 1 },
          config: { type: 'object' },
        },
      },
    },
    handler: templateConfig.createScoringTemplate,
  });

  fastify.put('/config/scoring-templates/:id', {
    schema: {
      tags: ['Admin'],
      summary: 'Update a scoring template',
      operationId: 'adminUpdateScoringTemplate',
      response: { 200: zodToJsonSchema(AdminScoringTemplateResponseSchema) },
      body: {
        type: 'object',
        properties: {
          sport: { type: 'string', minLength: 1 },
          name: { type: 'string', minLength: 1 },
          description: { type: 'string', minLength: 1 },
          config: { type: 'object' },
        },
      },
    },
    handler: templateConfig.updateScoringTemplate,
  });

  fastify.delete('/config/scoring-templates/:id', {
    schema: {
      tags: ['Admin'],
      summary: 'Delete a scoring template',
      operationId: 'adminDeleteScoringTemplate',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: templateConfig.deleteScoringTemplate,
  });

  // -----------------------------------------------------------------------
  // Selection Template Routes
  // Permission: config.selection_templates
  // -----------------------------------------------------------------------

  fastify.get('/config/selection-templates', {
    schema: {
      tags: ['Admin'],
      summary: 'List selection templates',
      operationId: 'adminListSelectionTemplatesConfig',
      response: { 200: zodToJsonSchema(SelectionTemplateListResponseSchema) },
    },
    handler: templateConfig.listSelectionTemplates,
  });

  fastify.get('/config/selection-templates/:id', {
    schema: {
      tags: ['Admin'],
      summary: 'Get selection template by ID',
      operationId: 'adminGetSelectionTemplateConfig',
      response: { 200: zodToJsonSchema(SelectionTemplateResponseSchema) },
    },
    handler: templateConfig.getSelectionTemplate,
  });

  fastify.post('/config/selection-templates', {
    schema: {
      tags: ['Admin'],
      summary: 'Create a selection template',
      operationId: 'adminCreateSelectionTemplate',
      response: { 201: zodToJsonSchema(SelectionTemplateResponseSchema) },
      body: {
        type: 'object',
        required: ['id', 'name', 'description', 'sport', 'contestType', 'selectionType', 'config'],
        properties: {
          id: { type: 'string', minLength: 1 },
          name: { type: 'string', minLength: 1 },
          description: { type: 'string', minLength: 1 },
          sport: { type: 'string', minLength: 1 },
          contestType: { type: 'string', minLength: 1 },
          selectionType: { type: 'string', minLength: 1 },
          config: { type: 'object' },
        },
      },
    },
    handler: templateConfig.createSelectionTemplate,
  });

  fastify.put('/config/selection-templates/:id', {
    schema: {
      tags: ['Admin'],
      summary: 'Update a selection template',
      operationId: 'adminUpdateSelectionTemplate',
      response: { 200: zodToJsonSchema(SelectionTemplateResponseSchema) },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          description: { type: 'string', minLength: 1 },
          sport: { type: 'string', minLength: 1 },
          contestType: { type: 'string', minLength: 1 },
          selectionType: { type: 'string', minLength: 1 },
          config: { type: 'object' },
        },
      },
    },
    handler: templateConfig.updateSelectionTemplate,
  });

  fastify.delete('/config/selection-templates/:id', {
    schema: {
      tags: ['Admin'],
      summary: 'Delete a selection template',
      operationId: 'adminDeleteSelectionTemplate',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: templateConfig.deleteSelectionTemplate,
  });

  // -----------------------------------------------------------------------
  // Notification Template Routes
  // Permission: config.notification_templates
  // -----------------------------------------------------------------------

  fastify.get('/config/notification-templates', {
    schema: {
      tags: ['Admin'],
      summary: 'List notification templates',
      operationId: 'adminListNotificationTemplates',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: notificationConfig.listTemplates,
  });

  fastify.get('/config/notification-templates/:eventType', {
    schema: {
      tags: ['Admin'],
      summary: 'Get notification template by event type',
      operationId: 'adminGetNotificationTemplate',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: notificationConfig.getTemplate,
  });

  fastify.put('/config/notification-templates/:eventType', {
    schema: {
      tags: ['Admin'],
      summary: 'Update a notification template',
      operationId: 'adminUpdateNotificationTemplate',
      response: { 200: zodToJsonSchema(SuccessSchema) },
      body: {
        type: 'object',
        properties: {
          pushTitle: { type: 'string' },
          pushBody: { type: 'string' },
          emailSubject: { type: 'string' },
          emailText: { type: 'string' },
          inAppTitle: { type: 'string' },
          inAppBody: { type: 'string' },
          inAppIcon: { type: 'string' },
          smsBody: { type: 'string' },
        },
      },
    },
    handler: notificationConfig.updateTemplate,
  });

  fastify.post('/config/notification-templates/reset/:eventType', {
    schema: {
      tags: ['Admin'],
      summary: 'Reset a notification template to defaults',
      operationId: 'adminResetNotificationTemplate',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: notificationConfig.resetTemplate,
  });

  // -----------------------------------------------------------------------
  // Push Trigger Configuration Routes
  // Permission: config.push_triggers
  // -----------------------------------------------------------------------

  fastify.get('/config/push-triggers', {
    schema: {
      tags: ['Admin'],
      summary: 'List push trigger configurations',
      operationId: 'adminListPushTriggers',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: pushTriggerConfig.listTriggers,
  });

  fastify.put('/config/push-triggers/:eventType', {
    schema: {
      tags: ['Admin'],
      summary: 'Update a push trigger configuration',
      operationId: 'adminUpdatePushTrigger',
      response: { 200: zodToJsonSchema(SuccessSchema) },
      body: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          title: { type: 'string', minLength: 1 },
          body: { type: 'string', minLength: 1 },
          sound: { type: 'string', minLength: 1 },
          priority: { type: 'string', enum: ['high', 'normal'] },
          category: { type: 'string', minLength: 1 },
        },
      },
    },
    handler: pushTriggerConfig.updateTrigger,
  });

  fastify.post('/config/push-triggers/:eventType/enable', {
    schema: {
      tags: ['Admin'],
      summary: 'Enable a push trigger',
      operationId: 'adminEnablePushTrigger',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: pushTriggerConfig.enableTrigger,
  });

  fastify.post('/config/push-triggers/:eventType/disable', {
    schema: {
      tags: ['Admin'],
      summary: 'Disable a push trigger',
      operationId: 'adminDisablePushTrigger',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: pushTriggerConfig.disableTrigger,
  });

  fastify.post('/config/push-triggers/reset', {
    schema: {
      tags: ['Admin'],
      summary: 'Reset all push triggers to defaults',
      operationId: 'adminResetPushTriggers',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: pushTriggerConfig.resetAll,
  });

  // -----------------------------------------------------------------------
  // Rate Limit Configuration Routes
  // Permission: config.rate_limits
  // -----------------------------------------------------------------------

  fastify.get('/config/rate-limits', {
    schema: {
      tags: ['Admin'],
      summary: 'Get rate limit configuration',
      operationId: 'adminGetRateLimitConfig',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: rateLimitConfig.getConfig,
  });

  fastify.put('/config/rate-limits', {
    schema: {
      tags: ['Admin'],
      summary: 'Update rate limit configuration',
      operationId: 'adminUpdateRateLimitConfig',
      response: { 200: zodToJsonSchema(SuccessSchema) },
      body: {
        type: 'object',
        properties: {
          pushPerHour: { type: 'integer', minimum: 1 },
          emailPerDay: { type: 'integer', minimum: 1 },
          smsPerDay: { type: 'integer', minimum: 1 },
          collapseRules: {
            type: 'array',
            items: {
              type: 'object',
              required: ['eventType', 'maxPerHour', 'windowMinutes'],
              properties: {
                eventType: { type: 'string', minLength: 1 },
                maxPerHour: { type: 'integer', minimum: 1 },
                windowMinutes: { type: 'integer', minimum: 1 },
              },
            },
          },
          dedupWindowSeconds: { type: 'integer', minimum: 0 },
        },
      },
    },
    handler: rateLimitConfig.updateConfig,
  });

  fastify.post('/config/rate-limits/reset', {
    schema: {
      tags: ['Admin'],
      summary: 'Reset rate limits to defaults',
      operationId: 'adminResetRateLimitConfig',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: rateLimitConfig.resetConfig,
  });
}
