/**
 * ImpersonationService — manages admin impersonation sessions.
 *
 * Allows admins to start time-limited sessions where they view the app as a
 * specific tenant admin. All actions during impersonation are audit-logged.
 * Sessions auto-expire after 1 hour.
 */

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
// In-memory store (placeholder for Prisma)
// ---------------------------------------------------------------------------

const activeSessions = new Map<string, ImpersonationSession>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateSessionId(): string {
  return `imp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

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
    for (const [key, session] of activeSessions.entries()) {
      if (session.adminUserId === adminUserId && session.isActive) {
        session.isActive = false;
        session.endedAt = new Date();
        activeSessions.set(key, session);
      }
    }

    const now = new Date();
    const session: ImpersonationSession = {
      id: generateSessionId(),
      adminUserId,
      tenantId,
      token: generateSessionToken(adminUserId, tenantId),
      startedAt: now,
      expiresAt: new Date(now.getTime() + SESSION_DURATION_MS),
      isActive: true,
    };

    // TODO: Insert into impersonation_sessions table via Prisma
    activeSessions.set(session.id, session);

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'impersonation.start',
      resourceType: 'TENANT',
      resourceId: tenantId,
      description: `Started impersonation session for tenant ${tenantId}`,
      afterState: { sessionId: session.id, expiresAt: session.expiresAt.toISOString() },
    });

    return session;
  }

  /**
   * Ends the active impersonation session for a given admin.
   */
  async endSession(
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<void> {
    let found = false;

    for (const [key, session] of activeSessions.entries()) {
      if (session.adminUserId === adminUserId && session.isActive) {
        session.isActive = false;
        session.endedAt = new Date();
        activeSessions.set(key, session);
        found = true;

        await logAdminAction({
          adminUserId,
          adminUserEmail,
          action: 'impersonation.end',
          resourceType: 'TENANT',
          resourceId: session.tenantId,
          description: `Ended impersonation session ${session.id}`,
          beforeState: { sessionId: session.id },
        });
      }
    }

    if (!found) {
      throw new NoActiveSessionError(adminUserId);
    }
  }

  /**
   * Returns the active impersonation session for a given admin, or null.
   */
  async getActiveSession(adminUserId: string): Promise<ImpersonationSession | null> {
    const now = new Date();

    for (const session of activeSessions.values()) {
      if (
        session.adminUserId === adminUserId &&
        session.isActive &&
        session.expiresAt > now
      ) {
        return session;
      }
    }

    // Auto-expire sessions that have passed their expiration
    for (const [key, session] of activeSessions.entries()) {
      if (session.isActive && session.expiresAt <= now) {
        session.isActive = false;
        session.endedAt = session.expiresAt;
        activeSessions.set(key, session);
      }
    }

    return null;
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
