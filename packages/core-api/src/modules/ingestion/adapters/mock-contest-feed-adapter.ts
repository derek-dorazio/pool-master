import { Sport } from '@poolmaster/shared/domain';
import type { LiveScoreResult, GolfRoundUpdate } from '@poolmaster/shared/dto';
import type {
  DateRange,
  ProviderEventResult,
  ProviderHealthStatus,
  ProviderParticipant,
  ProviderParticipantResult,
  ProviderRanking,
  SportDataProvider,
  SportEvent,
  SportEventDetail,
} from '../core/provider-interface';

type SupportedMockSport = 'GOLF' | 'TENNIS' | 'NCAA_BASKETBALL';

interface ScenarioSummaryResponse {
  readonly scenarios: Array<{
    readonly scenarioId: string;
    readonly sport: SupportedMockSport;
  }>;
}

interface EventListResponse {
  readonly scenarioId: string;
  readonly events: Array<{
    readonly eventId: string;
    readonly name: string;
    readonly status: 'scheduled' | 'field_announced' | 'in_progress' | 'completed' | 'corrected';
    readonly startsAt: string;
    readonly endsAt?: string;
    readonly releaseAt?: string;
    readonly fieldLocksAt?: string;
    readonly venueName?: string;
    readonly fieldStatus: 'provisional' | 'announced' | 'locked' | 'final';
    readonly contestantCount: number;
  }>;
}

interface EventDetailResponse {
  readonly scenarioId: string;
  readonly sport: SupportedMockSport;
  readonly season: {
    readonly seasonId: string;
    readonly name: string;
    readonly year: number;
  };
  readonly event: {
    readonly eventId: string;
    readonly name: string;
    readonly status: 'scheduled' | 'field_announced' | 'in_progress' | 'completed' | 'corrected';
    readonly schedule: {
      readonly startsAt: string;
      readonly endsAt?: string;
      readonly releaseAt?: string;
      readonly fieldLocksAt?: string;
    };
    readonly venue?: {
      readonly name: string;
      readonly city?: string;
      readonly region?: string;
      readonly countryCode?: string;
    };
    readonly metadata?: {
      readonly officialName?: string;
      readonly eventType?: string;
      readonly tour?: string;
      readonly externalEventId?: string;
    };
    readonly field: {
      readonly asOf: string;
      readonly status: 'provisional' | 'announced' | 'locked' | 'final';
      readonly contestants: ContestantRecord[];
    };
    readonly feeds: {
      readonly odds: FeedSnapshot;
      readonly rankings: FeedSnapshot;
      readonly results: FeedSnapshot;
    };
  };
}

interface FeedSnapshotResponse {
  readonly scenarioId?: string;
  readonly eventId?: string;
  readonly eventName?: string;
  readonly feedKind?: 'field' | 'odds' | 'rankings' | 'results';
  readonly asOf?: string;
  readonly note?: string;
  readonly contestants: ContestantRecord[];
}

interface FeedSnapshot {
  readonly asOf: string;
  readonly contestants: ContestantDelta[];
}

interface ContestantRecord {
  readonly contestantId: string;
  readonly name: string;
  readonly teamName?: string;
  readonly countryCode?: string;
  readonly seed?: number;
  readonly participantStatus?: string;
  readonly odds?: number;
  readonly ranking?: number;
  readonly score?: number;
  readonly result?: string;
  readonly note?: string;
}

interface ContestantDelta {
  readonly contestantId: string;
  readonly name?: string;
  readonly teamName?: string;
  readonly countryCode?: string;
  readonly seed?: number;
  readonly participantStatus?: string;
  readonly odds?: number;
  readonly ranking?: number;
  readonly score?: number;
  readonly result?: string;
  readonly note?: string;
}

export class MockContestFeedAdapter implements SportDataProvider {
  readonly providerId = 'mock-contest-feed';
  readonly providerName = 'Mock Contest Feed Provider';
  readonly sportsCovered = [Sport.GOLF, Sport.TENNIS, Sport.NCAA_BASKETBALL] as Sport[];

  constructor(private readonly baseUrl: string) {}

