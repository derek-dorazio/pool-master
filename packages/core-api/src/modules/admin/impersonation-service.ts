/**
 * ImpersonationService — manages admin impersonation sessions.
 *
 * Allows admins to start time-limited sessions where they view the app as a
 * specific tenant admin. All actions during impersonation are audit-logged.
 * Sessions auto-expire after 1 hour.
 *
 * Persisted via Prisma to the impersonation_sessions table.
 */

import type { PrismaClient } from '@prisma/client';
import { logAdminAction } from './admin-audit-service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImpersonationSession {
  id: string;
  adminUserId: string;
  tenantId: string;
  token: string;
  startedAt: Date;
  expiresAt: Date;
  endedAt?: Date;
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSION_DURATION_MS = 60 * 60 * 1000; // 1 hour

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateSessionToken(adminUserId: string, tenantId: string): string {
  // Placeholder: generates a mock JWT with impersonation claims.
  // Will be replaced with real JWT signing via jose / jsonwebtoken.
  const payload = {
    sub: adminUserId,
    tenantId,
    impersonating: true,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor((Date.now() + SESSION_DURATION_MS) / 1000),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `eyJhbGciOiJIUzI1NiJ9.${encoded}.mock-signature`;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ImpersonationService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Starts a new impersonation session for a given tenant.
   *
   * Creates an ImpersonationSession record and generates a special JWT
   * with `impersonating: true` claim and the original admin ID.
   */
  async startSession(
    tenantId: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<ImpersonationSession> {
    // End any existing active session for this admin
    await this.prisma.impersonationSession.updateMany({
      where: { adminUserId, isActive: true },
      data: { isActive: false, endedAt: new Date() },
    });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);
    const token = generateSessionToken(adminUserId, tenantId);

    const row = await this.prisma.impersonationSession.create({
      data: {
        adminUserId,
        tenantId,
        startedAt: now,
        isActive: true,
      },
    });

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'impersonation.start',
      resourceType: 'TENANT',
      resourceId: tenantId,
      description: `Started impersonation session for tenant ${tenantId}`,
      afterState: { sessionId: row.id, expiresAt: expiresAt.toISOString() },
    });

    return {
      id: row.id,
      adminUserId,
      tenantId,
      token,
      startedAt: row.startedAt,
      expiresAt,
      isActive: true,
    };
  }

  /**
   * Ends the active impersonation session for a given admin.
   */
  async endSession(
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<void> {
    const active = await this.prisma.impersonationSession.findFirst({
      where: { adminUserId, isActive: true },
    });

    if (!active) {
      throw new NoActiveSessionError(adminUserId);
    }

    await this.prisma.impersonationSession.update({
      where: { id: active.id },
      data: { isActive: false, endedAt: new Date() },
    });

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'impersonation.end',
      resourceType: 'TENANT',
      resourceId: active.tenantId,
      description: `Ended impersonation session ${active.id}`,
      beforeState: { sessionId: active.id },
    });
  }

  /**
   * Returns the active impersonation session for a given admin, or null.
   */
  async getActiveSession(adminUserId: string): Promise<ImpersonationSession | null> {
    const now = new Date();
    const expirationCutoff = new Date(now.getTime() - SESSION_DURATION_MS);

    // Auto-expire sessions that are past the 1-hour window
    await this.prisma.impersonationSession.updateMany({
      where: {
        isActive: true,
        startedAt: { lt: expirationCutoff },
      },
      data: { isActive: false, endedAt: now },
    });

    const session = await this.prisma.impersonationSession.findFirst({
      where: { adminUserId, isActive: true },
    });

    if (!session) {
      return null;
    }

    const expiresAt = new Date(session.startedAt.getTime() + SESSION_DURATION_MS);
    const token = generateSessionToken(adminUserId, session.tenantId);

    return {
      id: session.id,
      adminUserId: session.adminUserId,
      tenantId: session.tenantId,
      token,
      startedAt: session.startedAt,
      expiresAt,
      endedAt: session.endedAt ?? undefined,
      isActive: session.isActive,
    };
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class NoActiveSessionError extends Error {
  constructor(adminUserId: string) {
    super(`No active impersonation session for admin: ${adminUserId}`);
    this.name = 'NoActiveSessionError';
  }
}
