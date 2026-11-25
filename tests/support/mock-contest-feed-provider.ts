import { ParticipantInactiveReason, ProviderCode, Sport } from '@poolmaster/shared/domain';
import type { LiveScoreResult, GolfRoundUpdate } from '@poolmaster/shared/dto';
import type {
  DateRange,
  ProviderParticipant,
  ProviderPayloadCapture,
  ProviderPayloadCaptureSession,
  ProviderPayloadDiagnostics,
  SportDataProvider,
  SportEvent,
  SportEventDetail,
} from '../../packages/core-api/src/modules/ingestion/core/provider-interface';
import type {
  ListMockContestFeedScenariosResponse,
  ListMockContestFeedScenarioEventsResponse,
  GetMockContestFeedScenarioEventDetailResponse,
  GetMockContestFeedScoresSnapshotResponse,
} from '@poolmaster/mock-contest-feed-provider/generated/hey-api/types';
import { ProviderPayloadRecorder } from '../../packages/core-api/src/modules/ingestion/adapters/provider-payload-recorder';
import type { FastifyInstance } from 'fastify';
import { mockEventStateKinds, type MockEventStateKind } from '../../packages/mock-contest-feed-provider/src/contracts';

type ScenarioSummaryResponse = ListMockContestFeedScenariosResponse;
type EventListResponse = ListMockContestFeedScenarioEventsResponse;
type EventDetailResponse = GetMockContestFeedScenarioEventDetailResponse;
type ScoresSnapshotResponse = GetMockContestFeedScoresSnapshotResponse;

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
 * #418 — how many event details a sweep fetches at once. Each detail is reduced to what the
 * caller needs as it arrives, so only this many full detail bodies are in memory together.
 */
const eventDetailFetchConcurrency = 8;

/** An event state the mock feed can pin an event to, as its `mockEventState` query names them. */
export type MockFeedEventState = MockEventStateKind;

/**
 * A fake sport data provider for functional and integration tests (#2039): it reads the mock
 * contest feed (packages/mock-contest-feed-provider) over HTTP and maps it to the provider
 * interface, as the production adapter it replaced did. It lives in test code only; the app takes
 * it through `buildApp({ buildSportDataProviders })`. A test pins an event to a scripted state
 * with `pinEventState`, which the mock feed answers through its own `mockEventState` query.
 */
export class MockContestFeedAdapter implements SportDataProvider, ProviderPayloadDiagnostics {
  /**
   * The BALLDONTLIE feed's source id (#2040): sync runs and participant mappings name a Provider
   * row, and BALLDONTLIE's is the one the test database seeds, so the fake writes through it. The
   * production model has no test provider.
   */
  readonly providerId = 'balldontlie';
  readonly providerCode = ProviderCode.BALLDONTLIE;
  readonly providerName = 'Mock Contest Feed Provider';
  private readonly payloads = new ProviderPayloadRecorder('mock-contest-feed.request');
  private readonly scenarioIdByEventId = new Map<string, string>();
  private readonly scenarioIdByExternalId = new Map<string, string>();

  /** It reads every league a test names. */
  servesLeague(): boolean {
    return true;
  }

  /** The scenario a listed event came from, by the event's provider id; undefined until it is listed. */
  scenarioIdOf(externalId: string): string | undefined {
    return this.scenarioIdByExternalId.get(externalId);
  }

  /** `pinnedStates` may be shared with `servePinControls`, so another process can pin through HTTP. */
  constructor(
    private readonly baseUrl: string,
    private readonly pinnedStates: Map<string, MockFeedEventState> = new Map(),
  ) {}

  /** Answers the event's detail and scores in this scripted state until cleared. */
  pinEventState(eventId: string, state: MockFeedEventState): void {
    this.pinnedStates.set(eventId, state);
  }

  /** Answers the event as the mock feed loads it again. */
  clearEventState(eventId: string): void {
    this.pinnedStates.delete(eventId);
  }

  clearProviderPayloads(): void {
    this.payloads.clearProviderPayloads();
  }

  consumeProviderPayloads(): ProviderPayloadCapture[] {
    return this.payloads.consumeProviderPayloads();
  }

  beginProviderPayloadCapture(): ProviderPayloadCaptureSession {
    return this.payloads.beginProviderPayloadCapture();
  }

  async getUpcomingEvents(sport: Sport, dateRange?: DateRange): Promise<SportEvent[]> {
    const events = await this.mapScenarioEventDetails(sport, dateRange, (scenarioId, detail) => {
      const event = toSportEvent(this.providerId, detail, resolveParticipants(detail).length);
      this.scenarioIdByExternalId.set(event.externalId, scenarioId);
      return event;
    });
    return events.filter((event) => isEventWithinDateRange(event.startDate.toISOString(), dateRange));
  }

