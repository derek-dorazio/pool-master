/**
 * PGA Tour Adapter — public golf data (schedule, rankings, leaderboards).
 *
 * No API key required. Uses the PGA Tour's public-facing data endpoints.
 * Golf pools are the primary PoolMaster use case.
 *
 * Endpoints:
 * - Schedule: https://statdata.pgatour.com/r/current/schedule.json (deprecated but available)
 * - Leaderboard: https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard
 * - World rankings: via ESPN golf endpoint
 *
 * Note: PGA Tour has migrated to a GraphQL API. We use a mix of legacy
 * JSON feeds and ESPN's golf endpoints as a stable public source.
 */

import { Sport } from '@poolmaster/shared/domain';
import type { GolfRoundUpdate, LiveScoreResult } from '@poolmaster/shared/dto';
import type {
  SportDataProvider,
  DateRange,
  SportEvent,
  SportEventDetail,
  ProviderParticipant,
  ProviderRanking,
  ProviderEventResult,
  ProviderHealthStatus,
  ProviderParticipantResult,
} from '../core/provider-interface';

const ESPN_GOLF_BASE = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga';
const ESPN_GOLF_WEB_BASE = 'https://site.web.api.espn.com/apis/site/v2/sports/golf/pga';

export class PgaTourAdapter implements SportDataProvider {
  providerId = 'pga-tour';
  providerName = 'PGA Tour';
  sportsCovered = [Sport.GOLF] as Sport[];

  async getUpcomingEvents(_sport: Sport, dateRange: DateRange): Promise<SportEvent[]> {
    const from = formatDate(dateRange.from);
    const to = formatDate(dateRange.to);

    const data = await this.fetch<EspnGolfScoreboard>(
      `${ESPN_GOLF_BASE}/scoreboard?dates=${from}-${to}`,
    );

    return (data.events ?? []).map((e) => {
      const comp = e.competitions?.[0];
      return {
        externalId: e.id,
        providerId: this.providerId,
        sport: Sport.GOLF,
        name: e.name,
        venue: comp?.venue?.fullName,
        location: comp?.venue?.address
          ? `${comp.venue.address.city}, ${comp.venue.address.state}`
          : undefined,
        startDate: new Date(e.date),
        endDate: comp?.endDate ? new Date(comp.endDate) : undefined,
        status: mapGolfStatus(e.status?.type?.name),
        rounds: 4,
        participantCount: comp?.field?.length,
        fieldLocked: false,
        metadata: {
          purse: e.purse,
          defendingChampion: e.defendingChampion,
          tournamentId: e.id,
        },
      };
    });
  }

  async getEventDetails(eventId: string): Promise<SportEventDetail | null> {
    const data = await this.fetch<EspnGolfScoreboard>(
      `${ESPN_GOLF_BASE}/scoreboard?event=${eventId}`,
    );

    if (!data.events?.length) return null;
    const event = data.events[0];
    const comp = event.competitions?.[0];

    // Get the field/leaderboard
    const leaderboard = await this.getLeaderboard(eventId);

    return {
      externalId: event.id,
      providerId: this.providerId,
      sport: Sport.GOLF,
      name: event.name,
      venue: comp?.venue?.fullName,
      location: comp?.venue?.address
        ? `${comp.venue.address.city}, ${comp.venue.address.state}`
        : undefined,
      startDate: new Date(event.date),
      endDate: comp?.endDate ? new Date(comp.endDate) : undefined,
      status: mapGolfStatus(event.status?.type?.name),
      rounds: 4,
      participantCount: leaderboard.length,
      fieldLocked: false,
      metadata: {},
      participants: leaderboard,
    };
  }

  async getParticipants(_sport: Sport): Promise<ProviderParticipant[]> {
    // Fetch from the latest tournament leaderboard to get active PGA Tour players
    const data = await this.fetch<EspnGolfScoreboard>(
      `${ESPN_GOLF_BASE}/scoreboard`,
    );

    if (!data.events?.length) return [];

    const eventId = data.events[0].id;
    return this.getLeaderboard(eventId);
  }

  async getRankings(_sport: Sport, _rankingType: string): Promise<ProviderRanking[]> {
    // ESPN golf rankings endpoint
    const data = await this.fetch<EspnGolfRankings>(
      `${ESPN_GOLF_WEB_BASE}/rankings`,
    );

    const rankings: ProviderRanking[] = [];
    for (const ranking of data.rankings ?? []) {
      for (const athlete of ranking.athletes ?? []) {
        rankings.push({
          participantExternalId: athlete.athlete?.id ?? '',
          rankingType: ranking.name ?? 'OWGR',
          rank: athlete.rank,
          points: athlete.points,
          asOfDate: new Date(),
        });
      }
    }
    return rankings;
  }

