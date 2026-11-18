/**
 * The root admin's tier and pricing profile routes (#1844) through the app against real Postgres:
 * every route's response parsed with its DTO, the stable error codes, root admin only, and the
 * list reads costing the same statements for 2 profiles as for 20.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Sport } from '@poolmaster/shared/domain';
import {
  PricingProfileListResponseSchema,
  PricingProfileResponseSchema,
  TierProfileListResponseSchema,
  TierProfileResponseSchema,
  type ErrorEnvelope,
  type PricingProfileWriteRequest,
  type TierProfileWriteRequest,
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

const made = { tierProfileNames: new Set<string>(), pricingProfileNames: new Set<string>(), sportLeagueIds: new Set<string>() };

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  const prisma = getPrisma();
  await prisma.sportLeague.deleteMany({ where: { id: { in: [...made.sportLeagueIds] } } });
  await prisma.tierProfile.deleteMany({ where: { name: { in: [...made.tierProfileNames] } } });
  await prisma.pricingProfile.deleteMany({ where: { name: { in: [...made.pricingProfileNames] } } });
  await cleanupTestData();
  await teardownIntegrationTests();
});

function send(method: 'POST' | 'PUT' | 'DELETE', url: string, viewer: TestUserResult, payload?: object) {
  return getApp().inject({ method, url, ...(payload ? { headers: viewer.headers, payload } : { headers: withoutJsonBodyHeaders(viewer.headers) }) });
}

function errorCode(response: { json: () => unknown }): string {
  return ErrorEnvelopeSchema.parse(response.json()).error.code;
}

function tierWrite(name: string, overrides: Partial<TierProfileWriteRequest> = {}): TierProfileWriteRequest {
  made.tierProfileNames.add(name);
  return { name, tierCount: 6, tierSize: 10, lastTier: 'ALL_REMAINING', lastTierMax: null, ...overrides };
}

function pricingWrite(name: string, overrides: Partial<PricingProfileWriteRequest> = {}): PricingProfileWriteRequest {
  made.pricingProfileNames.add(name);
  return { name, salaryCap: 50_000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4, ...overrides };
}

/** A golf sport league naming these profiles, so they are in use. */
async function leagueNaming(ids: { tierProfileId?: string; pricingProfileId?: string }): Promise<string> {
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
    const { tierProfile } = TierProfileResponseSchema.parse(created.json());
    expect(tierProfile).toMatchObject({ name, tierCount: 6, tierSize: 10, lastTier: 'CAPPED', lastTierMax: 15, sportLeagueCount: 0 });

    await leagueNaming({ tierProfileId: tierProfile.id });
    const read = okBody(await get(`/api/v1/tier-profiles/${tierProfile.id}`, rootAdmin), TierProfileResponseSchema);
    expect(read.tierProfile.sportLeagueCount).toBe(1);

    const listResponse = await get('/api/v1/tier-profiles/', rootAdmin);
    expect(listResponse.statusCode).toBe(200);
    const listed = TierProfileListResponseSchema.parse(listResponse.json());
    expect(listed.tierProfiles.find((profile) => profile.id === tierProfile.id)).toMatchObject({ name, sportLeagueCount: 1 });
    expect(listed.tierProfiles.find((profile) => profile.name === '6 tiers of 10')?.sportLeagueCount).toBeGreaterThan(0);

    const updated = await send('PUT', `/api/v1/tier-profiles/${tierProfile.id}`, rootAdmin, tierWrite(name, { tierCount: 4, tierSize: 8 }));
    expect(updated.statusCode).toBe(200);
    expect(TierProfileResponseSchema.parse(updated.json()).tierProfile).toMatchObject({ tierCount: 4, tierSize: 8, lastTier: 'ALL_REMAINING', lastTierMax: null, sportLeagueCount: 1 });

    const unused = TierProfileResponseSchema.parse((await send('POST', '/api/v1/tier-profiles/', rootAdmin, tierWrite(`Unused ${randomUUID().slice(0, 8)}`))).json()).tierProfile;
    const deleted = await send('DELETE', `/api/v1/tier-profiles/${unused.id}`, rootAdmin);
    expect(deleted.statusCode).toBe(204);
    expect((await get(`/api/v1/tier-profiles/${unused.id}`, rootAdmin)).statusCode).toBe(404);
  });

  it('refuses a tier profile write or delete with its stable codes: 404 unknown, 409 name taken, 409 in use, 422 a capped last tier with no maximum', async () => {
    const rootAdmin = await createTestUser({ displayName: 'Tier Profile Refusals Admin', isRootAdmin: true });
    const name = `Refused ${randomUUID().slice(0, 8)}`;
    const { tierProfile } = TierProfileResponseSchema.parse((await send('POST', '/api/v1/tier-profiles/', rootAdmin, tierWrite(name))).json());
    await leagueNaming({ tierProfileId: tierProfile.id });

    const unknown = randomUUID();
    const responses = {
      getUnknown: await get(`/api/v1/tier-profiles/${unknown}`, rootAdmin),
      putUnknown: await send('PUT', `/api/v1/tier-profiles/${unknown}`, rootAdmin, tierWrite(`Ghost ${randomUUID().slice(0, 8)}`)),
      deleteUnknown: await send('DELETE', `/api/v1/tier-profiles/${unknown}`, rootAdmin),
      nameTaken: await send('POST', '/api/v1/tier-profiles/', rootAdmin, tierWrite(name, { tierSize: 8 })),
      inUse: await send('DELETE', `/api/v1/tier-profiles/${tierProfile.id}`, rootAdmin),
      invalid: await send('POST', '/api/v1/tier-profiles/', rootAdmin, tierWrite(`No cap ${randomUUID().slice(0, 8)}`, { lastTier: 'CAPPED' })),
    };

    expect(Object.fromEntries(Object.entries(responses).map(([key, response]) => [key, [response.statusCode, errorCode(response)]]))).toEqual({
      getUnknown: [404, 'TIER_PROFILE_NOT_FOUND'],
      putUnknown: [404, 'TIER_PROFILE_NOT_FOUND'],
      deleteUnknown: [404, 'TIER_PROFILE_NOT_FOUND'],
      nameTaken: [409, 'TIER_PROFILE_NAME_TAKEN'],
      inUse: [409, 'TIER_PROFILE_IN_USE'],
      invalid: [422, 'TIER_PROFILE_INVALID'],
    });
    await expect(getPrisma().tierProfile.count({ where: { id: tierProfile.id } })).resolves.toBe(1);
  });

  it('creates, reads, lists, updates and deletes a pricing profile, each response matching its DTO, and refuses with pricing profiles\' own codes', async () => {
    const rootAdmin = await createTestUser({ displayName: 'Pricing Profile Admin', isRootAdmin: true });
    const name = `Pricey ${randomUUID().slice(0, 8)}`;

    const created = await send('POST', '/api/v1/pricing-profiles/', rootAdmin, pricingWrite(name, { steepness: 2.5 }));
    expect(created.statusCode).toBe(201);
    const { pricingProfile } = PricingProfileResponseSchema.parse(created.json());
    expect(pricingProfile).toMatchObject({ name, steepness: 2.5, sportLeagueCount: 0 });

    expect(okBody(await get(`/api/v1/pricing-profiles/${pricingProfile.id}`, rootAdmin), PricingProfileResponseSchema).pricingProfile.name).toBe(name);
    const listResponse = await get('/api/v1/pricing-profiles/', rootAdmin);
    expect(listResponse.statusCode).toBe(200);
    const listed = PricingProfileListResponseSchema.parse(listResponse.json());
    expect(listed.pricingProfiles.map((profile) => profile.name)).toEqual(expect.arrayContaining(['Standard', 'Small', name]));

    const updated = await send('PUT', `/api/v1/pricing-profiles/${pricingProfile.id}`, rootAdmin, pricingWrite(name, { unit: 50 }));
    expect(updated.statusCode).toBe(200);
    expect(PricingProfileResponseSchema.parse(updated.json()).pricingProfile).toMatchObject({ unit: 50, steepness: 4 });

    const invalid = await send('POST', '/api/v1/pricing-profiles/', rootAdmin, pricingWrite(`Upside down ${randomUUID().slice(0, 8)}`, { floorSharePercent: 30 }));
    expect([invalid.statusCode, errorCode(invalid)]).toEqual([422, 'PRICING_PROFILE_INVALID']);
    const taken = await send('POST', '/api/v1/pricing-profiles/', rootAdmin, pricingWrite(name));
    expect([taken.statusCode, errorCode(taken)]).toEqual([409, 'PRICING_PROFILE_NAME_TAKEN']);

    await leagueNaming({ pricingProfileId: pricingProfile.id });
    const inUse = await send('DELETE', `/api/v1/pricing-profiles/${pricingProfile.id}`, rootAdmin);
    expect([inUse.statusCode, errorCode(inUse)]).toEqual([409, 'PRICING_PROFILE_IN_USE']);

    const unused = PricingProfileResponseSchema.parse((await send('POST', '/api/v1/pricing-profiles/', rootAdmin, pricingWrite(`Unused ${randomUUID().slice(0, 8)}`))).json()).pricingProfile;
    expect((await send('DELETE', `/api/v1/pricing-profiles/${unused.id}`, rootAdmin)).statusCode).toBe(204);
    const gone = await get(`/api/v1/pricing-profiles/${unused.id}`, rootAdmin);
    expect([gone.statusCode, errorCode(gone)]).toEqual([404, 'PRICING_PROFILE_NOT_FOUND']);
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
    await expect(getPrisma().tierProfile.count({ where: { name } })).resolves.toBe(0);
  });
});