  async getEventDetails(eventId: string): Promise<SportEventDetail | null> {
    const match = await this.findEventById(eventId);
    if (!match) {
      return null;
    }

    const detail = await this.fetchJson<EventDetailResponse>(
      withMockEventState(
        `/v1/scenarios/${match.scenarioId}/events/${eventId}/detail`,
        this.pinnedStates.get(eventId),
      ),
    );
    const participants = resolveParticipants(detail);

    return {
      ...toSportEvent(this.providerId, detail, participants.length),
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

  // Thin mapper only — no branching on `options.mockEventState`, no score
  // math, no fallback for a missing/malformed field. The mock provider (see
  // `GolfLiveState` in scenario-store.ts) owns all deterministic scenario
  // content; this method reshapes whatever it returns, verbatim, into the
  // GolfRoundUpdate[] shape. See "PoolMaster Integrates; It Does Not
  // Invent" in
  // requirements/product-requirements/features/contest-event-feed-integration/overview.md
  // — an earlier attempt put per-state scoring logic here and got it
  // backwards.
  async getLiveScores(eventId: string): Promise<LiveScoreResult> {
    const empty: LiveScoreResult = { category: 'GOLF', externalEventId: eventId, rounds: [] };
    const match = await this.findEventById(eventId);
    if (!match) {
      return empty;
    }

    const liveScores = await this.fetchJson<ScoresSnapshotResponse>(
      withMockEventState(
        `/v1/scenarios/${match.scenarioId}/events/${eventId}/scores`,
        this.pinnedStates.get(eventId),
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
    this.payloads.record(path, body.length, raw);
    return raw;
  }
}

function isEventWithinDateRange(startsAt: string, dateRange?: DateRange): boolean {
  if (!dateRange) {
    return true;
  }

  const startTime = new Date(startsAt).getTime();
  return startTime >= dateRange.from.getTime() && startTime <= dateRange.to.getTime();
}

function withMockEventState(path: string, state: MockFeedEventState | undefined): string {
  if (!state) {
    return path;
  }

  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}mockEventState=${encodeURIComponent(state)}`;
}

/**
 * Maps a mock-feed sport literal to its domain `Sport`. Returns `null`
 * for sports PoolMaster does not build (#605): the mock's contract still
 * names tennis, NCAA basketball and a generic `'TEAM_TOURNAMENT'`, but it
 * ships only golf scenarios. Pre-rop.78.13 the
 * adapter's local `SupportedMockSport` union didn't include
 * `'TEAM_TOURNAMENT'` at all, so the runtime fallthrough silently
 * filtered those scenarios out. The generated SDK now exposes
 * `'TEAM_TOURNAMENT'`, so the filter has to be explicit — defaulting
 * the value to a real `Sport` would cross-contaminate (e.g. routing
 * a team-tournament event into NCAA basketball).
 */
const DOMAIN_SPORT_BY_MOCK_SPORT: Readonly<Record<SupportedMockSport, Sport | null>> = {
  GOLF: Sport.GOLF,
  TENNIS: null,
  NCAA_BASKETBALL: null,
  TEAM_TOURNAMENT: null,
};

function toDomainSport(sport: SupportedMockSport): Sport | null {
  return DOMAIN_SPORT_BY_MOCK_SPORT[sport];
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
    case undefined:
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
  };
}

/** The field, with the odds feed's view of each contestant laid over it. */
function resolveParticipants(detail: EventDetailResponse): ContestantRecord[] {
  return mergeContestantView(
    detail.event.field.contestants,
    detail.event.feeds.odds.contestants,
  );
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

/** Where `servePinControls` answers: PUT pins an event's state, DELETE clears it. */
export const PIN_CONTROL_PATH = '/test/event-states/:eventId';

/**
 * Serves the pins on a test server (the functional daemon's copy of the mock feed), so a test in
 * another process pins an event's state before it submits a sync. Test code only.
 */
export function servePinControls(app: FastifyInstance, pinnedStates: Map<string, MockFeedEventState>): void {
  app.put<{ Params: { eventId: string }; Body: { state: MockFeedEventState } }>(PIN_CONTROL_PATH, {
    schema: {
      body: {
        type: 'object',
        required: ['state'],
        properties: { state: { type: 'string', enum: [...mockEventStateKinds] } },
      },
    },
  }, async (request, reply) => {
    pinnedStates.set(request.params.eventId, request.body.state);
    return reply.code(204).send();
  });
  app.delete<{ Params: { eventId: string } }>(PIN_CONTROL_PATH, async (request, reply) => {
    pinnedStates.delete(request.params.eventId);
    return reply.code(204).send();
  });
}