  /**
   * Emits a typed `LiveScoreResult` per plans/117 §10.2 by walking the
   * ESPN leaderboard and converting each round into a `GolfRoundUpdate`.
   *
   * ESPN's per-round payload exposes `roundNumber` + scoreToPar `score`
   * but not per-round strokes — `totalStrokes` is event-cumulative. The
   * adapter approximates per-round strokes as (par + scoreToPar) using a
   * notional par of 72; rop.78.7's contribution-table scoring path
   * recomputes from real round data once the live-scoring pipeline reads
   * SportEventParticipantGolfRound directly.
   */
  async getLiveScores(eventId: string): Promise<LiveScoreResult> {
    const data = await this.fetch<EspnGolfLeaderboard>(
      `${ESPN_GOLF_BASE}/leaderboard?event=${eventId}`,
    );

    const rounds: GolfRoundUpdate[] = [];

    for (const competitor of data.events?.[0]?.competitions?.[0]?.competitors ?? []) {
      const athlete = competitor.athlete;
      if (!athlete) continue;

      for (const round of competitor.rounds ?? []) {
        rounds.push({
          participantExternalId: athlete.id,
          round: round.roundNumber,
          scoreToPar: round.score,
          // Per-round strokes aren't exposed by the ESPN leaderboard;
          // approximate from par + scoreToPar using a notional par of 72
          // until rop.78.7 sources real per-round strokes.
          strokes: 72 + round.score,
          status: 'COMPLETED',
        });
      }
    }

    return { category: 'GOLF', rounds };
  }

  async getEventResults(eventId: string): Promise<ProviderEventResult | null> {
    const data = await this.fetch<EspnGolfLeaderboard>(
      `${ESPN_GOLF_BASE}/leaderboard?event=${eventId}`,
    );

    const competitors = data.events?.[0]?.competitions?.[0]?.competitors ?? [];
    if (competitors.length === 0) return null;

    const results: ProviderParticipantResult[] = competitors
      .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999))
      .map((c, index) => ({
        participantExternalId: c.athlete?.id ?? '',
        finishPosition: c.sortOrder ?? index + 1,
        totalScore: parseScore(c.score?.displayValue ?? '0'),
        totalStrokes: c.totalStrokes,
        dnf: c.status === 'WD' || c.status === 'CUT' || c.status === 'DQ',
        dnfReason: c.status === 'WD' ? 'WITHDRAWN' : c.status === 'CUT' ? 'MISSED_CUT' : c.status === 'DQ' ? 'DISQUALIFIED' : undefined,
        stats: {
          ...(c.totalStrokes !== undefined && { totalStrokes: c.totalStrokes }),
          ...(c.rounds?.reduce((acc, r) => {
            acc[`round${r.roundNumber}`] = r.score;
            return acc;
          }, {} as Record<string, number>) ?? {}),
        },
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
      await this.fetch<unknown>(`${ESPN_GOLF_BASE}/scoreboard`);
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

  /** Fetches leaderboard participants for an event. */
  private async getLeaderboard(eventId: string): Promise<ProviderParticipant[]> {
    const data = await this.fetch<EspnGolfLeaderboard>(
      `${ESPN_GOLF_BASE}/leaderboard?event=${eventId}`,
    );

    const competitors = data.events?.[0]?.competitions?.[0]?.competitors ?? [];

    return competitors.map((c) => ({
      externalId: c.athlete?.id ?? '',
      providerId: this.providerId,
      sport: Sport.GOLF,
      name: c.athlete?.displayName ?? '',
      firstName: c.athlete?.firstName,
      lastName: c.athlete?.lastName,
      nationality: c.athlete?.flag?.alt,
      photoUrl: c.athlete?.headshot?.href,
      active: true,
      metadata: {
        amateur: c.amateur ?? false,
        sortOrder: c.sortOrder,
        status: c.status,
      },
    }));
  }

  private async fetch<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`PGA Tour/ESPN Golf API error: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }
}

// --- ESPN Golf response types ---

interface EspnGolfScoreboard {
  events?: Array<{
    id: string;
    name: string;
    date: string;
    purse?: string;
    defendingChampion?: string;
    status?: { type?: { name?: string } };
    competitions?: Array<{
      venue?: {
        fullName?: string;
        address?: { city?: string; state?: string };
      };
      endDate?: string;
      field?: unknown[];
    }>;
  }>;
}

interface EspnGolfLeaderboard {
  events?: Array<{
    competitions?: Array<{
      competitors?: EspnGolfCompetitor[];
    }>;
  }>;
}

interface EspnGolfCompetitor {
  athlete?: {
    id: string;
    displayName: string;
    firstName?: string;
    lastName?: string;
    flag?: { alt?: string };
    headshot?: { href?: string };
  };
  score?: { displayValue?: string };
  totalStrokes?: number;
  sortOrder?: number;
  thru?: number;
  status?: string;
  amateur?: boolean;
  rounds?: Array<{
    roundNumber: number;
    score: number;
  }>;
}

interface EspnGolfRankings {
  rankings?: Array<{
    name?: string;
    athletes?: Array<{
      rank: number;
      points?: number;
      athlete?: { id: string };
    }>;
  }>;
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0].replace(/-/g, '');
}

function mapGolfStatus(status?: string): SportEvent['status'] {
  switch (status) {
    case 'STATUS_SCHEDULED':
      return 'SCHEDULED';
    case 'STATUS_IN_PROGRESS':
      return 'IN_PROGRESS';
    case 'STATUS_FINAL':
      return 'COMPLETED';
    case 'STATUS_CANCELLED':
    case 'STATUS_CANCELED':
      return 'CANCELLED';
    case 'STATUS_POSTPONED':
      return 'POSTPONED';
    default:
      return 'SCHEDULED';
  }
}

/** Parses golf score display values like "-5", "+3", "E" to numeric. */
function parseScore(display: string): number {
  if (display === 'E') return 0;
  const num = parseInt(display, 10);
  return isNaN(num) ? 0 : num;
}
