/**
 * SearchService — PostgreSQL full-text search for participants, leagues, and contests.
 *
 * Phase 1: Uses PostgreSQL tsvector/plainto_tsquery for relevance-ranked search.
 * Phase 2 (future): Swap to Elasticsearch when scale requires it.
 */

import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type {
  CommissionerPermission,
  LeagueMembership,
  Participant,
  InjuryStatus,
} from '@poolmaster/shared/domain';
import { InvitePolicy, LeagueRole } from '@poolmaster/shared/domain';
import type { ParticipantStatus } from '@poolmaster/shared/domain';

// --- Participant Search (PostgreSQL full-text) ---

export interface ParticipantSearchOptions {
  query: string;
  sportId?: string;
  status?: string[];
  position?: string[];
  teamAffiliation?: string[];
  nationality?: string[];
  sortBy?: 'RELEVANCE' | 'RANKING' | 'NAME' | 'PRICE' | 'FORM';
  limit?: number;
  offset?: number;
}

export interface ParticipantSearchResult {
  participants: Participant[];
  total: number;
  facets: SearchFacets;
}

export interface SearchFacets {
  positions: FacetBucket[];
  teams: FacetBucket[];
  nationalities: FacetBucket[];
  rankingDistribution: {
    top10: number;
    top25: number;
    top50: number;
    top100: number;
    unranked: number;
  };
}

export interface FacetBucket {
  value: string;
  count: number;
}

