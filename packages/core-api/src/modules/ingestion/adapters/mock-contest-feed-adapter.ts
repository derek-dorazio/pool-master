import { ParticipantInactiveReason, Sport } from '@poolmaster/shared/domain';
import type { LiveScoreResult, GolfRoundUpdate } from '@poolmaster/shared/dto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  DateRange,
  LiveSimulationOptions,
  LiveSimulationPhase,
  LiveSimulationStatus,
  ProviderEventSyncOptions,
  ProviderLiveSimulationControls,
  ProviderEventResult,
  ProviderHealthStatus,
  ProviderParticipant,
  ProviderParticipantResult,
  ProviderPayloadCapture,
  ProviderPayloadCaptureSession,
  ProviderPayloadDiagnostics,
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
  GetMockContestFeedLiveReplayResponse,
  StartMockContestFeedLiveReplayResponse,
} from '@poolmaster/mock-contest-feed-provider/generated/hey-api/types';

type ScenarioSummaryResponse = ListMockContestFeedScenariosResponse;
type EventListResponse = ListMockContestFeedScenarioEventsResponse;
type EventDetailResponse = GetMockContestFeedScenarioEventDetailResponse;
type ScoresSnapshotResponse = GetMockContestFeedScoresSnapshotResponse;
type ResultsSnapshotResponse = GetMockContestFeedResultsSnapshotResponse;
type LiveReplayResponse = StartMockContestFeedLiveReplayResponse;

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

/**
 * #418 — the most response JSON, in characters, one sync run's capture keeps for its ledger
 * row. A response that would take the capture past it is recorded by path and size only. The
 * 2026/2027 tour slates made an unfiltered schedule or ranking sweep about 7.7 MB of detail
 * JSON, and keeping all of it pushed QA's core-api past its 512 MB task limit.
 */
export const providerPayloadCaptureBudgetBytes = 1024 * 1024;

/**
 * #418 — how many event details a sweep fetches at once. Each detail is reduced to what the
 * caller needs as it arrives, so only this many full detail bodies are in memory together.
 */
const eventDetailFetchConcurrency = 8;

interface ProviderPayloadCaptureBuffer {
  readonly entries: ProviderPayloadCapture[];
  keptBytes: number;
}

export class MockContestFeedAdapter implements SportDataProvider, ProviderPayloadDiagnostics, ProviderLiveSimulationControls {
  readonly providerId = 'mock-contest-feed';
  readonly providerName = 'Mock Contest Feed Provider';
  readonly sportsCovered = [Sport.GOLF, Sport.TENNIS, Sport.NCAA_BASKETBALL] as Sport[];
  private readonly providerPayloadCaptureStorage = new AsyncLocalStorage<ProviderPayloadCaptureBuffer>();
  private readonly scenarioIdByEventId = new Map<string, string>();

  constructor(private readonly baseUrl: string) {}

  // Raw payloads are kept only inside a capture session (#418). Calls outside one, such as a
  // catalog browse, keep nothing: nothing drains them, so keeping them grew the heap per call.
  clearProviderPayloads(): void {}

  consumeProviderPayloads(): ProviderPayloadCapture[] {
    return [];
  }

  beginProviderPayloadCapture(): ProviderPayloadCaptureSession {
    const capture: ProviderPayloadCaptureBuffer = { entries: [], keptBytes: 0 };
    return {
      run: async <T>(work: () => Promise<T>): Promise<T> =>
        this.providerPayloadCaptureStorage.run(capture, work),
      consumeProviderPayloads: (): ProviderPayloadCapture[] => {
        const payloads = [...capture.entries];
        capture.entries.length = 0;
        capture.keptBytes = 0;
        return payloads;
      },
    };
  }

  async getUpcomingEvents(sport: Sport, dateRange?: DateRange): Promise<SportEvent[]> {
    const events = await this.mapScenarioEventDetails(sport, dateRange, (scenarioId, detail) =>
      toSportEvent(this.providerId, detail, resolveParticipants(detail).length, scenarioId),
    );
    return events.filter((event) => isEventWithinDateRange(event.startDate.toISOString(), dateRange));
  }

  async getEventDetails(
    eventId: string,
    options?: ProviderEventSyncOptions,
  ): Promise<SportEventDetail | null> {
    const match = await this.findEventById(eventId);
    if (!match) {
      return null;
    }

    const detail = await this.fetchJson<EventDetailResponse>(
      withMockEventState(
        `/v1/scenarios/${match.scenarioId}/events/${eventId}/detail`,
        options,
      ),
    );
    const participants = resolveParticipants(detail);

    return {
      ...toSportEvent(this.providerId, detail, participants.length, match.scenarioId),
      participants: participants.map((contestant) =>
        toProviderParticipant(this.providerId, detail.sport, contestant, detail.event.eventId),
      ),
    };
  }

