/**
 * Quick actions handler — one-click support shortcuts for common scenarios.
 *
 * Each action performs a mock check / operation and returns a summary result.
 * These map to the most frequent support requests:
 *   - User can't log in -> reset password
 *   - Scores aren't updating -> check provider health
 *   - Can't create contest -> check entitlements
 *   - Missing notifications -> check notification delivery
 *   - Stale scores -> re-ingest scoring data
 */

import type { FastifyReply, FastifyRequest } from 'fastify';

// ---------------------------------------------------------------------------
// Admin context helper
// ---------------------------------------------------------------------------

interface AdminContext {
  adminUserId: string;
  adminUserEmail: string;
}

function extractAdminContext(request: FastifyRequest): AdminContext {
  const adminUserId = request.headers['x-admin-user-id'] as string ?? '';
  const adminUserEmail = request.headers['x-admin-user-email'] as string ?? '';
  return { adminUserId, adminUserEmail };
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

export function createQuickActionsHandlers() {
  return {
    resetPassword,
    checkProvider,
    checkEntitlements,
    checkNotifications,
    reIngestScores,
  };

  // --- Reset password ---

  async function resetPassword(
    request: FastifyRequest<{ Body: { userId: string; email: string } }>,
    reply: FastifyReply,
  ) {
    const { adminUserId } = extractAdminContext(request);
    const { userId, email } = request.body;

    return reply.send({
      action: 'reset-password',
      performedBy: adminUserId,
      userId,
      email,
      result: 'PASSWORD_RESET_EMAIL_SENT',
      message: `Password reset email sent to ${email}. Link expires in 24 hours.`,
      authEvents: [
        { event: 'password_reset_requested', at: new Date().toISOString(), by: 'admin' },
        { event: 'last_login', at: new Date(Date.now() - 3 * 86_400_000).toISOString() },
        { event: 'last_password_change', at: new Date(Date.now() - 90 * 86_400_000).toISOString() },
      ],
    });
  }

  // --- Check provider health ---

  async function checkProvider(
    request: FastifyRequest<{ Body: { providerId: string; sport: string } }>,
    reply: FastifyReply,
  ) {
    const { providerId, sport } = request.body;

    return reply.send({
      action: 'check-provider',
      providerId,
      sport,
      status: 'HEALTHY',
      latencyMs: 245,
      errorRate: 0.2,
      lastEventReceivedAt: new Date(Date.now() - 30_000).toISOString(),
      activeEvents: 4,
      message: `Provider "${providerId}" is healthy for ${sport}. Last event received 30s ago.`,
    });
  }

  // --- Check entitlements ---

  async function checkEntitlements(
    request: FastifyRequest<{ Body: { tenantId: string } }>,
    reply: FastifyReply,
  ) {
    const { tenantId } = request.body;

    return reply.send({
      action: 'check-entitlements',
      tenantId,
      plan: 'Pro',
      limits: {
        maxLeagues: 25,
        currentLeagues: 12,
        maxContestsPerLeague: 50,
        maxMembers: 200,
        currentMembers: 45,
      },
      features: {
        salaryCapDrafts: true,
        auctionDrafts: true,
        liveScoring: true,
        customScoring: true,
        dataExport: true,
      },
      withinLimits: true,
      message: `Tenant "${tenantId}" is on the Pro plan. All entitlements are within limits.`,
    });
  }

  // --- Check notifications ---

  async function checkNotifications(
    request: FastifyRequest<{ Body: { userId: string } }>,
    reply: FastifyReply,
  ) {
    const { userId } = request.body;

    return reply.send({
      action: 'check-notifications',
      userId,
      preferences: {
        email: true,
        push: true,
        inApp: true,
      },
      devices: [
        { platform: 'iOS', token: '***redacted***', lastSeen: new Date(Date.now() - 3_600_000).toISOString() },
      ],
      recentDelivery: {
        sent: 24,
        delivered: 22,
        failed: 2,
        deliveryRate: 91.7,
      },
      failures: [
        {
          eventType: 'contest.scoring_update',
          channel: 'PUSH',
          reason: 'Device token expired',
          at: new Date(Date.now() - 30 * 60_000).toISOString(),
        },
        {
          eventType: 'draft.reminder',
          channel: 'EMAIL',
          reason: 'Mailbox full',
          at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
        },
      ],
      message: `User "${userId}" has 2 recent notification failures. Push token may need refresh.`,
    });
  }

  // --- Re-ingest scores ---

  async function reIngestScores(
    request: FastifyRequest<{ Body: { contestId: string; eventId: string } }>,
    reply: FastifyReply,
  ) {
    const { adminUserId } = extractAdminContext(request);
    const { contestId, eventId } = request.body;

    return reply.send({
      action: 're-ingest-scores',
      performedBy: adminUserId,
      contestId,
      eventId,
      result: 'RE_INGEST_STARTED',
      eventsProcessed: 142,
      scoresUpdated: 38,
      duration: '2.4s',
      message: `Re-ingested scoring data for event "${eventId}" in contest "${contestId}". 38 scores updated.`,
    });
  }
}