  async getUpcomingEvents(sport: Sport, dateRange: DateRange): Promise<SportEvent[]> {
    const entries = await this.listScenarioEvents(sport);
    return entries
      .map(({ detail }) => {
        const fieldContestants = resolveParticipants(detail);
        return toSportEvent(this.providerId, detail, fieldContestants.length);
      })
      .filter(
        (event) =>
          event.startDate.getTime() >= dateRange.from.getTime()
          && event.startDate.getTime() <= dateRange.to.getTime(),
      );
  }

  async getEventDetails(eventId: string): Promise<SportEventDetail | null> {
    const match = await this.findEventById(eventId);
    if (!match) {
      return null;
    }

    const detail = await this.fetchJson<EventDetailResponse>(
      `/v1/pre-event/scenarios/${match.scenarioId}/events/${eventId}/detail`,
    );
    const participants = resolveParticipants(detail);

    return {
      ...toSportEvent(this.providerId, detail, participants.length),
      participants: participants.map((contestant) =>
        toProviderParticipant(this.providerId, detail.sport, contestant),
      ),
    };
  }

  async getParticipants(sport: Sport): Promise<ProviderParticipant[]> {
    const entries = await this.listScenarioEvents(sport);
    const seen = new Map<string, ProviderParticipant>();

    for (const { detail } of entries) {
      for (const contestant of resolveParticipants(detail)) {
        seen.set(
          contestant.contestantId,
          toProviderParticipant(this.providerId, detail.sport, contestant),
        );
      }
    }

    return Array.from(seen.values());
  }

  async getRankings(sport: Sport, rankingType: string): Promise<ProviderRanking[]> {
    const entries = await this.listScenarioEvents(sport);
    const rankings = new Map<string, ProviderRanking>();

    for (const { detail } of entries) {
      const asOfDate = new Date(detail.event.feeds.rankings.asOf);
      for (const contestant of detail.event.feeds.rankings.contestants) {
        if (typeof contestant.ranking !== 'number') {
          continue;
        }

        rankings.set(contestant.contestantId, {
          participantExternalId: contestant.contestantId,
          rankingType,
          rank: contestant.ranking,
          asOfDate,
        });
      }
    }

    return Array.from(rankings.values()).sort((left, right) => left.rank - right.rank);
  }

  /**
   * Emits a typed `LiveScoreResult` per plans/117 §10.2 for the mock-feed
   * scenario. The mock provider only carries cumulative scoreToPar at the
   * snapshot level (no per-round breakdown), so the adapter emits a single
   * round-1 update per contestant — the test scenarios exercise the typed
   * pipeline shape, not multi-round detail. rop.78.7 will replace the
   * round-1-as-cumulative degeneracy with proper per-round emission once
   * the contribution-table scoring path lands.
   */
  async getLiveScores(eventId: string): Promise<LiveScoreResult> {
    const empty: LiveScoreResult = { category: 'GOLF', rounds: [] };
    const match = await this.findEventById(eventId);
    if (!match) {
      return empty;
    }

    const liveScores = await this.fetchJson<FeedSnapshotResponse>(
      `/v1/live/scenarios/${match.scenarioId}/events/${eventId}/scores`,
    );

    const rounds: GolfRoundUpdate[] = liveScores.contestants
      .filter((contestant) => typeof contestant.score === 'number')
      .map((contestant) => ({
        participantExternalId: contestant.contestantId,
        round: 1,
        // Mock provider emits scoreToPar; strokes is approximated to
        // (par + scoreToPar) using a notional par of 72 so the typed
        // schema is satisfied. rop.78.7 reads the per-round table that
        // PGA Tour's adapter populates with real strokes data.
        strokes: 72 + (contestant.score as number),
        scoreToPar: contestant.score as number,
        status: 'IN_PROGRESS',
      }));

    return { category: 'GOLF', rounds };
  }

