/**
 * ESPN Adapter — unofficial public API for NFL (and other sports).
 *
 * No API key required. Undocumented but stable endpoints widely used
 * by the fantasy sports community. Use as fallback/validation source.
 *
 * Base: https://site.api.espn.com/apis/site/v2/sports
 */

import { Sport } from '@poolmaster/shared/domain';
import type {
  SportDataProvider,
  DateRange,
  SportEvent,
  SportEventDetail,
  ProviderParticipant,
  ProviderRanking,
  ProviderStatEvent,
  ProviderEventResult,
  ProviderHealthStatus,
  ProviderParticipantResult,
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

  async getLiveScores(eventId: string): Promise<ProviderStatEvent[]> {
    // Use scoreboard to get live scores for a specific event
    const data = await this.fetch<EspnScoreboardResponse>(
      `/football/nfl/scoreboard?event=${eventId}`,
    );

    const stats: ProviderStatEvent[] = [];
    for (const event of data.events ?? []) {
      for (const comp of event.competitions ?? []) {
        for (const competitor of comp.competitors ?? []) {
          stats.push({
            id: `${eventId}-${competitor.id}-score`,
            eventExternalId: eventId,
            participantExternalId: competitor.id,
            statKey: 'TEAM_SCORE',
            statValue: parseFloat(competitor.score ?? '0'),
            timestamp: new Date(),
            isCorrection: false,
            providerId: this.providerId,
          });
        }
      }
    }
    return stats;
  }

  async getEventResults(eventId: string): Promise<ProviderEventResult | null> {
    const scores = await this.getLiveScores(eventId);
    if (scores.length === 0) return null;

    const sorted = [...scores].sort((a, b) => b.statValue - a.statValue);
    const results: ProviderParticipantResult[] = sorted.map((s, i) => ({
      participantExternalId: s.participantExternalId,
      finishPosition: i + 1,
      totalScore: s.statValue,
      dnf: false,
      stats: { score: s.statValue },
    }));

    return {
      eventExternalId: eventId,
      providerId: this.providerId,
      status: 'COMPLETED',
      results,
    };
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
