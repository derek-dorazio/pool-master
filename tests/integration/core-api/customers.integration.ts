/**
 * The root admin's Customers reads (#1882): every league and every user on the platform, with
 * the facts each grid row shows, root admin only and rate limited per address. Users' last
 * sign-in is stamped by each way a session starts.
 */
import { randomUUID } from 'node:crypto';
import {
  CustomerLeagueListResponseSchema,
  CustomerUserListResponseSchema,
  ErrorEnvelopeSchema,
} from '@poolmaster/shared/dto';
import { ContestStatus } from '@poolmaster/shared/domain';
import { CUSTOMERS_READS_PER_MINUTE } from '../../../packages/core-api/src/modules/customers/routes';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

const DAY = 24 * 60 * 60 * 1000;

function read(url: string, headers: Record<string, string>, remoteAddress = '10.1.0.1') {
  return getApp().inject({ method: 'GET', url, headers, remoteAddress });
}

/** A league with `owner` as its first commissioner, `later` as a second one who joined after. */
async function seedLeague(name: string, planRenewsAt: Date) {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 6).toUpperCase();
  const owner = await createTestUser({ firstName: 'Ana', lastName: `Owner${suffix}` });
  const later = await createTestUser({ firstName: 'Ben', lastName: `Later${suffix}` });
  const member = await createTestUser({ firstName: 'Cy', lastName: `Member${suffix}` });
  const former = await createTestUser({ firstName: 'Di', lastName: `Former${suffix}` });
  const league = await prisma.league.create({
    data: { cupName: `${name} Cup`, leagueCode: `CS${suffix}`, name: `${name} ${suffix}`, plan: 'PRO', planRenewsAt },
  });
  await prisma.leagueMembership.createMany({
    data: [
      { leagueId: league.id, userId: owner.user.id, role: 'COMMISSIONER', status: 'ACTIVE', joinedAt: new Date(Date.now() - 30 * DAY) },
      { leagueId: league.id, userId: later.user.id, role: 'COMMISSIONER', status: 'ACTIVE', joinedAt: new Date(Date.now() - 2 * DAY) },
      { leagueId: league.id, userId: member.user.id, role: 'MEMBER', status: 'ACTIVE' },
      // A removed commissioner who joined first: neither counted nor the owner.
      { leagueId: league.id, userId: former.user.id, role: 'COMMISSIONER', status: 'INACTIVE', joinedAt: new Date(Date.now() - 60 * DAY) },
    ],
  });
  await prisma.contest.createMany({
    data: [ContestStatus.DRAFT, ContestStatus.OPEN, ContestStatus.ACTIVE, ContestStatus.COMPLETED].map((status) => ({
      leagueId: league.id, seasonYear: 2026, name: `Contest ${status}`, status, selectionType: 'TIERED' as const,
    })),
  });
  return { league, owner, later, member, former };
}

describe('GET /api/v1/customers/leagues', () => {
  it('lists every league with its longest-serving active commissioner as owner, active members, open and live contests, and its preview end', async () => {
    const running = await seedLeague('Running Preview', new Date(Date.now() + 90 * DAY));
    const ended = await seedLeague('Ended Preview', new Date(Date.now() - DAY));
    const rootAdmin = await createTestUser({ isRootAdmin: true });

    const response = await read('/api/v1/customers/leagues', rootAdmin.headers);

    expect(response.statusCode).toBe(200);
    const parsed = CustomerLeagueListResponseSchema.safeParse(response.json());
    expect(parsed.success).toBe(true);
    const leagues = parsed.data?.leagues ?? [];
    const runningRow = leagues.find((row) => row.id === running.league.id);
    expect(runningRow).toMatchObject({
      leagueCode: running.league.leagueCode,
      name: running.league.name,
      plan: 'PRO',
      isActive: true,
      owner: { userId: running.owner.user.id, firstName: 'Ana', lastName: running.owner.user.lastName },
      memberCount: 3,
      activeContestCount: 2,
      previewEndsAt: running.league.planRenewsAt.toISOString(),
    });
    expect(leagues.find((row) => row.id === ended.league.id)?.previewEndsAt).toBeNull();
  });

  it('names no owner for a league with no active commissioner', async () => {
    const lonely = await getPrisma().league.create({
      data: { cupName: 'Lonely Cup', leagueCode: `LN${randomUUID().slice(0, 6).toUpperCase()}`, name: 'Lonely League' },
    });
    const rootAdmin = await createTestUser({ isRootAdmin: true });

    const { leagues } = CustomerLeagueListResponseSchema.parse((await read('/api/v1/customers/leagues', rootAdmin.headers)).json());

    expect(leagues.find((row) => row.id === lonely.id)).toMatchObject({ owner: null, memberCount: 0, activeContestCount: 0 });
  });
});

