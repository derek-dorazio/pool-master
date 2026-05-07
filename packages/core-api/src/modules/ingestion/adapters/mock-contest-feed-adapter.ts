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
// pool-master-rop.78.13 — consume the generated mock-contest-feed SDK
// types instead of the hand-rolled response interfaces. The SDK is the
// single source of truth for the mock-feed contract; replacing the
// hand-rolled types with these aliases prevents future drift between
// the adapter and the OpenAPI spec.
import type {
  ListMockContestFeedScenariosResponse,
  ListMockContestFeedScenarioEventsResponse,
  GetMockContestFeedScenarioEventDetailResponse,
  GetMockContestFeedScoresSnapshotResponse,
  GetMockContestFeedResultsSnapshotResponse,
} from '@poolmaster/mock-contest-feed-provider/generated/hey-api/types';

type ScenarioSummaryResponse = ListMockContestFeedScenariosResponse;
type EventListResponse = ListMockContestFeedScenarioEventsResponse;
type EventDetailResponse = GetMockContestFeedScenarioEventDetailResponse;
type FeedSnapshotResponse =
  | GetMockContestFeedScoresSnapshotResponse
  | GetMockContestFeedResultsSnapshotResponse;

type SupportedMockSport = ScenarioSummaryResponse['scenarios'][number]['sport'];
type ContestantRecord = NonNullable<
  EventDetailResponse['event']['field']['contestants']
>[number];
// `ContestantDelta` is the per-feed override shape — same shape as a
// full record but with `name` optional, since the snapshot diff only
// repeats name when it changed.
type ContestantDelta = NonNullable<
  EventDetailResponse['event']['feeds']['odds']['contestants']
>[number];

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
      `/v1/scenarios/${match.scenarioId}/events/${eventId}/detail`,
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
    const empty: LiveScoreResult = { category: 'GOLF', externalEventId: eventId, rounds: [] };
    const match = await this.findEventById(eventId);
    if (!match) {
      return empty;
    }

    const liveScores = await this.fetchJson<FeedSnapshotResponse>(
      `/v1/scenarios/${match.scenarioId}/events/${eventId}/scores`,
    );

    const rounds: GolfRoundUpdate[] = liveScores.contestants
      .filter((contestant) => typeof contestant.score === 'number')
      .map((contestant) => ({
        participantExternalId: contestant.contestantId,
        round: 1,
        // Mock provider exposes only cumulative scoreToPar; per-round
        // strokes are not in the snapshot. Emit null so downstream
        // persistence skips this row until rop.78.7 supplies real
        // strokes from PGA Tour. No synthesis.
        strokes: null,
        scoreToPar: contestant.score as number,
        status: 'IN_PROGRESS',
      }));

    return { category: 'GOLF', externalEventId: eventId, rounds };
  }

  async getEventResults(eventId: string): Promise<ProviderEventResult | null> {
    const match = await this.findEventById(eventId);
    if (!match) {
      return null;
    }

    const detail = await this.fetchJson<EventDetailResponse>(
      `/v1/scenarios/${match.scenarioId}/events/${eventId}/detail`,
    );
    const resultsSnapshot = await this.fetchJson<FeedSnapshotResponse>(
      `/v1/scenarios/${match.scenarioId}/events/${eventId}/results`,
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
            `/v1/scenarios/${scenarioId}/events/${event.eventId}/detail`,
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

/**
 * Maps a mock-feed sport literal to its domain `Sport`. Returns `null`
 * for sports the adapter intentionally does not surface — currently
 * the generic `'TEAM_TOURNAMENT'` showcase scenarios. Pre-rop.78.13 the
 * adapter's local `SupportedMockSport` union didn't include
 * `'TEAM_TOURNAMENT'` at all, so the runtime fallthrough silently
 * filtered those scenarios out. The generated SDK now exposes
 * `'TEAM_TOURNAMENT'`, so the filter has to be explicit — defaulting
 * the value to a real `Sport` would cross-contaminate (e.g. routing
 * the `correction-and-tie-2026` showcase event into NCAA basketball).
 */
function toDomainSport(sport: SupportedMockSport): Sport | null {
  switch (sport) {
    case 'GOLF':
      return Sport.GOLF;
    case 'TENNIS':
      return Sport.TENNIS;
    case 'NCAA_BASKETBALL':
      return Sport.NCAA_BASKETBALL;
    case 'TEAM_TOURNAMENT':
      return null;
  }
}

function toProviderParticipant(
  providerId: string,
  sport: SupportedMockSport,
  contestant: ContestantRecord,
): ProviderParticipant {
  const [firstName, ...lastParts] = contestant.name.split(/\s+/);
  const domainSport = toDomainSport(sport);
  if (!domainSport) {
    // Unreachable in practice — listScenarioEvents filters unsupported
    // sports out before any participant projection runs. Throw here so a
    // future caller skipping the filter fails loudly instead of emitting
    // a participant with the wrong sport.
    throw new Error(`Unsupported mock-feed sport for participant projection: ${sport}`);
  }

  return {
    externalId: contestant.contestantId,
    providerId,
    sport: domainSport,
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
  const domainSport = toDomainSport(detail.sport);
  if (!domainSport) {
    // Unreachable in practice — see toProviderParticipant for rationale.
    throw new Error(`Unsupported mock-feed sport for event projection: ${detail.sport}`);
  }
  return {
    externalId: detail.event.metadata?.externalEventId ?? detail.event.eventId,
    providerId,
    sport: domainSport,
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
