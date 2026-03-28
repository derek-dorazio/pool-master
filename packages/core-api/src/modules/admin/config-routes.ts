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

  fastify.get('/config/scoring-templates', templateConfig.listScoringTemplates);

  fastify.get('/config/scoring-templates/:id', templateConfig.getScoringTemplate);

  fastify.post('/config/scoring-templates', {
    schema: {
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

  fastify.delete('/config/scoring-templates/:id', templateConfig.deleteScoringTemplate);

  // -----------------------------------------------------------------------
  // Selection Template Routes
  // Permission: config.selection_templates
  // -----------------------------------------------------------------------

  fastify.get('/config/selection-templates', templateConfig.listSelectionTemplates);

  fastify.get('/config/selection-templates/:id', templateConfig.getSelectionTemplate);

  fastify.post('/config/selection-templates', {
    schema: {
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

  fastify.delete('/config/selection-templates/:id', templateConfig.deleteSelectionTemplate);

  // -----------------------------------------------------------------------
  // Notification Template Routes
  // Permission: config.notification_templates
  // -----------------------------------------------------------------------

  fastify.get('/config/notification-templates', notificationConfig.listTemplates);

  fastify.get('/config/notification-templates/:eventType', notificationConfig.getTemplate);

  fastify.put('/config/notification-templates/:eventType', {
    schema: {
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

  fastify.post('/config/notification-templates/reset/:eventType', notificationConfig.resetTemplate);

  // -----------------------------------------------------------------------
  // Push Trigger Configuration Routes
  // Permission: config.push_triggers
  // -----------------------------------------------------------------------

  fastify.get('/config/push-triggers', pushTriggerConfig.listTriggers);

  fastify.put('/config/push-triggers/:eventType', {
    schema: {
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

  fastify.post('/config/push-triggers/:eventType/enable', pushTriggerConfig.enableTrigger);

  fastify.post('/config/push-triggers/:eventType/disable', pushTriggerConfig.disableTrigger);

  fastify.post('/config/push-triggers/reset', pushTriggerConfig.resetAll);

  // -----------------------------------------------------------------------
  // Rate Limit Configuration Routes
  // Permission: config.rate_limits
  // -----------------------------------------------------------------------

  fastify.get('/config/rate-limits', rateLimitConfig.getConfig);

  fastify.put('/config/rate-limits', {
    schema: {
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

  fastify.post('/config/rate-limits/reset', rateLimitConfig.resetConfig);
}