/** The leagues and profiles the last scaling seed made, removed before the next seeds its own. */
const lastSeed = { sportLeagueIds: [] as string[], tierProfileIds: [] as string[], pricingProfileIds: [] as string[] };

/** `rows` profiles of the kind, each named by a sport league, and a root admin to list them; the previous seed's are gone. */
async function seedProfiles(kind: 'tier' | 'pricing', rows: number) {
  const prisma = getPrisma();
  await prisma.sportLeague.deleteMany({ where: { id: { in: lastSeed.sportLeagueIds } } });
  await prisma.tierProfile.deleteMany({ where: { id: { in: lastSeed.tierProfileIds } } });
  await prisma.pricingProfile.deleteMany({ where: { id: { in: lastSeed.pricingProfileIds } } });
  Object.assign(lastSeed, { sportLeagueIds: [], tierProfileIds: [], pricingProfileIds: [] });
  const prefix = `Scaling ${kind} ${randomUUID().slice(0, 8)}`;
  for (let index = 0; index < rows; index++) {
    const name = `${prefix} ${index}`;
    if (kind === 'tier') {
      const profile = await prisma.tierProfile.create({ data: tierWrite(name) });
      lastSeed.tierProfileIds.push(profile.id);
      lastSeed.sportLeagueIds.push(await leagueNaming({ tierProfileId: profile.id }));
    } else {
      const profile = await prisma.pricingProfile.create({ data: pricingWrite(name) });
      lastSeed.pricingProfileIds.push(profile.id);
      lastSeed.sportLeagueIds.push(await leagueNaming({ pricingProfileId: profile.id }));
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
      rowsShown: (response) => okBody(response, TierProfileListResponseSchema).tierProfiles.filter((profile) => profile.name.startsWith('Scaling tier') && profile.sportLeagueCount === 1).length,
    });
  });

  it('GET the pricing profiles, each with its league count: the same statements for 2 as for 20', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/pricing-profiles/',
      seed: (rows) => seedProfiles('pricing', rows),
      call: ({ rootAdmin }) => get('/api/v1/pricing-profiles/', rootAdmin),
      rowsShown: (response) => okBody(response, PricingProfileListResponseSchema).pricingProfiles.filter((profile) => profile.sportLeagueCount === 1 && profile.name.startsWith('Scaling pricing')).length,
    });
  });
});
