/**
 * The Odds API Adapter — odds data for budget pick pricing.
 * https://the-odds-api.com
 *
 * Free tier: 500 requests/month. Covers all major sports.
 * Requires API key (set via ODDS_API_KEY env var).
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
} from '../core/provider-interface';

const BASE_URL = 'https://api.the-odds-api.com/v4';

/** Maps PoolMaster sport to The Odds API sport key. */
const SPORT_KEY_MAP: Partial<Record<string, string>> = {
  GOLF: 'golf_pga',
  NFL: 'americanfootball_nfl',
  NBA: 'basketball_nba',
  NCAA_BASKETBALL: 'basketball_ncaab',
  NHL: 'icehockey_nhl',
  MLB: 'baseball_mlb',
  SOCCER: 'soccer_epl',
  TENNIS: 'tennis_atp_us_open', // varies by tournament
  F1: 'motorsport_formula_one',
  UFC: 'mma_mixed_martial_arts',
};

export interface OddsData {
  eventId: string;
  sport: Sport;
  homeTeam: string;
  awayTeam: string;
  commenceTime: Date;
  odds: BookmakerOdds[];
}

export interface BookmakerOdds {
  bookmaker: string;
  markets: Market[];
}

export interface Market {
  key: string; // 'h2h', 'spreads', 'totals', 'outrights'
  outcomes: Outcome[];
}

export interface Outcome {
  name: string;
  price: number; // decimal odds
  point?: number;
}

export class OddsApiAdapter implements SportDataProvider {
  providerId = 'the-odds-api';
  providerName = 'The Odds API';
  sportsCovered = [
    Sport.GOLF, Sport.NFL, Sport.NBA, Sport.NCAA_BASKETBALL,
    Sport.NHL, Sport.MLB, Sport.SOCCER, Sport.F1, Sport.UFC,
  ] as Sport[];

  private readonly apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.ODDS_API_KEY ?? '';
  }

  async getUpcomingEvents(sport: Sport, _dateRange: DateRange): Promise<SportEvent[]> {
    const sportKey = SPORT_KEY_MAP[sport];
    if (!sportKey) return [];

    const data = await this.fetch<OddsApiEvent[]>(
      `/sports/${sportKey}/odds?regions=us&markets=h2h`,
    );

    return data.map((e) => ({
      externalId: e.id,
      providerId: this.providerId,
      sport,
      name: `${e.home_team} vs ${e.away_team}`,
      startDate: new Date(e.commence_time),
      status: 'SCHEDULED' as const,
      fieldLocked: false,
      metadata: {
        homeTeam: e.home_team,
        awayTeam: e.away_team,
        sportKey: e.sport_key,
        competitors: [
          { name: e.home_team, homeAway: 'home' },
          { name: e.away_team, homeAway: 'away' },
        ],
      },
    }));
  }

  async getEventDetails(_eventId: string): Promise<SportEventDetail | null> {
    // Odds API doesn't provide event details beyond what getUpcomingEvents returns
    return null;
  }

  async getParticipants(_sport: Sport): Promise<ProviderParticipant[]> {
    // Odds API doesn't provide participant lists — use another provider for this
    return [];
  }

  async getRankings(_sport: Sport, _rankingType: string): Promise<ProviderRanking[]> {
    return [];
  }

  async getLiveScores(_eventId: string): Promise<ProviderStatEvent[]> {
    // Odds API provides odds, not scores
    return [];
  }

  async getEventResults(_eventId: string): Promise<ProviderEventResult | null> {
    return null;
  }

  /**
   * Primary value: fetch odds for events in a sport.
   * Returns structured odds data for budget pick pricing.
   */
  async getOdds(sport: Sport, market = 'h2h'): Promise<OddsData[]> {
    const sportKey = SPORT_KEY_MAP[sport];
    if (!sportKey) return [];

    const data = await this.fetch<OddsApiEvent[]>(
      `/sports/${sportKey}/odds?regions=us&markets=${market}`,
    );

    return data.map((e) => ({
      eventId: e.id,
      sport,
      homeTeam: e.home_team,
      awayTeam: e.away_team,
      commenceTime: new Date(e.commence_time),
      odds: e.bookmakers.map((bm) => ({
        bookmaker: bm.key,
        markets: bm.markets.map((m) => ({
          key: m.key,
          outcomes: m.outcomes.map((o) => ({
            name: o.name,
            price: o.price,
            point: o.point,
          })),
        })),
      })),
    }));
  }

  /**
   * Returns outright/futures odds (e.g., tournament winner) as implied probabilities.
   * Useful for golf tournament pricing.
   */
  async getOutrightOdds(sport: Sport): Promise<Map<string, number>> {
    const sportKey = SPORT_KEY_MAP[sport];
    if (!sportKey) return new Map();

    const data = await this.fetch<OddsApiEvent[]>(
      `/sports/${sportKey}/odds?regions=us&markets=outrights`,
    );

    // Average implied probability across bookmakers for each participant
    const probMap = new Map<string, number[]>();

    for (const event of data) {
      for (const bm of event.bookmakers) {
        for (const market of bm.markets) {
          if (market.key !== 'outrights') continue;
          for (const outcome of market.outcomes) {
            const impliedProb = 1 / outcome.price;
            const existing = probMap.get(outcome.name) ?? [];
            existing.push(impliedProb);
            probMap.set(outcome.name, existing);
          }
        }
      }
    }

    // Average the probabilities
    const result = new Map<string, number>();
    for (const [name, probs] of probMap) {
      result.set(name, probs.reduce((a, b) => a + b, 0) / probs.length);
    }
    return result;
  }

  async healthCheck(): Promise<ProviderHealthStatus> {
    try {
      const start = Date.now();
      await this.fetch<unknown[]>('/sports');
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
    const separator = path.includes('?') ? '&' : '?';
    const url = `${BASE_URL}${path}${separator}apiKey=${this.apiKey}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Odds API error: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }
}

// --- Odds API response types ---

interface OddsApiEvent {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
}

interface OddsApiBookmaker {
  key: string;
  title: string;
  markets: OddsApiMarket[];
}

interface OddsApiMarket {
  key: string;
  outcomes: OddsApiOutcome[];
}

interface OddsApiOutcome {
  name: string;
  price: number;
  point?: number;
}