export class DiscoverLeagueJoinError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'DiscoverLeagueJoinError';
  }
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class SearchService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Full-text participant search using PostgreSQL.
   *
   * Uses to_tsvector/plainto_tsquery for relevance scoring when a query is provided.
   * Falls back to regular filtered queries when no text query.
   */
  async searchParticipants(options: ParticipantSearchOptions): Promise<ParticipantSearchResult> {
    const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = options.offset ?? 0;
    const hasQuery = options.query.trim().length > 0;
    const sportId = await this.resolveSportId(options.sportId);

    if (options.sportId && !sportId) {
      return {
        participants: [],
        total: 0,
        facets: emptyFacets(),
      };
    }

    if (hasQuery) {
      return this.fullTextSearch({ ...options, sportId }, limit, offset);
    } else {
      return this.filteredSearch({ ...options, sportId }, limit, offset);
    }
  }

  private async resolveSportId(sportIdOrName?: string): Promise<string | undefined> {
    if (!sportIdOrName) {
      return undefined;
    }

    if (UUID_PATTERN.test(sportIdOrName)) {
      return sportIdOrName;
    }

    const sport = await this.prisma.sport.findFirst({
      where: {
        name: {
          equals: sportIdOrName,
          mode: 'insensitive',
        },
      },
      select: { id: true },
    });

    return sport?.id;
  }

  /**
   * PostgreSQL full-text search with ts_rank relevance scoring.
   */
  private async fullTextSearch(
    options: ParticipantSearchOptions,
    limit: number,
    offset: number,
  ): Promise<ParticipantSearchResult> {
    const query = options.query.trim();

    // Build WHERE clauses
    const conditions: string[] = [`status = 'ACTIVE'`];
    const params: unknown[] = [query]; // $1 = search query

    if (options.sportId) {
      params.push(options.sportId);
      conditions.push(`sport_id = $${params.length}::uuid`);
    }
    if (options.status && options.status.length > 0) {
      params.push(options.status);
      conditions.push(`status = ANY($${params.length}::text[])`);
    }
    if (options.position && options.position.length > 0) {
      params.push(options.position);
      conditions.push(`position = ANY($${params.length}::text[])`);
    }
    if (options.teamAffiliation && options.teamAffiliation.length > 0) {
      params.push(options.teamAffiliation);
      conditions.push(`team_affiliation = ANY($${params.length}::text[])`);
    }
    if (options.nationality && options.nationality.length > 0) {
      params.push(options.nationality);
      conditions.push(`nationality = ANY($${params.length}::text[])`);
    }

    const whereClause = conditions.join(' AND ');

    // Build ORDER BY
    let orderBy: string;
    switch (options.sortBy) {
      case 'RANKING':
        orderBy = 'ORDER BY (metadata->>\'world_ranking\')::int NULLS LAST';
        break;
      case 'NAME':
        orderBy = 'ORDER BY name ASC';
        break;
      default:
        // RELEVANCE — use ts_rank
        orderBy = `ORDER BY ts_rank(
          setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(first_name, '')), 'B') ||
          setweight(to_tsvector('english', coalesce(last_name, '')), 'B') ||
          setweight(to_tsvector('english', coalesce(team_affiliation, '')), 'C'),
          plainto_tsquery('english', $1)
        ) DESC, name ASC`;
    }

    // Main search query
    const searchSql = `
      SELECT *
      FROM participants
      WHERE (
        setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(first_name, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(last_name, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(team_affiliation, '')), 'C')
      ) @@ plainto_tsquery('english', $1)
      AND ${whereClause}
      ${orderBy}
      LIMIT ${limit} OFFSET ${offset}
    `;

    // Count query
    const countSql = `
      SELECT COUNT(*)::int as total
      FROM participants
      WHERE (
        setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(first_name, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(last_name, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(team_affiliation, '')), 'C')
      ) @@ plainto_tsquery('english', $1)
      AND ${whereClause}
    `;

    const [rows, countResult] = await Promise.all([
      this.prisma.$queryRawUnsafe<RawParticipant[]>(searchSql, ...params),
      this.prisma.$queryRawUnsafe<[{ total: number }]>(countSql, ...params),
    ]);

    const participants = rows.map(mapRawToParticipant);
    const total = countResult[0]?.total ?? 0;

    // Compute facets from a broader result set (no LIMIT)
    const facets = await this.computeFacets(options);

    return { participants, total, facets };
  }

  /**
   * Filtered search without full-text (when no query string provided).
   */
  private async filteredSearch(
    options: ParticipantSearchOptions,
    limit: number,
    offset: number,
  ): Promise<ParticipantSearchResult> {
    const where: Prisma.ParticipantWhereInput = { status: 'ACTIVE' };

    if (options.sportId) where.sportId = options.sportId;
    if (options.status && options.status.length > 0) where.status = { in: options.status };
    if (options.position && options.position.length > 0) where.position = { in: options.position };
    if (options.teamAffiliation && options.teamAffiliation.length > 0) {
      where.teamAffiliation = { in: options.teamAffiliation };
    }
    if (options.nationality && options.nationality.length > 0) {
      where.nationality = { in: options.nationality };
    }

    const orderBy = this.getOrderBy(options.sortBy);

    const [rows, total] = await Promise.all([
      this.prisma.participant.findMany({ where, orderBy, take: limit, skip: offset }),
      this.prisma.participant.count({ where }),
    ]);

    const participants = rows.map((r) => mapPrismaToParticipant(r));
    const facets = await this.computeFacets(options);

    return { participants, total, facets };
  }

  /**
   * Computes facet counts for the current filter set (excluding the facet being counted).
   */
  private async computeFacets(options: ParticipantSearchOptions): Promise<SearchFacets> {
    const baseWhere: Prisma.ParticipantWhereInput = { status: 'ACTIVE' };
    if (options.sportId) baseWhere.sportId = options.sportId;

    // Position facets
    const positionCounts = await this.prisma.participant.groupBy({
      by: ['position'],
      where: { ...baseWhere, position: { not: null } },
      _count: true,
      orderBy: { _count: { position: 'desc' } },
    });

    // Team facets
    const teamCounts = await this.prisma.participant.groupBy({
      by: ['teamAffiliation'],
      where: { ...baseWhere, teamAffiliation: { not: null } },
      _count: true,
      orderBy: { _count: { teamAffiliation: 'desc' } },
      take: 30,
    });

    // Nationality facets
    const nationalityCounts = await this.prisma.participant.groupBy({
      by: ['nationality'],
      where: { ...baseWhere, nationality: { not: null } },
      _count: true,
      orderBy: { _count: { nationality: 'desc' } },
      take: 30,
    });

    // Ranking distribution (from metadata JSON — simplified)
    const totalActive = await this.prisma.participant.count({ where: baseWhere });

    return {
      positions: positionCounts.map((p) => ({ value: p.position!, count: p._count })),
      teams: teamCounts.map((t) => ({ value: t.teamAffiliation!, count: t._count })),
      nationalities: nationalityCounts.map((n) => ({ value: n.nationality!, count: n._count })),
      rankingDistribution: {
        top10: 0, // Populated when season records have rankings
        top25: 0,
        top50: 0,
        top100: 0,
        unranked: totalActive,
      },
    };
  }

  private getOrderBy(sortBy?: string): Prisma.ParticipantOrderByWithRelationInput {
    switch (sortBy) {
      case 'NAME': return { name: 'asc' };
      case 'RANKING': return { name: 'asc' }; // Would use metadata->>'world_ranking' with raw SQL
      default: return { name: 'asc' };
    }
  }

  // --- League Discovery Search ---

  async searchLeagues(options: {
    query?: string;
    sport?: string;
    sortBy?: 'POPULAR' | 'NEWEST' | 'ACTIVITY';
    limit?: number;
    offset?: number;
  }): Promise<{ leagues: unknown[]; total: number }> {
    const limit = Math.min(options.limit ?? 20, 50);
    const offset = options.offset ?? 0;

    const where: Prisma.DiscoverableLeagueWhereInput = { isHidden: false };

    if (options.sport) {
      where.sports = { has: options.sport };
    }

    if (options.query?.trim()) {
      where.name = { contains: options.query.trim(), mode: 'insensitive' };
    }

    let orderBy: Prisma.DiscoverableLeagueOrderByWithRelationInput;
    switch (options.sortBy) {
      case 'NEWEST': orderBy = { createdAt: 'desc' }; break;
      case 'ACTIVITY': orderBy = { lastActivityAt: 'desc' }; break;
      default: orderBy = { memberCount: 'desc' }; break; // POPULAR
    }

    const [leagues, total] = await Promise.all([
      this.prisma.discoverableLeague.findMany({ where, orderBy, take: limit, skip: offset }),
      this.prisma.discoverableLeague.count({ where }),
    ]);

    const leagueIds = leagues.map((league) => league.id);
    const ownerMemberships = leagueIds.length > 0
      ? await this.prisma.leagueMembership.findMany({
          where: {
            leagueId: { in: leagueIds },
            role: LeagueRole.OWNER,
          },
          include: {
            user: {
              select: { displayName: true },
            },
          },
        })
      : [];

    const commissionerNameByLeagueId = new Map(
      ownerMemberships.map((membership) => [membership.leagueId, membership.user.displayName]),
    );

    return {
      leagues: leagues.map((league) => ({
        ...league,
        commissionerName: commissionerNameByLeagueId.get(league.id) ?? null,
        visibility: 'PUBLIC',
      })),
      total,
    };
  }

  // --- Contest Discovery Search ---

  async searchContests(options: {
    query?: string;
    sport?: string;
    sortBy?: 'STARTING_SOON' | 'POPULAR' | 'PRIZE_POOL';
    limit?: number;
    offset?: number;
  }): Promise<{ contests: unknown[]; total: number }> {
    const limit = Math.min(options.limit ?? 20, 50);
    const offset = options.offset ?? 0;

    const where: Prisma.DiscoverableContestWhereInput = {
      status: { in: ['OPEN', 'DRAFTING'] },
    };

    if (options.sport) where.sport = options.sport;
    if (options.query?.trim()) {
      where.contestName = { contains: options.query.trim(), mode: 'insensitive' };
    }

    let orderBy: Prisma.DiscoverableContestOrderByWithRelationInput;
    switch (options.sortBy) {
      case 'POPULAR': orderBy = { memberCount: 'desc' }; break;
      case 'PRIZE_POOL': orderBy = { prizePool: 'desc' }; break;
      default: orderBy = { lockTime: 'asc' }; break; // STARTING_SOON
    }

    const [contests, total] = await Promise.all([
      this.prisma.discoverableContest.findMany({ where, orderBy, take: limit, skip: offset }),
      this.prisma.discoverableContest.count({ where }),
    ]);

    return { contests, total };
  }

  async joinDiscoverableLeague(leagueId: string, userId: string): Promise<LeagueMembership> {
    const discoverableLeague = await this.prisma.discoverableLeague.findFirst({
      where: { id: leagueId, isHidden: false },
    });
    if (!discoverableLeague) {
      throw new DiscoverLeagueJoinError('League not found', 'NOT_FOUND', 404);
    }

    if (discoverableLeague.joinPolicy !== InvitePolicy.OPEN) {
      throw new DiscoverLeagueJoinError(
        'Join requests for non-open leagues are not implemented yet',
        'JOIN_REQUEST_UNSUPPORTED',
        501,
      );
    }

    const league = await this.prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true, maxMembers: true, visibility: true },
    });
    if (!league || league.visibility !== 'PUBLIC') {
      throw new DiscoverLeagueJoinError('League not found', 'NOT_FOUND', 404);
    }

    const now = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      const existingMembership = await tx.leagueMembership.findUnique({
        where: { leagueId_userId: { leagueId, userId } },
      });
      if (existingMembership) {
        throw new DiscoverLeagueJoinError(
          'You are already a member of this league',
          'ALREADY_MEMBER',
          409,
        );
      }

      if (league.maxMembers != null) {
        const memberCount = await tx.leagueMembership.count({
          where: { leagueId },
        });
        if (memberCount >= league.maxMembers) {
          throw new DiscoverLeagueJoinError(
            'League has reached its member limit',
            'LEAGUE_FULL',
            400,
          );
        }
      }

      const membership = await tx.leagueMembership.create({
        data: {
          leagueId,
          userId,
          role: LeagueRole.MANAGER,
          permissions: [],
          joinedAt: now,
        },
      });

      await tx.discoverableLeague.update({
        where: { id: leagueId },
        data: {
          memberCount: { increment: 1 },
          lastActivityAt: now,
        },
      });

      return membership;
    });

    const permissions = Array.isArray(row.permissions)
      ? (row.permissions as CommissionerPermission[])
      : [];

    return {
      id: row.id,
      leagueId: row.leagueId,
      userId: row.userId,
      role: row.role as LeagueMembership['role'],
      permissions,
      joinedAt: row.joinedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

function emptyFacets(): SearchFacets {
  return {
    positions: [],
    teams: [],
    nationalities: [],
    rankingDistribution: {
      top10: 0,
      top25: 0,
      top50: 0,
      top100: 0,
      unranked: 0,
    },
  };
}

// --- Raw SQL row mapping ---

interface RawParticipant {
  id: string;
  sport_id: string;
  name: string;
  participant_type: string;
  external_id: string | null;
  metadata: unknown;
  first_name: string | null;
  last_name: string | null;
  short_name: string | null;
  nationality: string | null;
  position: string | null;
  team_affiliation: string | null;
  status: string;
  injury_status: unknown;
  photo_url: string | null;
  photo_last_updated: Date | null;
  external_ids: unknown;
  created_at: Date;
  updated_at: Date;
}

function mapRawToParticipant(row: RawParticipant): Participant {
  return {
    id: row.id,
    sportId: row.sport_id,
    name: row.name,
    participantType: row.participant_type as Participant['participantType'],
    externalId: row.external_id ?? undefined,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    firstName: row.first_name ?? undefined,
    lastName: row.last_name ?? undefined,
    shortName: row.short_name ?? undefined,
    nationality: row.nationality ?? undefined,
    position: row.position ?? undefined,
    teamAffiliation: row.team_affiliation ?? undefined,
    status: row.status as ParticipantStatus,
    injuryStatus: (row.injury_status ?? { status: 'HEALTHY' }) as InjuryStatus,
    photoUrl: row.photo_url ?? undefined,
    photoLastUpdated: row.photo_last_updated ?? undefined,
    externalIds: (row.external_ids ?? {}) as Record<string, string>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPrismaToParticipant(row: {
  id: string; sportId: string; name: string; participantType: string;
  externalId: string | null; metadata: unknown; firstName: string | null;
  lastName: string | null; shortName: string | null; nationality: string | null;
  position: string | null; teamAffiliation: string | null; status: string;
  injuryStatus: unknown; photoUrl: string | null; photoLastUpdated: Date | null;
  externalIds: unknown; createdAt: Date; updatedAt: Date;
}): Participant {
  return {
    id: row.id, sportId: row.sportId, name: row.name,
    participantType: row.participantType as Participant['participantType'],
    externalId: row.externalId ?? undefined,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    firstName: row.firstName ?? undefined, lastName: row.lastName ?? undefined,
    shortName: row.shortName ?? undefined, nationality: row.nationality ?? undefined,
    position: row.position ?? undefined, teamAffiliation: row.teamAffiliation ?? undefined,
    status: row.status as ParticipantStatus,
    injuryStatus: (row.injuryStatus ?? { status: 'HEALTHY' }) as InjuryStatus,
    photoUrl: row.photoUrl ?? undefined, photoLastUpdated: row.photoLastUpdated ?? undefined,
    externalIds: (row.externalIds ?? {}) as Record<string, string>,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}