describe('GET /api/v1/customers/users', () => {
  it('lists every user with role, status, active leagues sorted by name, joined date and last sign-in', async () => {
    const { league, member, former } = await seedLeague('Users Grid', new Date(Date.now() + DAY));
    // A second league for the member, whose name sorts first.
    const second = await getPrisma().league.create({
      data: { cupName: 'Aardvark Cup', leagueCode: `AA${randomUUID().slice(0, 6).toUpperCase()}`, name: 'Aardvark League' },
    });
    await getPrisma().leagueMembership.create({ data: { leagueId: second.id, userId: member.user.id, role: 'MEMBER', status: 'ACTIVE' } });
    await getPrisma().user.update({ where: { id: former.user.id }, data: { isActive: false } });
    const rootAdmin = await createTestUser({ isRootAdmin: true });

    const response = await read('/api/v1/customers/users', rootAdmin.headers);

    expect(response.statusCode).toBe(200);
    const parsed = CustomerUserListResponseSchema.safeParse(response.json());
    expect(parsed.success).toBe(true);
    const users = parsed.data?.users ?? [];
    expect(users.find((row) => row.id === member.user.id)).toMatchObject({
      email: member.user.email,
      firstName: 'Cy',
      isRootAdmin: false,
      isActive: true,
      leagues: [
        { id: second.id, leagueCode: second.leagueCode, name: 'Aardvark League' },
        { id: league.id, leagueCode: league.leagueCode, name: league.name },
      ],
      lastSignInAt: null,
    });
    // An inactive membership is not one of the user's leagues; an inactive account is still listed.
    expect(users.find((row) => row.id === former.user.id)).toMatchObject({ isActive: false, leagues: [] });
    expect(users.find((row) => row.id === rootAdmin.user.id)?.isRootAdmin).toBe(true);
  });

  it('shows when a user last signed in, once they sign in', async () => {
    const tag = randomUUID().slice(0, 8);
    const email = `signin-${tag}@integration.test`;
    const registered = await getApp().inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username: `signin-${tag}`, email, password: 'CorrectHorse9', firstName: 'Sign', lastName: 'In' },
    });
    expect(registered.statusCode).toBe(201);
    const afterSignUp = await getPrisma().user.findUniqueOrThrow({ where: { email } });
    expect(afterSignUp.lastSignInAt).not.toBeNull();

    const before = Date.now();
    const login = await getApp().inject({ method: 'POST', url: '/api/v1/auth/login', payload: { identifier: email, password: 'CorrectHorse9' } });
    expect(login.statusCode).toBe(200);

    const rootAdmin = await createTestUser({ isRootAdmin: true });
    const { users } = CustomerUserListResponseSchema.parse((await read('/api/v1/customers/users', rootAdmin.headers)).json());
    const lastSignInAt = users.find((row) => row.email === email)?.lastSignInAt;
    expect(lastSignInAt).toBeDefined();
    expect(new Date(lastSignInAt ?? 0).getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe('Customers access', () => {
  it('refuses both reads with 401 when signed out and 403 to a signed-in member', async () => {
    const member = await createTestUser();
    for (const url of ['/api/v1/customers/leagues', '/api/v1/customers/users']) {
      const signedOut = await read(url, {});
      expect(signedOut.statusCode).toBe(401);
      const forbidden = await read(url, member.headers);
      expect(forbidden.statusCode).toBe(403);
      ErrorEnvelopeSchema.parse(forbidden.json());
    }
  });

  it('answers reads up to the minute\'s limit, then 429 CUSTOMERS_RATE_LIMITED for that address only', async () => {
    const rootAdmin = await createTestUser({ isRootAdmin: true });
    for (let index = 0; index < CUSTOMERS_READS_PER_MINUTE; index += 1) {
      // A request at a time, as a grid makes them.
      const response = await read('/api/v1/customers/users', rootAdmin.headers, '10.1.0.9');
      expect(response.statusCode).toBe(200);
    }

    const over = await read('/api/v1/customers/users', rootAdmin.headers, '10.1.0.9');
    expect(over.statusCode).toBe(429);
    expect(ErrorEnvelopeSchema.parse(over.json())).toMatchObject({ error: { code: 'CUSTOMERS_RATE_LIMITED' } });

    const otherAddress = await read('/api/v1/customers/users', rootAdmin.headers, '10.1.0.10');
    expect(otherAddress.statusCode).toBe(200);
  });
});