  async getEventResults(eventId: string): Promise<ProviderEventResult | null> {
    const match = await this.findEventById(eventId);
    if (!match) {
      return null;
    }

    const detail = await this.fetchJson<EventDetailResponse>(
      `/v1/pre-event/scenarios/${match.scenarioId}/events/${eventId}/detail`,
    );
    const resultsSnapshot = await this.fetchJson<FeedSnapshotResponse>(
      `/v1/live/scenarios/${match.scenarioId}/events/${eventId}/results`,
    );

    const merged = new Map<string, ContestantRecord>();
    for (const contestant of resolveParticipants(detail)) {
      merged.set(contestant.contestantId, { ...contestant });
    }
    for (const contestant of resultsSnapshot.contestants) {
      const current = merged.get(contestant.contestantId);
      merged.set(contestant.contestantId, { ...current, ...contestant });
    }

    const results = Array.from(merged.values())
      .sort(compareContestantsForResults)
      .map<ProviderParticipantResult>((contestant, index) => ({
        participantExternalId: contestant.contestantId,
        finishPosition: index + 1,
        totalScore: contestant.score,
        dnf: contestant.result === 'withdrawn' || contestant.result === 'cut',
        dnfReason:
          contestant.result === 'withdrawn'
            ? 'WITHDRAWN'
            : contestant.result === 'cut'
              ? 'MISSED_CUT'
              : undefined,
        stats: buildResultStats(contestant),
      }));

    return {
      eventExternalId: eventId,
      providerId: this.providerId,
      status: detail.event.status === 'completed' || detail.event.status === 'corrected'
        ? 'OFFICIAL'
        : 'COMPLETED',
      results,
    };
  }

