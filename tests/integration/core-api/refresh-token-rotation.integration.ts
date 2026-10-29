/**
 * #1175 — refresh-token rotation against Postgres.
 *
 * A refresh token is single use: refreshing revokes it and issues the next one. That rule is
 * a database rule, because two refreshes with the same token can both read it as live before
 * either revokes it. Only a conditional update decides which one wins, so these run the real
 * service against the real table.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getPrisma,
  createTestUser,
} from '../helpers';
import { PrismaUserRepository } from '../../../packages/core-api/src/adapters';
import { AuthService } from '../../../packages/core-api/src/modules/auth/auth-service';
import { hashRefreshToken } from '../../../packages/core-api/src/modules/auth/refresh-token-hash';
import { waitUntilBlockedBy } from '../contest-lock';
import { holdMemberLock } from '../member-lock';
import { emailServiceInto } from '../../support/email-service';
import { UserService } from '../../../packages/core-api/src/modules/users/user-service';
import { PasswordChangedNotifier } from '../../../packages/core-api/src/modules/auth/password-changed-notifier';
import { EmailChangeUndoService } from '../../../packages/core-api/src/modules/auth/email-change-undo-service';

beforeAll(() => setupIntegrationTests());
afterAll(() => teardownIntegrationTests());

function buildAuthService(): AuthService {
  return new AuthService(new PrismaUserRepository(getPrisma()), getPrisma());
}

function buildUserService(): UserService {
  const users = new PrismaUserRepository(getPrisma());
  const email = emailServiceInto();
  const appBaseUrl = 'https://app.example.test';
  return new UserService(
    users,
    getPrisma(),
    new PasswordChangedNotifier(users, email, appBaseUrl),
    new EmailChangeUndoService({ users, prisma: getPrisma(), email, appBaseUrl }),
  );
}

describe('refresh-token rotation (#1175)', () => {
  it('lets only one of several concurrent refreshes with the same token succeed, so a replayed token cannot fork the session', async () => {
    const service = buildAuthService();
    const { user } = await createTestUser();
    const session = await service.issueSessionForUser(user.id);

    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () => service.refresh(session.refreshToken)),
    );

    const succeeded = attempts.filter((attempt) => attempt.status === 'fulfilled');
    const refused = attempts.filter((attempt) => attempt.status === 'rejected');
    expect(succeeded).toHaveLength(1);
    expect(refused).toHaveLength(4);
    for (const attempt of refused) {
      expect(attempt.reason).toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
    }

    const live = await getPrisma().refreshToken.findMany({
      where: { sessionId: session.sessionId, revokedAt: null },
    });
    expect(live).toHaveLength(1);
  });

  it('refuses a token that an earlier refresh already rotated', async () => {
    const service = buildAuthService();
    const { user } = await createTestUser();
    const session = await service.issueSessionForUser(user.id);

    const next = await service.refresh(session.refreshToken);

    await expect(service.refresh(session.refreshToken)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
    await expect(service.refresh(next.refreshToken)).resolves.toMatchObject({
      sessionId: session.sessionId,
    });
  });
});

describe('refresh-token storage (#1230)', () => {
  it('stores only the SHA-256 of each refresh token, never the token the client holds, so a read of the table hands out no live session', async () => {
    const service = buildAuthService();
    const { user } = await createTestUser();
    const session = await service.issueSessionForUser(user.id);
    const next = await service.refresh(session.refreshToken);

    const rows = await getPrisma().refreshToken.findMany({ where: { sessionId: session.sessionId } });
    const stored = rows.map((row) => row.tokenHash);
    expect(stored).toHaveLength(2);
    expect(stored).not.toContain(session.refreshToken);
    expect(stored).not.toContain(next.refreshToken);
    expect(stored).toEqual(expect.arrayContaining([sha256(session.refreshToken), sha256(next.refreshToken)]));
  });

  it('signs out by the token the client holds, revoking its stored hash', async () => {
    const service = buildAuthService();
    const { user } = await createTestUser();
    const session = await service.issueSessionForUser(user.id);

    await service.logout(session.refreshToken);

    await expect(service.refresh(session.refreshToken)).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
  });

  // The hash migration rewrote existing rows with Postgres's sha256, so sessions signed in
  // before it kept working only because Postgres and the service hash alike. Changing either
  // side (a salt, base64, another encoding) would sign every member out with nothing else failing.
  it('hashes a token the same way as the SQL the hash migration ran, so sessions from before the migration stay signed in', async () => {
    const token = randomUUID();

    const [{ hash }] = await getPrisma().$queryRaw<[{ hash: string }]>`
      SELECT encode(sha256(convert_to(${token}, 'UTF8')), 'hex') AS hash`;

    expect(hash).toBe(hashRefreshToken(token));
  });

  it('finds the row the service stored by the migration\'s SQL hash of the token the client holds', async () => {
    const service = buildAuthService();
    const { user } = await createTestUser();
    const session = await service.issueSessionForUser(user.id);

    const rows = await getPrisma().$queryRaw<Array<{ session_id: string }>>`
      SELECT session_id FROM refresh_tokens
      WHERE token_hash = encode(sha256(convert_to(${session.refreshToken}, 'UTF8')), 'hex')`;

    expect(rows).toEqual([{ session_id: session.sessionId }]);
  });
});

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('refresh-token reuse (#1229)', () => {
  it('ends the whole session when a token rotated more than the grace window ago comes back, so a thief who refreshed first loses it too', async () => {
    const service = buildAuthService();
    const { user } = await createTestUser();
    const session = await service.issueSessionForUser(user.id);
    const next = await service.refresh(session.refreshToken);
    // The rotation happened a minute ago: well past the two-tab grace window.
    await getPrisma().refreshToken.update({
      where: { tokenHash: sha256(session.refreshToken) },
      data: { rotatedAt: new Date(Date.now() - 60_000) },
    });

    await expect(service.refresh(session.refreshToken)).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });

    await expect(service.refresh(next.refreshToken)).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
    const live = await getPrisma().refreshToken.count({ where: { sessionId: session.sessionId, revokedAt: null } });
    expect(live).toBe(0);
  });

  it('ends only the session the reused token belongs to, so the same member stays signed in on their other devices', async () => {
    const service = buildAuthService();
    const { user } = await createTestUser();
    const phone = await service.issueSessionForUser(user.id);
    const laptop = await service.issueSessionForUser(user.id);
    await service.refresh(phone.refreshToken);
    await getPrisma().refreshToken.update({
      where: { tokenHash: sha256(phone.refreshToken) },
      data: { rotatedAt: new Date(Date.now() - 60_000) },
    });

    await expect(service.refresh(phone.refreshToken)).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });

    await expect(service.refresh(laptop.refreshToken)).resolves.toMatchObject({ sessionId: laptop.sessionId });
  });

  it('refuses a token rotated moments ago without ending the session, so two tabs refreshing at once stay signed in', async () => {
    const service = buildAuthService();
    const { user } = await createTestUser();
    const session = await service.issueSessionForUser(user.id);
    const next = await service.refresh(session.refreshToken);

    await expect(service.refresh(session.refreshToken)).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });

    await expect(service.refresh(next.refreshToken)).resolves.toMatchObject({ sessionId: session.sessionId });
  });

  it('marks only a rotated token as rotated, not one revoked by signing out', async () => {
    const service = buildAuthService();
    const { user } = await createTestUser();
    const session = await service.issueSessionForUser(user.id);
    const next = await service.refresh(session.refreshToken);
    await service.logout(next.refreshToken);

    const rows = await getPrisma().refreshToken.findMany({ where: { sessionId: session.sessionId } });
    const byHash = new Map(rows.map((row) => [row.tokenHash, row]));
    expect(byHash.get(sha256(session.refreshToken))?.rotatedAt).toBeInstanceOf(Date);
    const signedOut = byHash.get(sha256(next.refreshToken));
    expect(signedOut?.revokedAt).toBeInstanceOf(Date);
    expect(signedOut?.rotatedAt).toBeNull();
  });
});

/** A refresh of `refreshToken` part way through: rotated, successor inserted, not committed. */
function holdRotationInFlight(userId: string, sessionId: string, refreshToken: string) {
  return holdMemberLock(getPrisma(), userId, async (tx) => {
    const now = new Date();
    await tx.refreshToken.updateMany({
      where: { tokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: now, rotatedAt: now },
    });
    await tx.refreshToken.create({
      data: { tokenHash: sha256(randomUUID()), userId, sessionId, expiresAt: new Date(Date.now() + 60 * 60_000) },
    });
  });
}