  async getParticipants(sport: Sport): Promise<ProviderParticipant[]> {
    const eventParticipants = await this.mapScenarioEventDetails(sport, undefined, (_scenarioId, detail) =>
      resolveParticipants(detail).map((contestant) =>
        toProviderParticipant(this.providerId, detail.sport, contestant),
      ),
    );
    const seen = new Map<string, ProviderParticipant>();

    for (const participants of eventParticipants) {
      for (const participant of participants) {
        seen.set(participant.externalId, participant);
      }
    }

    return Array.from(seen.values());
  }

  async getRankings(sport: Sport, rankingType: string): Promise<ProviderRanking[]> {
    const eventRankings = await this.mapScenarioEventDetails(sport, undefined, (_scenarioId, detail) => {
      const asOfDate = new Date(detail.event.feeds.rankings.asOf);
      return detail.event.feeds.rankings.contestants.flatMap((contestant): ProviderRanking[] =>
        typeof contestant.ranking === 'number'
          ? [{
              providerId: this.providerId,
              participantExternalId: contestant.contestantId,
              rankingType,
              rank: contestant.ranking,
              asOfDate,
            }]
          : [],
      );
    });
    const rankings = new Map<string, ProviderRanking>();

    for (const eventRanking of eventRankings) {
      for (const ranking of eventRanking) {
        rankings.set(ranking.participantExternalId, ranking);
      }
    }

    return Array.from(rankings.values()).sort((left, right) => left.rank - right.rank);
  }

  // Thin mapper only — no branching on `options.mockEventState`, no score
  // math, no fallback for a missing/malformed field. The mock provider (see
  // `GolfLiveState` in scenario-store.ts) owns all deterministic scenario
  // content; this method reshapes whatever it returns, verbatim, into the
  // GolfRoundUpdate[] shape. See "PoolMaster Integrates; It Does Not
  // Invent" in
  // requirements/product-requirements/features/contest-event-feed-integration/overview.md
  // — an earlier attempt put per-state scoring logic here and got it
  // backwards.
  /**
   * Starts the mock's time-driven live replay for one golf event (#382): from now on, its
   * `/scores` moves hole by hole on the replay clock.
   */
  async startLiveSimulation(
    eventId: string,
    options: LiveSimulationOptions,
  ): Promise<LiveSimulationStatus | null> {
    const match = await this.findEventById(eventId);
    if (!match) {
      return null;
    }

    const replay = await this.sendJson<LiveReplayResponse>(
      'PUT',
      `/v1/scenarios/${match.scenarioId}/events/${eventId}/replay`,
      options.minutesPerRound === undefined ? {} : { minutesPerRound: options.minutesPerRound },
    );
    return toLiveSimulationStatus(replay);
  }

