/**
 * The root admin's tier and pricing profile routes (#1844) through the app against real Postgres:
 * every route's response parsed with its DTO, the stable error codes, root admin only, and the
 * list reads costing the same statements for 2 profiles as for 20.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { FieldOrderBasis, Sport, TierProfileType } from '@poolmaster/shared/domain';
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
import { expectConstantQueries, expectFixedQueries } from '../query-scaling';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { sportPlay } from '../../support/sport-play';

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

function send(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, viewer: TestUserResult, payload?: object) {
  return getApp().inject({ method, url, ...(payload ? { headers: viewer.headers, payload } : { headers: withoutJsonBodyHeaders(viewer.headers) }) });
}

function errorCode(response: { json: () => unknown }): string {
  return ErrorEnvelopeSchema.parse(response.json()).error.code;
}

/** The test's code for a profile it names: capital letters, digits and underscores. */
function codeOf(name: string): string {
  return `TEST_${name.toUpperCase().replaceAll(/[^A-Z0-9]+/g, '_')}`;
}

type EqualGroupsWrite = Extract<PlatformTierProfileWriteRequest, { type: typeof TierProfileType.EQUAL_GROUPS }>;
type RangesWrite = Extract<PlatformTierProfileWriteRequest, { type: typeof TierProfileType.RANGES }>;

const ODDS_FIRST = [FieldOrderBasis.ODDS, FieldOrderBasis.SEED, FieldOrderBasis.RANKING];
const SEED_FIRST = [FieldOrderBasis.SEED, FieldOrderBasis.ODDS, FieldOrderBasis.RANKING];
const SEED_RANGES = [{ tierNumber: 1, fromValue: 1, toValue: 1 }, { tierNumber: 2, fromValue: 2, toValue: 4 }, { tierNumber: 3, fromValue: 5, toValue: null }];

function tierWrite(name: string, overrides: Partial<EqualGroupsWrite> = {}): EqualGroupsWrite {
  made.platformTierProfileNames.add(name);
  return { code: codeOf(name), name, type: TierProfileType.EQUAL_GROUPS, sources: ODDS_FIRST, tierCount: 6, tierSize: 10, lastTier: 'ALL_REMAINING', lastTierMax: null, ...overrides };
}

function rangesWrite(name: string, overrides: Partial<RangesWrite> = {}): RangesWrite {
  made.platformTierProfileNames.add(name);
  return { code: codeOf(name), name, type: TierProfileType.RANGES, sources: SEED_FIRST, ranges: SEED_RANGES, ...overrides };
}

function pricingWrite(name: string, overrides: Partial<PlatformPricingProfileWriteRequest> = {}): PlatformPricingProfileWriteRequest {
  made.platformPricingProfileNames.add(name);
  return { code: codeOf(name), name, sources: ODDS_FIRST, salaryCap: 50_000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4, ...overrides };
}

/** The rows a source list is stored as, for a seed written straight to the database. */
function sourceRows(sources: readonly FieldOrderBasis[]) {
  return { create: sources.map((source, orderIndex) => ({ source, orderIndex })) };
}