describe('refresh-token reuse racing a rotation (#1264)', () => {
  it('also ends the token a rotation still in flight is inserting, so a replay that lands mid-refresh leaves the session with no live token', async () => {
    const service = buildAuthService();
    const { user } = await createTestUser();
    const session = await service.issueSessionForUser(user.id);
    const current = await service.refresh(session.refreshToken);
    await getPrisma().refreshToken.update({
      where: { tokenHash: sha256(session.refreshToken) },
      data: { rotatedAt: new Date(Date.now() - 60_000) },
    });
    // A refresh of the current token, part way through: the token is rotated and its successor
    // inserted, but the transaction has not committed.
    const rotation = holdRotationInFlight(user.id, session.sessionId, current.refreshToken);
    const holderPid = await rotation.ready;

    const replay = service.refresh(session.refreshToken);
    await waitUntilBlockedBy(getPrisma(), holderPid);
    await rotation.release();

    await expect(replay).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
    const live = await getPrisma().refreshToken.count({ where: { sessionId: session.sessionId, revokedAt: null } });
    expect(live).toBe(0);
  });

  it('signs out everywhere including the token a refresh still in flight is inserting, so a stolen session cannot outlive the sign-out', async () => {
    const service = buildAuthService();
    const { user } = await createTestUser();
    const session = await service.issueSessionForUser(user.id);
    const rotation = holdRotationInFlight(user.id, session.sessionId, session.refreshToken);
    const holderPid = await rotation.ready;

    const signOut = buildUserService().revokeSessions({ userId: user.id, isRootAdmin: false }, user.id);
    await waitUntilBlockedBy(getPrisma(), holderPid);
    await rotation.release();

    await signOut;
    const live = await getPrisma().refreshToken.count({ where: { userId: user.id, revokedAt: null } });
    expect(live).toBe(0);
  });

  it('makes a refresh wait for a reuse revoke already under way, then refuses it instead of issuing a token the revoke missed', async () => {
    const service = buildAuthService();
    const { user } = await createTestUser();
    const session = await service.issueSessionForUser(user.id);
    // A reuse revoke of this session holds the member's lock and has not yet revoked anything.
    const reuse = holdMemberLock(getPrisma(), user.id);
    const holderPid = await reuse.ready;

    const refresh = service.refresh(session.refreshToken);
    await waitUntilBlockedBy(getPrisma(), holderPid);
    await reuse.release((tx) => tx.refreshToken.updateMany({
      where: { sessionId: session.sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    }));

    await expect(refresh).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
    const live = await getPrisma().refreshToken.count({ where: { sessionId: session.sessionId, revokedAt: null } });
    expect(live).toBe(0);
  });
});