  /** The mock answers 404 when no replay is running for the event; that maps to null. */
  async getLiveSimulation(eventId: string): Promise<LiveSimulationStatus | null> {
    const match = await this.findEventById(eventId);
    if (!match) {
      return null;
    }

    const path = `/v1/scenarios/${match.scenarioId}/events/${eventId}/replay`;
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Mock contest feed request failed: ${response.status} ${response.statusText}`);
    }
    const replay = await this.readJson<GetMockContestFeedLiveReplayResponse>(path, response);
    return toLiveSimulationStatus(replay);
  }

  async getLiveScores(
    eventId: string,
    options?: ProviderEventSyncOptions,
  ): Promise<LiveScoreResult> {
    const empty: LiveScoreResult = { category: 'GOLF', externalEventId: eventId, rounds: [] };
    const match = await this.findEventById(eventId);
    if (!match) {
      return empty;
    }

    const liveScores = await this.fetchJson<ScoresSnapshotResponse>(
      withMockEventState(
        `/v1/scenarios/${match.scenarioId}/events/${eventId}/scores`,
        options,
      ),
    );

    const rounds: GolfRoundUpdate[] = liveScores.contestants
      .flatMap((contestant) => {
        if (!Array.isArray(contestant.rounds)) {
          throw new Error(`Mock live scores response missing rounds for contestant ${contestant.contestantId}`);
        }

        return contestant.rounds.map((round) => ({
          participantExternalId: contestant.contestantId,
          round: round.round,
          strokes: round.strokes,
          scoreToPar: round.scoreToPar,
          ...(typeof round.thru === 'number' ? { thru: round.thru } : {}),
          status: round.status,
          ...(round.completedAt ? { completedAt: round.completedAt } : {}),
        }));
      });

    return { category: 'GOLF', externalEventId: eventId, rounds };
  }

  async getEventResults(
    eventId: string,
    options?: ProviderEventSyncOptions,
  ): Promise<ProviderEventResult | null> {
    const match = await this.findEventById(eventId);
    if (!match) {
      return null;
    }

    const detail = await this.fetchJson<EventDetailResponse>(
      withMockEventState(
        `/v1/scenarios/${match.scenarioId}/events/${eventId}/detail`,
        options,
      ),
    );
    const resultsSnapshot = await this.fetchJson<ResultsSnapshotResponse>(
      withMockEventState(
        `/v1/scenarios/${match.scenarioId}/events/${eventId}/results`,
        options,
      ),
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
        scoreToPar: contestant.score,
        totalStrokes: contestant.strokes,
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

  /**
   * Fetches the detail of every event of the sport (within the date range, when given) and
   * returns `project`'s result for each, in scenario and event order. Details are fetched a few
   * at a time and dropped once projected (#418): a tour season's details together run to
   * megabytes, and holding them all at once was most of a sweep's memory.
   */
  private async mapScenarioEventDetails<R>(
    sport: Sport,
    dateRange: DateRange | undefined,
    project: (scenarioId: string, detail: EventDetailResponse) => R,
  ): Promise<R[]> {
    const scenarios = await this.fetchJson<ScenarioSummaryResponse>('/v1/scenarios');
    const matchingScenarioIds = scenarios.scenarios
      .filter((scenario) => toDomainSport(scenario.sport) === sport)
      .map((scenario) => scenario.scenarioId);

    const eventLists = await Promise.all(
      matchingScenarioIds.map(async (scenarioId) => {
        const list = await this.fetchJson<EventListResponse>(`/v1/scenarios/${scenarioId}/events`);
        for (const event of list.events) {
          this.scenarioIdByEventId.set(event.eventId, scenarioId);
        }
        return { scenarioId, events: list.events };
      }),
    );

    const targets = eventLists.flatMap(({ scenarioId, events }) =>
      events
        .filter((event) => isEventWithinDateRange(event.startsAt, dateRange))
        .map((event) => ({ scenarioId, eventId: event.eventId })),
    );
    const results: R[] = new Array<R>(targets.length);
    let nextTarget = 0;
    const fetchNext = async (): Promise<void> => {
      while (nextTarget < targets.length) {
        const index = nextTarget;
        nextTarget += 1;
        const { scenarioId, eventId } = targets[index];
        const detail = await this.fetchJson<EventDetailResponse>(
          `/v1/scenarios/${scenarioId}/events/${eventId}/detail`,
        );
        results[index] = project(scenarioId, detail);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(eventDetailFetchConcurrency, targets.length) }, fetchNext),
    );

    return results;
  }

  private async findEventById(
    eventId: string,
  ): Promise<{ scenarioId: string } | null> {
    const cachedScenarioId = this.scenarioIdByEventId.get(eventId);
    if (cachedScenarioId) {
      return { scenarioId: cachedScenarioId };
    }

    const scenarios = await this.fetchJson<ScenarioSummaryResponse>('/v1/scenarios');

    // #402 — the mock answers any `sandbox-<id>` in its sandbox scenario without listing it,
    // so it is matched before listing every scenario's events, and cached like a listed one.
    if (
      eventId.startsWith(sandboxEventIdPrefix)
      && scenarios.scenarios.some((scenario) => scenario.scenarioId === sandboxScenarioId)
    ) {
      this.scenarioIdByEventId.set(eventId, sandboxScenarioId);
      return { scenarioId: sandboxScenarioId };
    }

    for (const scenario of scenarios.scenarios) {
      const events = await this.fetchJson<EventListResponse>(
        `/v1/scenarios/${scenario.scenarioId}/events`,
      );

      if (events.events.some((event) => event.eventId === eventId)) {
        return { scenarioId: scenario.scenarioId };
      }
    }

    return null;
  }

  private async sendJson<T>(method: 'PUT', path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Mock contest feed request failed: ${response.status} ${response.statusText}`);
    }

    return this.readJson<T>(path, response);
  }

  private async fetchJson<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`);
    if (!response.ok) {
      throw new Error(`Mock contest feed request failed: ${response.status} ${response.statusText}`);
    }

    return this.readJson<T>(path, response);
  }

  private async readJson<T>(path: string, response: Response): Promise<T> {
    const body = await response.text();
    const raw = JSON.parse(body) as T;
    this.recordProviderPayload(path, body.length, raw);
    return raw;
  }

  private recordProviderPayload(path: string, bytes: number, raw: unknown): void {
    const capture = this.providerPayloadCaptureStorage.getStore();
    if (!capture) {
      return;
    }

    const entry = { operation: 'mock-contest-feed.request', path, capturedAt: new Date().toISOString(), bytes };
    if (capture.keptBytes + bytes > providerPayloadCaptureBudgetBytes) {
      capture.entries.push({ ...entry, rawOmitted: true });
      return;
    }

    capture.keptBytes += bytes;
    capture.entries.push({ ...entry, raw });
  }
}

function isEventWithinDateRange(startsAt: string, dateRange?: DateRange): boolean {
  if (!dateRange) {
    return true;
  }

  const startTime = new Date(startsAt).getTime();
  return startTime >= dateRange.from.getTime() && startTime <= dateRange.to.getTime();
}

/**
 * The mock's sandbox scenario and event-id prefix (#402). Copies live in the mock's
 * scenario-store.ts and the web app's golf-tournament-score-source-card.tsx; rename all three.
 */
const sandboxScenarioId = 'golf-sandbox';
const sandboxEventIdPrefix = 'sandbox-';

function withMockEventState(path: string, options?: ProviderEventSyncOptions): string {
  if (!options?.mockEventState) {
    return path;
  }

  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}mockEventState=${encodeURIComponent(options.mockEventState)}`;
}