/** A golf sport league naming these profiles, so they are in use. */
async function leagueNaming(ids: { platformTierProfileId?: string; platformPricingProfileId?: string }): Promise<string> {
  const prisma = getPrisma();
  const golf = await prisma.sport.findUniqueOrThrow({ where: { sport: Sport.GOLF } });
  const league = await prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(Sport.GOLF), ...ids, sportId: golf.id, name: `Profile tour ${randomUUID().slice(0, 8)}` } });
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
    expect(listed.platformTierProfiles.find((profile) => profile.code === 'TIERS_6_OF_10')?.sportLeagueCount).toBeGreaterThan(0);

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

  it('creates a ranges tier profile ordered by seed first and reads it back with its sources and ranges, matching its DTO', async () => {
    const rootAdmin = await createTestUser({ displayName: 'Ranges Profile Admin', isRootAdmin: true });
    const name = `Seed ranges ${randomUUID().slice(0, 8)}`;

    const created = await send('POST', '/api/v1/tier-profiles/', rootAdmin, rangesWrite(name));

    expect(created.statusCode).toBe(201);
    const { platformTierProfile } = PlatformTierProfileResponseSchema.parse(created.json());
    expect(platformTierProfile).toMatchObject({ name, type: 'RANGES', sources: SEED_FIRST, ranges: SEED_RANGES });
    expect(okBody(await get(`/api/v1/tier-profiles/${platformTierProfile.id}`, rootAdmin), PlatformTierProfileResponseSchema).platformTierProfile).toMatchObject({ ranges: SEED_RANGES });
  });

  it('refuses (422 PLATFORM_TIER_PROFILE_INVALID) a ranges profile ordered by odds first, or with a gap between tiers, writing nothing', async () => {
    const rootAdmin = await createTestUser({ displayName: 'Ranges Refusals Admin', isRootAdmin: true });
    const byOdds = `Ranges by odds ${randomUUID().slice(0, 8)}`;
    const gapped = `Ranges gapped ${randomUUID().slice(0, 8)}`;

    const responses = [
      await send('POST', '/api/v1/tier-profiles/', rootAdmin, rangesWrite(byOdds, { sources: ODDS_FIRST })),
      await send('POST', '/api/v1/tier-profiles/', rootAdmin, rangesWrite(gapped, { ranges: [{ tierNumber: 1, fromValue: 1, toValue: 1 }, { tierNumber: 2, fromValue: 3, toValue: null }] })),
    ];

    expect(responses.map((response) => [response.statusCode, errorCode(response)])).toEqual([[422, 'PLATFORM_TIER_PROFILE_INVALID'], [422, 'PLATFORM_TIER_PROFILE_INVALID']]);
    await expect(getPrisma().platformTierProfile.count({ where: { name: { in: [byOdds, gapped] } } })).resolves.toBe(0);
  });

  it('refuses (422 PROFILE_FIRST_SOURCES_DIFFER) a tier profile edit that changes its first source away from the pricing profile of a league naming it, keeping the sources', async () => {
    const rootAdmin = await createTestUser({ displayName: 'First Source Admin', isRootAdmin: true });
    const name = `Paired ${randomUUID().slice(0, 8)}`;
    const { platformTierProfile } = PlatformTierProfileResponseSchema.parse((await send('POST', '/api/v1/tier-profiles/', rootAdmin, tierWrite(name))).json());
    // The league's pricing profile is Standard, which starts with odds.
    await leagueNaming({ platformTierProfileId: platformTierProfile.id });

    const refused = await send('PUT', `/api/v1/tier-profiles/${platformTierProfile.id}`, rootAdmin, tierWrite(name, { sources: SEED_FIRST }));
    const reordered = await send('PUT', `/api/v1/tier-profiles/${platformTierProfile.id}`, rootAdmin, tierWrite(name, { sources: [FieldOrderBasis.ODDS, FieldOrderBasis.RANKING] }));

    expect([refused.statusCode, errorCode(refused)]).toEqual([422, 'PROFILE_FIRST_SOURCES_DIFFER']);
    expect(reordered.statusCode).toBe(200);
    expect(PlatformTierProfileResponseSchema.parse(reordered.json()).platformTierProfile.sources).toEqual([FieldOrderBasis.ODDS, FieldOrderBasis.RANKING]);
  });

  it('refuses (422 PROFILE_FIRST_SOURCES_DIFFER) a league settings change to a seed-first tier profile while its pricing profile starts with odds, and takes the pair together', async () => {
    const rootAdmin = await createTestUser({ displayName: 'League Profiles Admin', isRootAdmin: true });
    const tiers = PlatformTierProfileResponseSchema.parse((await send('POST', '/api/v1/tier-profiles/', rootAdmin, rangesWrite(`League seeds ${randomUUID().slice(0, 8)}`))).json()).platformTierProfile;
    const prices = PlatformPricingProfileResponseSchema.parse((await send('POST', '/api/v1/pricing-profiles/', rootAdmin, pricingWrite(`League by seed ${randomUUID().slice(0, 8)}`, { sources: SEED_FIRST }))).json()).platformPricingProfile;
    const sportLeagueId = await leagueNaming({});

    const refused = await send('PATCH', `/api/v1/sport-leagues/${sportLeagueId}`, rootAdmin, { platformTierProfileId: tiers.id });
    const together = await send('PATCH', `/api/v1/sport-leagues/${sportLeagueId}`, rootAdmin, { platformTierProfileId: tiers.id, platformPricingProfileId: prices.id });

    expect([refused.statusCode, errorCode(refused)]).toEqual([422, 'PROFILE_FIRST_SOURCES_DIFFER']);
    expect(together.statusCode).toBe(200);
    await expect(getPrisma().sportLeague.findUniqueOrThrow({ where: { id: sportLeagueId } })).resolves.toMatchObject({ platformTierProfileId: tiers.id, platformPricingProfileId: prices.id });
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
      // Every other profile is ranges, so the list reads both layouts' rows however many there are.
      const { sources, ...write } = index % 2 === 0 ? tierWrite(name) : rangesWrite(name);
      const data = write.type === TierProfileType.RANGES
        ? { code: write.code, name: write.name, type: write.type, sources: sourceRows(sources), ranges: { create: write.ranges } }
        : { ...write, sources: sourceRows(sources) };
      const profile = await prisma.platformTierProfile.create({ data });
      lastSeed.platformTierProfileIds.push(profile.id);
      lastSeed.sportLeagueIds.push(await leagueNaming({ platformTierProfileId: profile.id }));
    } else {
      const { sources, ...write } = pricingWrite(name);
      const profile = await prisma.platformPricingProfile.create({ data: { ...write, sources: sourceRows(sources) } });
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

describe('one profile costs the same statements whatever rows it holds', () => {
  /** A ranges tier profile of `rows` ranges, one value each and the last open-ended, and a root admin to read it. */
  async function seedRangesProfile(rows: number) {
    const { sources, ...write } = rangesWrite(`Scaling ranges ${randomUUID().slice(0, 8)}`, {
      ranges: Array.from({ length: rows }, (_, index) => ({ tierNumber: index + 1, fromValue: index + 1, toValue: index === rows - 1 ? null : index + 1 })),
    });
    const profile = await getPrisma().platformTierProfile.create({
      data: { code: write.code, name: write.name, type: write.type, sources: sourceRows(sources), ranges: { create: write.ranges } },
    });
    return { profileId: profile.id, rootAdmin: await createTestUser({ isRootAdmin: true }) };
  }

  it('GET one tier profile with its sources and ranges: the same statements for 2 ranges as for 20', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/tier-profiles/{profileId}',
      seed: seedRangesProfile,
      call: ({ profileId, rootAdmin }) => get(`/api/v1/tier-profiles/${profileId}`, rootAdmin),
      rowsShown: (response) => {
        const { platformTierProfile } = okBody(response, PlatformTierProfileResponseSchema);
        return platformTierProfile.type === TierProfileType.RANGES ? platformTierProfile.ranges.length : 0;
      },
    });
  });

  it('GET one pricing profile: its league count, the profile and its sources in three statements, the sources a list no longer than the order sources', async () => {
    const { sources, ...write } = pricingWrite(`Fixed pricing ${randomUUID().slice(0, 8)}`);
    const profile = await getPrisma().platformPricingProfile.create({ data: { ...write, sources: sourceRows(sources) } });
    const rootAdmin = await createTestUser({ isRootAdmin: true });

    await expectFixedQueries({
      route: 'GET /api/v1/pricing-profiles/{profileId}',
      fixedBy: 'the order sources, each listed at most once',
      call: () => get(`/api/v1/pricing-profiles/${profile.id}`, rootAdmin),
      rowsShown: (response) => okBody(response, PlatformPricingProfileResponseSchema).platformPricingProfile.sources.length,
      statements: 3,
    });
  });
});
