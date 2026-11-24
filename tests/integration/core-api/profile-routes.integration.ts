/**
 * The root admin's tier and pricing profile routes (#1844) through the app against real Postgres:
 * every route's response parsed with its DTO, the stable error codes, root admin only, and the
 * list reads costing the same statements for 2 profiles as for 20.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Sport } from '@poolmaster/shared/domain';
import {
  PlatformPricingProfileListResponseSchema,
  PlatformPricingProfileResponseSchema,
  PlatformTierProfileListResponseSchema,
  PlatformTierProfileResponseSchema,
  type ErrorEnvelope,
  type PlatformPricingProfileWriteRequest,
  type PlatformTierProfileWriteRequest,
} from '@poolmaster/shared/dto';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
  type TestUserResult,
  withoutJsonBodyHeaders,
} from '../helpers';
import { get, okBody } from '../list-route-seeds';
import { expectConstantQueries } from '../query-scaling';
import { leagueProfiles } from '../../support/league-profiles';

const made = { platformTierProfileNames: new Set<string>(), platformPricingProfileNames: new Set<string>(), sportLeagueIds: new Set<string>() };

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  const prisma = getPrisma();
  await prisma.sportLeague.deleteMany({ where: { id: { in: [...made.sportLeagueIds] } } });
  await prisma.platformTierProfile.deleteMany({ where: { name: { in: [...made.platformTierProfileNames] } } });
  await prisma.platformPricingProfile.deleteMany({ where: { name: { in: [...made.platformPricingProfileNames] } } });
  await cleanupTestData();
  await teardownIntegrationTests();
});

function send(method: 'POST' | 'PUT' | 'DELETE', url: string, viewer: TestUserResult, payload?: object) {
  return getApp().inject({ method, url, ...(payload ? { headers: viewer.headers, payload } : { headers: withoutJsonBodyHeaders(viewer.headers) }) });
}

function errorCode(response: { json: () => unknown }): string {
  return ErrorEnvelopeSchema.parse(response.json()).error.code;
}

/** The test's code for a profile it names: capital letters, digits and underscores. */
function codeOf(name: string): string {
  return `TEST_${name.toUpperCase().replaceAll(/[^A-Z0-9]+/g, '_')}`;
}

function tierWrite(name: string, overrides: Partial<PlatformTierProfileWriteRequest> = {}): PlatformTierProfileWriteRequest {
  made.platformTierProfileNames.add(name);
  return { code: codeOf(name), name, tierCount: 6, tierSize: 10, lastTier: 'ALL_REMAINING', lastTierMax: null, ...overrides };
}

function pricingWrite(name: string, overrides: Partial<PlatformPricingProfileWriteRequest> = {}): PlatformPricingProfileWriteRequest {
  made.platformPricingProfileNames.add(name);
  return { code: codeOf(name), name, salaryCap: 50_000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4, ...overrides };
}

/** A golf sport league naming these profiles, so they are in use. */
async function leagueNaming(ids: { platformTierProfileId?: string; platformPricingProfileId?: string }): Promise<string> {
  const prisma = getPrisma();
  const golf = await prisma.sport.findUniqueOrThrow({ where: { sport: Sport.GOLF } });
  const league = await prisma.sportLeague.create({ data: { ...(await leagueProfiles(prisma)), ...ids, sportId: golf.id, name: `Profile tour ${randomUUID().slice(0, 8)}` } });
  made.sportLeagueIds.add(league.id);
  return league.id;
}