/**
 * Maps a mock-feed sport literal to its domain `Sport`. Returns `null`
 * for sports the adapter intentionally does not surface — currently
 * the generic `'TEAM_TOURNAMENT'` sport. The mock ships only golf
 * scenarios now, but its contract still names these sports. Pre-rop.78.13 the
 * adapter's local `SupportedMockSport` union didn't include
 * `'TEAM_TOURNAMENT'` at all, so the runtime fallthrough silently
 * filtered those scenarios out. The generated SDK now exposes
 * `'TEAM_TOURNAMENT'`, so the filter has to be explicit — defaulting
 * the value to a real `Sport` would cross-contaminate (e.g. routing
 * a team-tournament event into NCAA basketball).
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

/**
 * Maps the mock feed's 7 raw participantStatus values down to
 * {isActive, inactiveReason} — see plans/124 §4.1. active/provisional/alternate
 * and unset all mean "no reason recorded" (undefined, not just falling through
 * to 'inactive'); only withdrawn/cut/eliminated carry an explicit reason.
 */
function toParticipantInactiveReason(
  participantStatus: string | undefined,
): ParticipantInactiveReason | undefined {
  switch (participantStatus) {
    case 'withdrawn':
      return ParticipantInactiveReason.WITHDRAWN;
    // A golfer who missed the cut is ELIMINATED in the cross-sport model; golf
    // surfaces render it as "Cut".
    case 'cut':
    case 'eliminated':
      return ParticipantInactiveReason.ELIMINATED;
    default:
      return undefined;
  }
}

function toProviderParticipant(
  providerId: string,
  sport: SupportedMockSport,
  contestant: ContestantRecord,
  eventExternalId?: string,
): ProviderParticipant {
  const [firstName, ...lastParts] = contestant.name.split(/\s+/);
  const domainSport = toDomainSport(sport);
  if (!domainSport) {
    // Unreachable in practice — mapScenarioEventDetails filters unsupported
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
    inactiveReason: toParticipantInactiveReason(contestant.participantStatus),
    ranking: contestant.ranking,
    metadata: {
      seed: contestant.seed,
      participantStatus: contestant.participantStatus,
      odds: contestant.odds,
      oddsSourceEventId: typeof contestant.odds === 'number' ? eventExternalId : undefined,
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
  scenarioId?: string,
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
      || detail.event.field.status === 'final',
    metadata: {
      seasonId: detail.season.seasonId,
      seasonName: detail.season.name,
      seasonYear: detail.season.year,
      eventType: detail.event.metadata?.eventType,
      tour: detail.event.metadata?.tour,
      scenarioId,
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

function toLiveSimulationStatus(replay: LiveReplayResponse): LiveSimulationStatus {
  return {
    startsAt: new Date(replay.startsAt),
    endsAt: new Date(replay.endsAt),
    minutesPerRound: replay.minutesPerRound,
    phase: toLiveSimulationPhase(replay.phase),
    currentRound: replay.currentRound,
  };
}

function toLiveSimulationPhase(phase: LiveReplayResponse['phase']): LiveSimulationPhase {
  switch (phase) {
    case 'scheduled':
      return 'SCHEDULED';
    case 'in_progress':
      return 'IN_PROGRESS';
    case 'completed':
      return 'COMPLETED';
  }
}
