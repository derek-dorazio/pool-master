import { randomUUID } from 'crypto';
import { ProviderCode } from '@poolmaster/shared/domain';
import { PrismaProviderSettingsRepository } from '../../../packages/core-api/src/adapters/prisma-provider-settings-repository';
import { cleanupTestData, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';

// The Provider and ProviderLeague port against real Postgres (#1997): the refusals the
// Providers page's edits answer with, from the database's own keys and constraints. No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

const repository = () => new PrismaProviderSettingsRepository(getPrisma());

async function seededProvider() {
  return getPrisma().provider.findUniqueOrThrow({
    where: { code: ProviderCode.BALLDONTLIE },
    include: { leagues: { orderBy: { code: 'asc' } } },
  });
}

describe('PrismaProviderSettingsRepository', () => {
  it('answers NOT_FOUND for an update of a provider id no row has, and null when reading one', async () => {
    const missing = randomUUID();

    await expect(repository().update(missing, { requestsPerMinute: 10 })).resolves.toBe('NOT_FOUND');
    await expect(repository().findById(missing)).resolves.toBeNull();
  });

  it('passes on a refusal it does not own unchanged, such as a rate the CHECK constraint refuses', async () => {
    const provider = await seededProvider();

    await expect(repository().update(provider.id, { requestsPerMinute: 0 })).rejects.toThrow();
    await expect(seededProvider()).resolves.toMatchObject({ requestsPerMinute: provider.requestsPerMinute });
  });

  it('changes no league and answers null for a league under another provider id, or a league id no row has', async () => {
    const provider = await seededProvider();
    const [league] = provider.leagues;

    await expect(repository().updateLeague(randomUUID(), league.id, { typicalGameMinutes: league.typicalGameMinutes + 1 })).resolves.toBeNull();
    await expect(repository().updateLeague(provider.id, randomUUID(), { typicalGameMinutes: 30 })).resolves.toBeNull();
    const after = await getPrisma().providerLeague.findUniqueOrThrow({ where: { id: league.id } });
    expect(after.typicalGameMinutes).toBe(league.typicalGameMinutes);
  });
});
