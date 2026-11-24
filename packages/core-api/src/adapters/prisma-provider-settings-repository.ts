/**
 * The Provider and ProviderLeague tables (#1997): every provider with its leagues in one query,
 * and the Providers page's edits.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import type { ProviderSettingsRepository } from '@poolmaster/shared/db';
import type { ProviderLeagueSettings, ProviderLeagueSettingsUpdate, ProviderSettings, ProviderSettingsUpdate } from '@poolmaster/shared/domain';

const PROVIDER_INCLUDE = {
  leagues: { include: { sport: { select: { sport: true } } }, orderBy: { code: 'asc' } },
} satisfies Prisma.ProviderInclude;

type ProviderRow = Prisma.ProviderGetPayload<{ include: typeof PROVIDER_INCLUDE }>;
type ProviderLeagueRow = ProviderRow['leagues'][number];

function toProviderLeague(row: ProviderLeagueRow): ProviderLeagueSettings {
  return {
    id: row.id,
    providerId: row.providerId,
    code: row.code,
    name: row.name,
    sport: row.sport.sport,
    webhookEventSet: row.webhookEventSet,
    quietAfterMinutes: row.quietAfterMinutes,
    typicalGameMinutes: row.typicalGameMinutes,
    isEnabled: row.isEnabled,
  };
}

function toProvider(row: ProviderRow): ProviderSettings {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    baseUrl: row.baseUrl,
    requestsPerMinute: row.requestsPerMinute,
    webhooksEnabled: row.webhooksEnabled,
    webhookPollMinutes: row.webhookPollMinutes,
    webhookRoundPollMinutes: row.webhookRoundPollMinutes,
    hasPlayerStats: row.hasPlayerStats,
    isEnabled: row.isEnabled,
    priority: row.priority,
    leagues: row.leagues.map(toProviderLeague),
  };
}

export class PrismaProviderSettingsRepository implements ProviderSettingsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findAll(): Promise<ProviderSettings[]> {
    const rows = await this.prisma.provider.findMany({ include: PROVIDER_INCLUDE, orderBy: { priority: 'asc' } });
    return rows.map(toProvider);
  }

  async findById(id: string): Promise<ProviderSettings | null> {
    const row = await this.prisma.provider.findUnique({ where: { id }, include: PROVIDER_INCLUDE });
    return row === null ? null : toProvider(row);
  }

  async update(id: string, updates: ProviderSettingsUpdate): Promise<ProviderSettings | 'NOT_FOUND' | 'PRIORITY_TAKEN'> {
    try {
      const row = await this.prisma.provider.update({ where: { id }, data: updates, include: PROVIDER_INCLUDE });
      return toProvider(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return 'NOT_FOUND';
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return 'PRIORITY_TAKEN';
      throw error;
    }
  }

  async updateLeague(providerId: string, leagueId: string, updates: ProviderLeagueSettingsUpdate): Promise<ProviderLeagueSettings | null> {
    // One statement scoped to the provider, so a league of another provider is never changed.
    const { count } = await this.prisma.providerLeague.updateMany({ where: { id: leagueId, providerId }, data: updates });
    if (count === 0) return null;
    const row = await this.prisma.providerLeague.findUniqueOrThrow({ where: { id: leagueId }, include: { sport: { select: { sport: true } } } });
    return toProviderLeague(row);
  }
}
