/**
 * ESPN Adapter — unofficial public API for NFL (and other sports).
 *
 * No API key required. Undocumented but stable endpoints widely used
 * by the fantasy sports community. Use as fallback/validation source.
 *
 * Base: https://site.api.espn.com/apis/site/v2/sports
 */

import { Sport } from '@poolmaster/shared/domain';
import type { LiveScoreResult } from '@poolmaster/shared/dto';
import {
  LiveScoreUnsupportedError,
  type SportDataProvider,
  type DateRange,
  type SportEvent,
  type SportEventDetail,
  type ProviderParticipant,
  type ProviderRanking,
  type ProviderEventResult,
  type ProviderHealthStatus,
} from '../core/provider-interface';

const BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports';

/** Maps PoolMaster sport to ESPN sport/league path. */
const ESPN_SPORT_PATH: Partial<Record<string, string>> = {
  NFL: 'football/nfl',
  NBA: 'basketball/nba',
  MLB: 'baseball/mlb',
  NHL: 'hockey/nhl',
  NCAA_BASKETBALL: 'basketball/mens-college-basketball',
  NCAA_FOOTBALL: 'football/college-football',
  SOCCER: 'soccer/eng.1',
  GOLF: 'golf/pga',
};

export class EspnAdapter implements SportDataProvider {
  providerId = 'espn';
  providerName = 'ESPN';
  sportsCovered = [
    Sport.NFL, Sport.NBA, Sport.MLB, Sport.NHL,
    Sport.NCAA_BASKETBALL, Sport.NCAA_FOOTBALL, Sport.SOCCER, Sport.GOLF,
  ] as Sport[];

  async getUpcomingEvents(sport: Sport, dateRange: DateRange): Promise<SportEvent[]> {
    const path = ESPN_SPORT_PATH[sport];
    if (!path) return [];

    const from = formatEspnDate(dateRange.from);
    const to = formatEspnDate(dateRange.to);

    const data = await this.fetch<EspnScoreboardResponse>(
      `/${path}/scoreboard?dates=${from}-${to}`,
    );

    return (data.events ?? []).map((e) => ({
      externalId: e.id,
      providerId: this.providerId,
      sport,
      name: e.name,
      venue: e.competitions?.[0]?.venue?.fullName,
      location: e.competitions?.[0]?.venue?.address
        ? `${e.competitions[0].venue.address.city}, ${e.competitions[0].venue.address.state}`
        : undefined,
      startDate: new Date(e.date),
      status: mapEspnStatus(e.status?.type?.name),
      fieldLocked: false,
      metadata: {
        shortName: e.shortName,
        seasonType: e.season?.type,
        week: e.week?.number,
        competitors: e.competitions?.[0]?.competitors?.map((competitor) => ({
          externalId: competitor.id,
          name: competitor.team?.displayName ?? competitor.team?.name,
          homeAway: competitor.homeAway,
        })) ?? [],
      },
    }));
  }

  async getEventDetails(eventId: string): Promise<SportEventDetail | null> {
    // ESPN event summary endpoint
    const data = await this.fetch<EspnEventSummary>(
      `/football/nfl/summary?event=${eventId}`,
    );
    if (!data.header) return null;

    const event = data.header;
    return {
      externalId: eventId,
      providerId: this.providerId,
      sport: Sport.NFL,
      name: event.gameNote ?? `Event ${eventId}`,
      startDate: new Date(),
      status: 'SCHEDULED',
      fieldLocked: false,
      metadata: {},
      participants: [],
    };
  }

  async getParticipants(sport: Sport): Promise<ProviderParticipant[]> {
    const path = ESPN_SPORT_PATH[sport];
    if (!path) return [];

    // ESPN teams endpoint — returns teams (for team sports)
    const data = await this.fetch<EspnTeamsResponse>(`/${path}/teams?limit=100`);

    return (data.sports?.[0]?.leagues?.[0]?.teams ?? []).map((t) => ({
      externalId: t.team.id,
      providerId: this.providerId,
      sport,
      name: t.team.displayName,
      shortName: t.team.abbreviation,
      teamAffiliation: t.team.displayName,
      photoUrl: t.team.logos?.[0]?.href,
      active: t.team.isActive ?? true,
      metadata: {
        color: t.team.color,
        alternateColor: t.team.alternateColor,
        location: t.team.location,
      },
    }));
  }