describe('Contract verification (tier and pricing profiles)', () => {
  it('creates, reads, lists, updates and deletes a tier profile, each response matching its DTO', async () => {
    const rootAdmin = await createTestUser({ displayName: 'Tier Profile Admin', isRootAdmin: true });
    const name = `Capped ${randomUUID().slice(0, 8)}`;

    const created = await send('POST', '/api/v1/tier-profiles/', rootAdmin, tierWrite(name, { lastTier: 'CAPPED', lastTierMax: 15 }));
    expect(created.statusCode).toBe(201);
    const { platformTierProfile } = PlatformTierProfileResponseSchema.parse(created.json());
    expect(platformTierProfile).toMatchObject({ name, tierCount: 6, tierSize: 10, lastTier: 'CAPPED', lastTierMax: 15, sportLeagueCount: 0 });

    await leagueNaming({ platformTierProfileId: platformTierProfile.id });
    const read = okBody(await get(`/api/v1/tier-profiles/${platformTierProfile.id}`, rootAdmin), PlatformTierProfileResponseSchema);
    expect(read.platformTierProfile.sportLeagueCount).toBe(1);

    const listResponse = await get('/api/v1/tier-profiles/', rootAdmin);
    expect(listResponse.statusCode).toBe(200);
    const listed = PlatformTierProfileListResponseSchema.parse(listResponse.json());
    expect(listed.platformTierProfiles.find((profile) => profile.id === platformTierProfile.id)).toMatchObject({ name, sportLeagueCount: 1 });
    expect(listed.platformTierProfiles.find((profile) => profile.name === '6 tiers of 10')?.sportLeagueCount).toBeGreaterThan(0);

    const updated = await send('PUT', `/api/v1/tier-profiles/${platformTierProfile.id}`, rootAdmin, tierWrite(name, { tierCount: 4, tierSize: 8 }));
    expect(updated.statusCode).toBe(200);
    expect(PlatformTierProfileResponseSchema.parse(updated.json()).platformTierProfile).toMatchObject({ tierCount: 4, tierSize: 8, lastTier: 'ALL_REMAINING', lastTierMax: null, sportLeagueCount: 1 });

    const unused = PlatformTierProfileResponseSchema.parse((await send('POST', '/api/v1/tier-profiles/', rootAdmin, tierWrite(`Unused ${randomUUID().slice(0, 8)}`))).json()).platformTierProfile;
    const deleted = await send('DELETE', `/api/v1/tier-profiles/${unused.id}`, rootAdmin);
    expect(deleted.statusCode).toBe(204);
    expect((await get(`/api/v1/tier-profiles/${unused.id}`, rootAdmin)).statusCode).toBe(404);
  });

  it('refuses a tier profile write or delete with its stable codes: 404 unknown, 409 name taken, 409 in use, 422 a capped last tier with no maximum', async () => {
    const rootAdmin = await createTestUser({ displayName: 'Tier Profile Refusals Admin', isRootAdmin: true });
    const name = `Refused ${randomUUID().slice(0, 8)}`;
    const { platformTierProfile } = PlatformTierProfileResponseSchema.parse((await send('POST', '/api/v1/tier-profiles/', rootAdmin, tierWrite(name))).json());
    await leagueNaming({ platformTierProfileId: platformTierProfile.id });

    const unknown = randomUUID();
    const responses = {
      getUnknown: await get(`/api/v1/tier-profiles/${unknown}`, rootAdmin),
      putUnknown: await send('PUT', `/api/v1/tier-profiles/${unknown}`, rootAdmin, tierWrite(`Ghost ${randomUUID().slice(0, 8)}`)),
      deleteUnknown: await send('DELETE', `/api/v1/tier-profiles/${unknown}`, rootAdmin),
      nameTaken: await send('POST', '/api/v1/tier-profiles/', rootAdmin, tierWrite(name, { tierSize: 8 })),
      inUse: await send('DELETE', `/api/v1/tier-profiles/${platformTierProfile.id}`, rootAdmin),
      invalid: await send('POST', '/api/v1/tier-profiles/', rootAdmin, tierWrite(`No cap ${randomUUID().slice(0, 8)}`, { lastTier: 'CAPPED' })),
    };

    expect(Object.fromEntries(Object.entries(responses).map(([key, response]) => [key, [response.statusCode, errorCode(response)]]))).toEqual({
      getUnknown: [404, 'PLATFORM_TIER_PROFILE_NOT_FOUND'],
      putUnknown: [404, 'PLATFORM_TIER_PROFILE_NOT_FOUND'],
      deleteUnknown: [404, 'PLATFORM_TIER_PROFILE_NOT_FOUND'],
      nameTaken: [409, 'PLATFORM_TIER_PROFILE_NAME_TAKEN'],
      inUse: [409, 'PLATFORM_TIER_PROFILE_IN_USE'],
      invalid: [422, 'PLATFORM_TIER_PROFILE_INVALID'],
    });
    await expect(getPrisma().platformTierProfile.count({ where: { id: platformTierProfile.id } })).resolves.toBe(1);
  });

  it('creates, reads, lists, updates and deletes a pricing profile, each response matching its DTO, and refuses with pricing profiles\' own codes', async () => {
    const rootAdmin = await createTestUser({ displayName: 'Pricing Profile Admin', isRootAdmin: true });
    const name = `Pricey ${randomUUID().slice(0, 8)}`;

    const created = await send('POST', '/api/v1/pricing-profiles/', rootAdmin, pricingWrite(name, { steepness: 2.5 }));
    expect(created.statusCode).toBe(201);
    const { platformPricingProfile } = PlatformPricingProfileResponseSchema.parse(created.json());
    expect(platformPricingProfile).toMatchObject({ name, steepness: 2.5, sportLeagueCount: 0 });

    expect(okBody(await get(`/api/v1/pricing-profiles/${platformPricingProfile.id}`, rootAdmin), PlatformPricingProfileResponseSchema).platformPricingProfile.name).toBe(name);
    const listResponse = await get('/api/v1/pricing-profiles/', rootAdmin);
    expect(listResponse.statusCode).toBe(200);
    const listed = PlatformPricingProfileListResponseSchema.parse(listResponse.json());
    expect(listed.platformPricingProfiles.map((profile) => profile.name)).toEqual(expect.arrayContaining(['Standard', 'Small', name]));

    const updated = await send('PUT', `/api/v1/pricing-profiles/${platformPricingProfile.id}`, rootAdmin, pricingWrite(name, { unit: 50 }));
    expect(updated.statusCode).toBe(200);
    expect(PlatformPricingProfileResponseSchema.parse(updated.json()).platformPricingProfile).toMatchObject({ unit: 50, steepness: 4 });

    const invalid = await send('POST', '/api/v1/pricing-profiles/', rootAdmin, pricingWrite(`Upside down ${randomUUID().slice(0, 8)}`, { floorSharePercent: 30 }));
    expect([invalid.statusCode, errorCode(invalid)]).toEqual([422, 'PLATFORM_PRICING_PROFILE_INVALID']);
    const taken = await send('POST', '/api/v1/pricing-profiles/', rootAdmin, pricingWrite(name));
    expect([taken.statusCode, errorCode(taken)]).toEqual([409, 'PLATFORM_PRICING_PROFILE_NAME_TAKEN']);

    await leagueNaming({ platformPricingProfileId: platformPricingProfile.id });
    const inUse = await send('DELETE', `/api/v1/pricing-profiles/${platformPricingProfile.id}`, rootAdmin);
    expect([inUse.statusCode, errorCode(inUse)]).toEqual([409, 'PLATFORM_PRICING_PROFILE_IN_USE']);

    const unused = PlatformPricingProfileResponseSchema.parse((await send('POST', '/api/v1/pricing-profiles/', rootAdmin, pricingWrite(`Unused ${randomUUID().slice(0, 8)}`))).json()).platformPricingProfile;
    expect((await send('DELETE', `/api/v1/pricing-profiles/${unused.id}`, rootAdmin)).statusCode).toBe(204);
    const gone = await get(`/api/v1/pricing-profiles/${unused.id}`, rootAdmin);
    expect([gone.statusCode, errorCode(gone)]).toEqual([404, 'PLATFORM_PRICING_PROFILE_NOT_FOUND']);
  });

  it('refuses every profile route to a member who is not a root admin with 403, writing nothing', async () => {
    const member = await createTestUser({ displayName: 'Profile Non Admin' });
    const name = `Forbidden ${randomUUID().slice(0, 8)}`;

    const responses = [
      await get('/api/v1/tier-profiles/', member),
      await get('/api/v1/pricing-profiles/', member),
      await send('POST', '/api/v1/tier-profiles/', member, tierWrite(name)),
      await send('POST', '/api/v1/pricing-profiles/', member, pricingWrite(name)),
    ];

    expect(responses.map((response) => [response.statusCode, response.json<ErrorEnvelope>().error.code])).toEqual(
      Array.from({ length: 4 }, () => [403, 'ROOT_ADMIN_ACCESS_REQUIRED']),
    );
    await expect(getPrisma().platformTierProfile.count({ where: { name } })).resolves.toBe(0);
  });
});