  async healthCheck(): Promise<ProviderHealthStatus> {
    const startedAt = Date.now();

    try {
      await this.fetchJson<{ status: string }>('/health');
      return {
        providerId: this.providerId,
        status: 'HEALTHY',
        errorRateLastHour: 0,
        latencyMsP95: Date.now() - startedAt,
        lastSuccessfulPoll: new Date(),
      };
    } catch (error) {
      return {
        providerId: this.providerId,
        status: 'DOWN',
        errorRateLastHour: 1,
        latencyMsP95: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async listScenarioEvents(
    sport: Sport,
  ): Promise<Array<{ scenarioId: string; detail: EventDetailResponse }>> {
    const scenarios = await this.fetchJson<ScenarioSummaryResponse>('/v1/scenarios');
    const matchingScenarioIds = scenarios.scenarios
      .filter((scenario) => toDomainSport(scenario.sport) === sport)
      .map((scenario) => scenario.scenarioId);

    const eventLists = await Promise.all(
      matchingScenarioIds.map(async (scenarioId) => {
        const list = await this.fetchJson<EventListResponse>(`/v1/scenarios/${scenarioId}/events`);
        return { scenarioId, events: list.events };
      }),
    );

    const details = await Promise.all(
      eventLists.flatMap(({ scenarioId, events }) =>
        events.map(async (event) => ({
          scenarioId,
          detail: await this.fetchJson<EventDetailResponse>(
            `/v1/pre-event/scenarios/${scenarioId}/events/${event.eventId}/detail`,
          ),
        })),
      ),
    );

    return details;
  }

  private async findEventById(
    eventId: string,
  ): Promise<{ scenarioId: string } | null> {
    const scenarios = await this.fetchJson<ScenarioSummaryResponse>('/v1/scenarios');
    const relativeTodayScenario = scenarios.scenarios.find(
      (scenario) => scenario.scenarioId === 'golf-relative-today',
    );

    for (const scenario of scenarios.scenarios) {
      const events = await this.fetchJson<EventListResponse>(
        `/v1/scenarios/${scenario.scenarioId}/events`,
      );

      if (events.events.some((event) => event.eventId === eventId)) {
        return { scenarioId: scenario.scenarioId };
      }
    }

    if (relativeTodayScenario && isRelativeManualTestEventId(eventId)) {
      return { scenarioId: relativeTodayScenario.scenarioId };
    }

    return null;
  }

  private async fetchJson<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`);
    if (!response.ok) {
      throw new Error(`Mock contest feed request failed: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  }
}

function isRelativeManualTestEventId(eventId: string): boolean {
  return /^golf-relative-manual-test-\d{8}t\d{6}z$/.test(eventId);
}

function toDomainSport(sport: SupportedMockSport): Sport {
  switch (sport) {
    case 'GOLF':
      return Sport.GOLF;
    case 'TENNIS':
      return Sport.TENNIS;
    case 'NCAA_BASKETBALL':
      return Sport.NCAA_BASKETBALL;
  }
}

function toProviderParticipant(
  providerId: string,
  sport: SupportedMockSport,
  contestant: ContestantRecord,
): ProviderParticipant {
  const [firstName, ...lastParts] = contestant.name.split(/\s+/);

  return {
    externalId: contestant.contestantId,
    providerId,
    sport: toDomainSport(sport),
    name: contestant.name,
    firstName,
    lastName: lastParts.join(' ') || undefined,
    nationality: contestant.countryCode,
    teamAffiliation: contestant.teamName,
    active: !['withdrawn', 'inactive', 'eliminated', 'cut'].includes(
      contestant.participantStatus ?? '',
    ),
    metadata: {
      seed: contestant.seed,
      participantStatus: contestant.participantStatus,
      odds: contestant.odds,
      ranking: contestant.ranking,
      score: contestant.score,
      result: contestant.result,
      note: contestant.note,
    },
  };
}

function toSportEvent(
  providerId: string,
  detail: EventDetailResponse,
  participantCount: number,
): SportEvent {
  return {
    externalId: detail.event.metadata?.externalEventId ?? detail.event.eventId,
    providerId,
    sport: toDomainSport(detail.sport),
    name: detail.event.name,
    venue: detail.event.venue?.name,
    location: [detail.event.venue?.city, detail.event.venue?.region].filter(Boolean).join(', ')
      || undefined,
    startDate: new Date(detail.event.schedule.startsAt),
    endDate: detail.event.schedule.endsAt ? new Date(detail.event.schedule.endsAt) : undefined,
    status: mapEventStatus(detail.event.status),
    participantCount,
    fieldLocked:
      detail.event.field.status === 'locked'
      || detail.event.field.status === 'final'
      || (detail.event.schedule.fieldLocksAt
        ? Date.now() >= new Date(detail.event.schedule.fieldLocksAt).getTime()
        : false),
    metadata: {
      seasonId: detail.season.seasonId,
      seasonName: detail.season.name,
      seasonYear: detail.season.year,
      eventType: detail.event.metadata?.eventType,
      tour: detail.event.metadata?.tour,
      releaseAt: detail.event.schedule.releaseAt,
      fieldLocksAt: detail.event.schedule.fieldLocksAt,
    },
  };
}

function resolveParticipants(detail: EventDetailResponse): ContestantRecord[] {
  if (detail.sport === 'GOLF') {
    return mergeContestantView(
      detail.event.field.contestants,
      detail.event.feeds.odds.contestants,
    );
  }

  return detail.event.field.contestants;
}

function mapEventStatus(
  status: EventDetailResponse['event']['status'],
): SportEvent['status'] {
  switch (status) {
    case 'scheduled':
    case 'field_announced':
      return 'SCHEDULED';
    case 'in_progress':
      return 'IN_PROGRESS';
    case 'completed':
    case 'corrected':
      return 'COMPLETED';
  }
}

function compareContestantsForResults(left: ContestantRecord, right: ContestantRecord): number {
  const leftScore = typeof left.score === 'number' ? left.score : Number.POSITIVE_INFINITY;
  const rightScore = typeof right.score === 'number' ? right.score : Number.POSITIVE_INFINITY;

  if (leftScore !== rightScore) {
    return leftScore - rightScore;
  }

  const leftRanking = typeof left.ranking === 'number' ? left.ranking : Number.POSITIVE_INFINITY;
  const rightRanking = typeof right.ranking === 'number' ? right.ranking : Number.POSITIVE_INFINITY;

  if (leftRanking !== rightRanking) {
    return leftRanking - rightRanking;
  }

  return left.name.localeCompare(right.name);
}

function buildResultStats(contestant: ContestantRecord): Record<string, number> {
  const stats: Record<string, number> = {};

  if (typeof contestant.ranking === 'number') {
    stats.ranking = contestant.ranking;
  }

  return stats;
}

function mergeContestantView(
  baseline: readonly ContestantRecord[],
  overrides: readonly ContestantDelta[],
): ContestantRecord[] {
  const merged = new Map<string, ContestantRecord>();

  for (const contestant of baseline) {
    merged.set(contestant.contestantId, { ...contestant });
  }

  for (const override of overrides) {
    const current = merged.get(override.contestantId) ?? {
      contestantId: override.contestantId,
      name: override.name ?? override.contestantId,
    };
    merged.set(override.contestantId, {
      ...current,
      ...override,
      contestantId: override.contestantId,
      name: override.name ?? current.name,
    });
  }

  return Array.from(merged.values());
}
