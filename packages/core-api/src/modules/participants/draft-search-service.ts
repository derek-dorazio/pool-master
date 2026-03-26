/**
 * DraftSearchService — search within a contest pool for draft room context.
 *
 * Returns participants with pool-specific data (cost, tier, availability)
 * and drafted status. Designed for sub-100ms response in the draft room.
 */

import type {
  ContestParticipantPoolRepository,
  ContestPoolRepository,
  ParticipantRepository,
} from '@poolmaster/shared/db';
import type {
  Participant,
  ContestParticipantPool,
  InjuryStatus,
} from '@poolmaster/shared/domain';
import type { Sport } from '@poolmaster/shared/domain';
import { resolvePhotoUrl } from './fallback-photos';

export interface DraftSearchItem {
  participantId: string;
  displayName: string;
  photoUrl: string;
  sport: string;
  position?: string;
  teamAffiliation?: string;
  nationality?: string;
  ranking?: number;
  budgetPrice?: number;
  tier?: string;
  injuryStatus: InjuryStatus;
  isAvailable: boolean;
  unavailableReason?: string;
  isDrafted: boolean;
}

export interface DraftSearchResult {
  participants: DraftSearchItem[];
  total: number;
  facets: SearchFacets;
}

export interface SearchFacets {
  positions: FacetBucket[];
  teams: FacetBucket[];
  nationalities: FacetBucket[];
  tiers: FacetBucket[];
  injuryStatuses: FacetBucket[];
}

export interface FacetBucket {
  value: string;
  count: number;
}

export interface DraftSearchInput {
  contestId: string;
  query?: string;
  position?: string[];
  team?: string[];
  tier?: string;
  availableOnly?: boolean;
  undraftedOnly?: boolean;
  draftedParticipantIds?: string[];
  limit?: number;
  offset?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export class DraftSearchService {
  constructor(
    private readonly poolRepo: ContestPoolRepository,
    private readonly poolParticipantRepo: ContestParticipantPoolRepository,
    private readonly participantRepo: ParticipantRepository,
  ) {}

  /**
   * Searches within a contest's participant pool with draft-room context.
   * Filters, facets, and drafted status are all resolved in-memory from
   * the pool participants list (typically <500 entries).
   */
  async search(input: DraftSearchInput): Promise<DraftSearchResult> {
    const pool = await this.poolRepo.findByContest(input.contestId);
    if (!pool) return { participants: [], total: 0, facets: emptyFacets() };

    const poolParticipants = await this.poolParticipantRepo.findByPool(pool.id);
    if (poolParticipants.length === 0) {
      return { participants: [], total: 0, facets: emptyFacets() };
    }

    // Fetch all participant profiles for the pool
    const participantIds = poolParticipants.map((pp) => pp.participantId);
    const participantMap = new Map<string, Participant>();
    for (const pp of poolParticipants) {
      const participant = await this.participantRepo.findById(pp.participantId);
      if (participant) participantMap.set(participant.id, participant);
    }

    const draftedSet = new Set(input.draftedParticipantIds ?? []);

    // Join pool participants with profiles
    let items: DraftSearchItem[] = poolParticipants
      .filter((pp) => participantMap.has(pp.participantId))
      .map((pp) => {
        const p = participantMap.get(pp.participantId)!;
        return {
          participantId: p.id,
          displayName: p.name,
          photoUrl: resolvePhotoUrl(p.photoUrl, pool.sport as Sport, p.position),
          sport: pool.sport,
          position: p.position,
          teamAffiliation: p.teamAffiliation,
          nationality: p.nationality,
          ranking: pp.ranking,
          budgetPrice: pp.cost,
          tier: pp.tier,
          injuryStatus: p.injuryStatus,
          isAvailable: pp.isAvailable,
          unavailableReason: pp.unavailableReason,
          isDrafted: draftedSet.has(p.id),
        };
      });

    // Build facets from full unfiltered set
    const facets = buildFacets(items);

    // Apply filters
    if (input.query) {
      const q = input.query.toLowerCase();
      items = items.filter(
        (item) =>
          item.displayName.toLowerCase().includes(q) ||
          (item.teamAffiliation?.toLowerCase().includes(q) ?? false) ||
          (item.position?.toLowerCase().includes(q) ?? false),
      );
    }
    if (input.position && input.position.length > 0) {
      const posSet = new Set(input.position);
      items = items.filter((item) => item.position && posSet.has(item.position));
    }
    if (input.team && input.team.length > 0) {
      const teamSet = new Set(input.team);
      items = items.filter((item) => item.teamAffiliation && teamSet.has(item.teamAffiliation));
    }
    if (input.tier) {
      items = items.filter((item) => item.tier === input.tier);
    }
    if (input.availableOnly) {
      items = items.filter((item) => item.isAvailable);
    }
    if (input.undraftedOnly) {
      items = items.filter((item) => !item.isDrafted);
    }

    const total = items.length;
    const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = input.offset ?? 0;
    const paged = items.slice(offset, offset + limit);

    return { participants: paged, total, facets };
  }
}

function buildFacets(items: DraftSearchItem[]): SearchFacets {
  const positions = new Map<string, number>();
  const teams = new Map<string, number>();
  const nationalities = new Map<string, number>();
  const tiers = new Map<string, number>();
  const injuryStatuses = new Map<string, number>();

  for (const item of items) {
    if (item.position) increment(positions, item.position);
    if (item.teamAffiliation) increment(teams, item.teamAffiliation);
    if (item.nationality) increment(nationalities, item.nationality);
    if (item.tier) increment(tiers, item.tier);
    increment(injuryStatuses, item.injuryStatus.status);
  }

  return {
    positions: mapToFacets(positions),
    teams: mapToFacets(teams),
    nationalities: mapToFacets(nationalities),
    tiers: mapToFacets(tiers),
    injuryStatuses: mapToFacets(injuryStatuses),
  };
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function mapToFacets(map: Map<string, number>): FacetBucket[] {
  return Array.from(map.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}

function emptyFacets(): SearchFacets {
  return { positions: [], teams: [], nationalities: [], tiers: [], injuryStatuses: [] };
}