/** The leagues and profiles the last scaling seed made, removed before the next seeds its own. */
const lastSeed = { sportLeagueIds: [] as string[], platformTierProfileIds: [] as string[], platformPricingProfileIds: [] as string[] };

/** `rows` profiles of the kind, each named by a sport league, and a root admin to list them; the previous seed's are gone. */
async function seedProfiles(kind: 'tier' | 'pricing', rows: number) {
  const prisma = getPrisma();
  await prisma.sportLeague.deleteMany({ where: { id: { in: lastSeed.sportLeagueIds } } });
  await prisma.platformTierProfile.deleteMany({ where: { id: { in: lastSeed.platformTierProfileIds } } });
  await prisma.platformPricingProfile.deleteMany({ where: { id: { in: lastSeed.platformPricingProfileIds } } });
  Object.assign(lastSeed, { sportLeagueIds: [], platformTierProfileIds: [], platformPricingProfileIds: [] });
  const prefix = `Scaling ${kind} ${randomUUID().slice(0, 8)}`;
  for (let index = 0; index < rows; index++) {
    const name = `${prefix} ${index}`;
    if (kind === 'tier') {
      const profile = await prisma.platformTierProfile.create({ data: tierWrite(name) });
      lastSeed.platformTierProfileIds.push(profile.id);
      lastSeed.sportLeagueIds.push(await leagueNaming({ platformTierProfileId: profile.id }));
    } else {
      const profile = await prisma.platformPricingProfile.create({ data: pricingWrite(name) });
      lastSeed.platformPricingProfileIds.push(profile.id);
      lastSeed.sportLeagueIds.push(await leagueNaming({ platformPricingProfileId: profile.id }));
    }
  }
  return { rootAdmin: await createTestUser({ displayName: `Scaling Profiles ${prefix}`, isRootAdmin: true }) };
}

describe('profile lists cost the same statements for 2 profiles as for 20', () => {
  it('GET the tier profiles, each with its league count: the same statements for 2 as for 20', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/tier-profiles/',
      seed: (rows) => seedProfiles('tier', rows),
      call: ({ rootAdmin }) => get('/api/v1/tier-profiles/', rootAdmin),
      rowsShown: (response) => okBody(response, PlatformTierProfileListResponseSchema).platformTierProfiles.filter((profile) => profile.name.startsWith('Scaling tier') && profile.sportLeagueCount === 1).length,
    });
  });

  it('GET the pricing profiles, each with its league count: the same statements for 2 as for 20', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/pricing-profiles/',
      seed: (rows) => seedProfiles('pricing', rows),
      call: ({ rootAdmin }) => get('/api/v1/pricing-profiles/', rootAdmin),
      rowsShown: (response) => okBody(response, PlatformPricingProfileListResponseSchema).platformPricingProfiles.filter((profile) => profile.sportLeagueCount === 1 && profile.name.startsWith('Scaling pricing')).length,
    });
  });
});
