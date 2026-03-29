/**
 * OpenF1 Adapter — free, open-source F1 live timing data.
 * https://openf1.org
 *
 * Covers: sessions (races, qualifying, practice), drivers, lap data, positions.
 * No API key required.
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

const BASE_URL = 'https://api.openf1.org/v1';

export class OpenF1Adapter implements SportDataProvider {
  providerId = 'openf1';
  providerName = 'OpenF1';
  sportsCovered = [Sport.F1] as Sport[];

  async getUpcomingEvents(_sport: Sport, dateRange: DateRange): Promise<SportEvent[]> {
    const params = new URLSearchParams({
      date_start: `>=${dateRange.from.toISOString().split('T')[0]}`,
      date_end: `<=${dateRange.to.toISOString().split('T')[0]}`,
      session_type: 'Race',
    });

    const sessions = await this.fetch<OpenF1Session[]>(`/sessions?${params}`);

    return sessions.map((s) => ({
      externalId: String(s.session_key),
      providerId: this.providerId,
      sport: Sport.F1,
      name: `${s.meeting_name} — ${s.session_name}`,
      venue: s.circuit_short_name,
      location: `${s.location}, ${s.country_name}`,
      startDate: new Date(s.date_start),
      endDate: s.date_end ? new Date(s.date_end) : undefined,
      status: mapSessionStatus(s),
      rounds: undefined,
      participantCount: undefined,
      fieldLocked: false,
      metadata: {
        meetingKey: s.meeting_key,
        sessionKey: s.session_key,
        sessionType: s.session_type,
        circuitKey: s.circuit_key,
        year: s.year,
      },
    }));
  }

  async getEventDetails(eventId: string): Promise<SportEventDetail | null> {
    const sessions = await this.fetch<OpenF1Session[]>(
      `/sessions?session_key=${eventId}`,
    );
    if (sessions.length === 0) return null;

    const session = sessions[0];
    const drivers = await this.getParticipants(Sport.F1);

    return {
      externalId: String(session.session_key),
      providerId: this.providerId,
      sport: Sport.F1,
      name: `${session.meeting_name} — ${session.session_name}`,
      venue: session.circuit_short_name,
      location: `${session.location}, ${session.country_name}`,
      startDate: new Date(session.date_start),
      endDate: session.date_end ? new Date(session.date_end) : undefined,
      status: mapSessionStatus(session),
      rounds: undefined,
      participantCount: drivers.length,
      fieldLocked: false,
      metadata: { sessionKey: session.session_key },
      participants: drivers,
    };
  }

  async getParticipants(_sport: Sport): Promise<ProviderParticipant[]> {
    const drivers = await this.fetch<OpenF1Driver[]>('/drivers?session_key=latest');

    return drivers.map((d) => ({
      externalId: String(d.driver_number),
      providerId: this.providerId,
      sport: Sport.F1,
      name: d.full_name,
      firstName: d.first_name,
      lastName: d.last_name,
      nationality: d.country_code,
      teamAffiliation: d.team_name,
      photoUrl: d.headshot_url ?? undefined,
      active: true,
      metadata: {
        driverNumber: d.driver_number,
        nameAcronym: d.name_acronym,
        teamColour: d.team_colour,
      },
    }));
  }

  async getRankings(_sport: Sport, _rankingType: string): Promise<ProviderRanking[]> {
    // OpenF1 doesn't provide championship standings directly.
    // Would need to compute from race results or use a supplementary source.
    return [];
  }

  async getLiveScores(eventId: string): Promise<ProviderStatEvent[]> {
    const positions = await this.fetch<OpenF1Position[]>(
      `/position?session_key=${eventId}`,
    );

    // Group by driver, take latest position for each
    const latestByDriver = new Map<number, OpenF1Position>();
    for (const pos of positions) {
      const existing = latestByDriver.get(pos.driver_number);
      if (!existing || new Date(pos.date) > new Date(existing.date)) {
        latestByDriver.set(pos.driver_number, pos);
      }
    }

    return Array.from(latestByDriver.values()).map((pos) => ({
      id: `${eventId}-${pos.driver_number}-pos-${pos.date}`,
      eventExternalId: eventId,
      participantExternalId: String(pos.driver_number),
      statKey: 'FINISH_POSITION',
      statValue: pos.position,
      timestamp: new Date(pos.date),
      isCorrection: false,
      providerId: this.providerId,
      rawData: pos,
    }));
  }

  async getEventResults(eventId: string): Promise<ProviderEventResult | null> {
    const positions = await this.fetch<OpenF1Position[]>(
      `/position?session_key=${eventId}`,
    );

    if (positions.length === 0) return null;

    // Get final positions (latest entry per driver)
    const finalByDriver = new Map<number, OpenF1Position>();
    for (const pos of positions) {
      const existing = finalByDriver.get(pos.driver_number);
      if (!existing || new Date(pos.date) > new Date(existing.date)) {
        finalByDriver.set(pos.driver_number, pos);
      }
    }

    const results = Array.from(finalByDriver.values())
      .sort((a, b) => a.position - b.position)
      .map((pos) => ({
        participantExternalId: String(pos.driver_number),
        finishPosition: pos.position,
        dnf: false,
        stats: { position: pos.position },
      }));

    return {
      eventExternalId: eventId,
      providerId: this.providerId,
      status: 'COMPLETED' as const,
      results,
    };
  }

  async healthCheck(): Promise<ProviderHealthStatus> {
    try {
      const start = Date.now();
      await this.fetch<unknown[]>('/sessions?session_key=latest');
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
      throw new Error(`OpenF1 API error: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }
}

// --- OpenF1 API response types ---

interface OpenF1Session {
  session_key: number;
  session_name: string;
  session_type: string;
  meeting_key: number;
  meeting_name: string;
  location: string;
  country_name: string;
  circuit_key: number;
  circuit_short_name: string;
  date_start: string;
  date_end: string | null;
  year: number;
}

interface OpenF1Driver {
  driver_number: number;
  full_name: string;
  first_name: string;
  last_name: string;
  name_acronym: string;
  team_name: string;
  team_colour: string;
  country_code: string;
  headshot_url: string | null;
}

interface OpenF1Position {
  session_key: number;
  driver_number: number;
  position: number;
  date: string;
}

function mapSessionStatus(session: OpenF1Session): SportEvent['status'] {
  const now = new Date();
  const start = new Date(session.date_start);
  const end = session.date_end ? new Date(session.date_end) : null;

  if (end && now > end) return 'COMPLETED';
  if (now >= start) return 'IN_PROGRESS';
  return 'SCHEDULED';
}
