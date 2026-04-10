/**
 * Health admin route handlers — request/response layer for platform health monitoring.
 *
 * Each handler extracts params, query, and body from the request, delegates
 * to HealthService for business logic, and returns the appropriate response.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { HealthService } from './health-service';
import { ErrorLogEntryNotFoundError, AlertRuleNotFoundError } from './health-service';
import { sendError } from '../../core/error-handler';

// ---------------------------------------------------------------------------
// Duration helpers
// ---------------------------------------------------------------------------

type MuteDuration = '1h' | '4h' | '24h' | 'indefinite';

const DURATION_MINUTES: Record<MuteDuration, number> = {
  '1h': 60,
  '4h': 240,
  '24h': 1440,
  'indefinite': 525_600, // ~1 year
};

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

export function createHealthHandlers(healthService: HealthService) {
  return {
    getServiceHealth,
    getInfrastructureMetrics,
    getBusinessMetrics,
    searchErrors,
    getErrorDetail,
    getAlertRules,
    updateAlertRule,
    muteAlert,
    unmuteAlert,
  };

  // --- Service health ---

  async function getServiceHealth(
    _request: FastifyRequest,
    _reply: FastifyReply,
  ) {
    const services = await healthService.getServiceHealth();
    return {
      services: services.map((service) => ({
        ...service,
        checkedAt: service.checkedAt.toISOString(),
      })),
    };
  }

  // --- Infrastructure metrics ---

  async function getInfrastructureMetrics(
    _request: FastifyRequest,
    _reply: FastifyReply,
  ) {
    const metrics = await healthService.getInfrastructureMetrics();
    return {
      ...metrics,
      checkedAt: metrics.checkedAt.toISOString(),
    };
  }

  // --- Business metrics ---

  async function getBusinessMetrics(
    _request: FastifyRequest,
    _reply: FastifyReply,
  ) {
    const metrics = await healthService.getBusinessMetrics();
    return {
      ...metrics,
      checkedAt: metrics.checkedAt.toISOString(),
    };
  }

  // --- Search errors ---

  async function searchErrors(
    request: FastifyRequest<{
      Querystring: {
        service?: string;
        severity?: 'ERROR' | 'CRITICAL' | 'WARNING';
        dateFrom?: string;
        dateTo?: string;
        page?: number;
        pageSize?: number;
      };
    }>,
    _reply: FastifyReply,
  ) {
    const query = request.query;
    const result = await healthService.searchErrors({
      service: query.service,
      severity: query.severity,
      startDate: query.dateFrom,
      endDate: query.dateTo,
      page: query.page,
      pageSize: query.pageSize,
    });
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    return {
      items: result.items.map((entry) => ({
        ...entry,
        occurredAt: entry.occurredAt.toISOString(),
      })),
      total: result.total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(result.total / pageSize)),
    };
  }

  // --- Error detail ---

  async function getErrorDetail(
    request: FastifyRequest<{ Params: { errorId: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const detail = await healthService.getErrorDetail(request.params.errorId);
      return reply.send({
        ...detail,
        occurredAt: detail.occurredAt.toISOString(),
      });
    } catch (err) {
      if (err instanceof ErrorLogEntryNotFoundError) {
        return sendError(reply, 404, 'ERROR_LOG_ENTRY_NOT_FOUND', err.message);
      }
      throw err;
    }
  }

  // --- Alert rules list ---

  async function getAlertRules(
    _request: FastifyRequest,
    _reply: FastifyReply,
  ) {
    const rules = await healthService.getAlertRules();
    return {
      rules: rules.map((rule) => ({
        ...rule,
        mutedUntil: rule.mutedUntil?.toISOString(),
        lastTriggeredAt: rule.lastTriggeredAt?.toISOString(),
        createdAt: rule.createdAt.toISOString(),
        updatedAt: rule.updatedAt.toISOString(),
      })),
    };
  }

  // --- Update alert rule ---

  async function updateAlertRule(
    request: FastifyRequest<{
      Params: { alertId: string };
      Body: {
        isEnabled?: boolean;
        severity?: 'P1' | 'P2' | 'P3';
        channels?: ('SLACK' | 'PAGERDUTY' | 'EMAIL')[];
        thresholds?: Record<string, number>;
        windowMinutes?: number;
      };
    }>,
    reply: FastifyReply,
  ) {
    const { alertId } = request.params;
    const body = request.body;

    try {
      const rule = await healthService.updateAlertRule(alertId, {
        isEnabled: body.isEnabled,
        severity: body.severity,
        channels: body.channels,
        thresholds: body.thresholds,
        windowMinutes: body.windowMinutes,
      });
      return reply.send({
        ...rule,
        mutedUntil: rule.mutedUntil?.toISOString(),
        lastTriggeredAt: rule.lastTriggeredAt?.toISOString(),
        createdAt: rule.createdAt.toISOString(),
        updatedAt: rule.updatedAt.toISOString(),
      });
    } catch (err) {
      if (err instanceof AlertRuleNotFoundError) {
        return sendError(reply, 404, 'ALERT_RULE_NOT_FOUND', err.message);
      }
      throw err;
    }
  }

  // --- Mute alert ---

  async function muteAlert(
    request: FastifyRequest<{
      Params: { alertId: string };
      Body: { duration: MuteDuration };
    }>,
    reply: FastifyReply,
  ) {
    const { alertId } = request.params;
    const { duration } = request.body;
    const minutes = DURATION_MINUTES[duration];

    if (minutes === undefined) {
      return sendError(
        reply,
        400,
        'INVALID_DURATION',
        `Invalid duration "${duration}". Must be one of: 1h, 4h, 24h, indefinite`,
      );
    }

    try {
      const rule = await healthService.muteAlert(alertId, minutes);
      return reply.send({
        ...rule,
        mutedUntil: rule.mutedUntil?.toISOString(),
        lastTriggeredAt: rule.lastTriggeredAt?.toISOString(),
        createdAt: rule.createdAt.toISOString(),
        updatedAt: rule.updatedAt.toISOString(),
      });
    } catch (err) {
      if (err instanceof AlertRuleNotFoundError) {
        return sendError(reply, 404, 'ALERT_RULE_NOT_FOUND', err.message);
      }
      throw err;
    }
  }

  // --- Unmute alert ---

  async function unmuteAlert(
    request: FastifyRequest<{
      Params: { alertId: string };
    }>,
    reply: FastifyReply,
  ) {
    const { alertId } = request.params;

    try {
      const rule = await healthService.unmuteAlert(alertId);
      return reply.send({
        ...rule,
        mutedUntil: rule.mutedUntil?.toISOString(),
        lastTriggeredAt: rule.lastTriggeredAt?.toISOString(),
        createdAt: rule.createdAt.toISOString(),
        updatedAt: rule.updatedAt.toISOString(),
      });
    } catch (err) {
      if (err instanceof AlertRuleNotFoundError) {
        return sendError(reply, 404, 'ALERT_RULE_NOT_FOUND', err.message);
      }
      throw err;
    }
  }
}