  async getRankings(sport: Sport, _rankingType: string): Promise<ProviderRanking[]> {
    const path = ESPN_SPORT_PATH[sport];
    if (!path) return [];

    // ESPN rankings are available for college sports
    if (sport !== Sport.NCAA_BASKETBALL && sport !== Sport.NCAA_FOOTBALL) return [];

    const data = await this.fetch<EspnRankingsResponse>(`/${path}/rankings`);

    const rankings: ProviderRanking[] = [];
    for (const poll of data.rankings ?? []) {
      for (const rank of poll.ranks ?? []) {
        rankings.push({
          participantExternalId: rank.team?.id ?? '',
          rankingType: poll.name ?? 'AP',
          rank: rank.current,
          points: rank.points,
          asOfDate: new Date(),
        });
      }
    }
    return rankings;
  }

  async getLiveScores(_eventId: string): Promise<LiveScoreResult> {
    // pool-master-rop.78.3 — Phase 4 only ships golf-roster providers per
    // plans/117 §3.1. The ESPN multi-sport adapter covers NFL/NBA/MLB/NHL
    // whose LiveScoreResult variants are shape-locked but not yet wired.
    // Throw rather than silently emit an empty result.
    throw new LiveScoreUnsupportedError(this.providerId, 'multi-sport');
  }

  async getEventResults(_eventId: string): Promise<ProviderEventResult | null> {
    // ESPN's per-sport result shape varied; the legacy path synthesized
    // results from getLiveScores by sorting on statValue. With the typed
    // LiveScoreResult contract (plans/117 §10.2) the synthesis no longer
    // fits. Return null until a future per-sport ESPN slice rebuilds this
    // against the typed substrate.
    return null;
  }

  async healthCheck(): Promise<ProviderHealthStatus> {
    try {
      const start = Date.now();
      await this.fetch<unknown>('/football/nfl/scoreboard');
      const latency = Date.now() - start;

      return {
        providerId: this.providerId,
        status: 'HEALTHY',
        lastSuccessfulPoll: new Date(),
        errorRateLastHour: 0,
        latencyMsP95: latency,
      };
    } catch {
      return {
        providerId: this.providerId,
        status: 'DOWN',
        errorRateLastHour: 1,
        latencyMsP95: 0,
        message: 'Health check failed',
      };
    }
  }

  private async fetch<T>(path: string): Promise<T> {
    const response = await fetch(`${BASE_URL}${path}`);
    if (!response.ok) {
      throw new Error(`ESPN API error: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }
}

// --- ESPN response types (partial — API is undocumented) ---

interface EspnScoreboardResponse {
  events?: EspnEvent[];
}

interface EspnEvent {
  id: string;
  name: string;
  shortName?: string;
  date: string;
  status?: { type?: { name?: string } };
  season?: { type?: number };
  week?: { number?: number };
  competitions?: EspnCompetition[];
}

interface EspnCompetition {
  venue?: {
    fullName?: string;
    address?: { city?: string; state?: string };
  };
  competitors?: EspnCompetitor[];
}

interface EspnCompetitor {
  id: string;
  score?: string;
  homeAway?: string;
  winner?: boolean;
  team?: {
    id?: string;
    displayName?: string;
    name?: string;
  };
}

interface EspnTeamsResponse {
  sports?: Array<{
    leagues?: Array<{
      teams?: Array<{
        team: {
          id: string;
          displayName: string;
          abbreviation?: string;
          location?: string;
          color?: string;
          alternateColor?: string;
          isActive?: boolean;
          logos?: Array<{ href: string }>;
        };
      }>;
    }>;
  }>;
}

interface EspnRankingsResponse {
  rankings?: Array<{
    name?: string;
    ranks?: Array<{
      current: number;
      points?: number;
      team?: { id: string };
    }>;
  }>;
}

interface EspnEventSummary {
  header?: { gameNote?: string };
}

function formatEspnDate(date: Date): string {
  return date.toISOString().split('T')[0].replace(/-/g, '');
}

function mapEspnStatus(status?: string): SportEvent['status'] {
  switch (status) {
    case 'STATUS_SCHEDULED':
    case 'STATUS_POSTPONED':
      return 'SCHEDULED';
    case 'STATUS_IN_PROGRESS':
    case 'STATUS_HALFTIME':
    case 'STATUS_END_PERIOD':
      return 'IN_PROGRESS';
    case 'STATUS_FINAL':
    case 'STATUS_FINAL_OT':
      return 'COMPLETED';
    case 'STATUS_CANCELED':
    case 'STATUS_CANCELLED':
      return 'CANCELLED';
    default:
      return 'SCHEDULED';
  }
}
