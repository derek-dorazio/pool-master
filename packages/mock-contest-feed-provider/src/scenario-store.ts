import type { FastifyBaseLogger } from 'fastify';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  feedKinds,
  mockFeedProviderId,
  supportedSports,
  type ContestFeedEventRecord,
  type ContestFeedEventResponse,
  type ContestantDeltaRecord,
  type ContestantRecord,
  type ContestFeedScenarioRecord,
  type ContestFeedSnapshotResponse,
  type ContestFeedUpdateResponse,
  type EventFeedsRecord,
  type EventMetadataRecord,
  type EventScheduleRecord,
  type EventSummary,
  type EventVenueRecord,
  type FeedKind,
  type FeedSnapshotRecord,
  type FeedUpdateRecord,
  type FieldSnapshotRecord,
  type LiveGolfContestantRecord,
  type LiveGolfRoundRecord,
  type LiveGolfRoundStatusKind,
  type LiveScoresSnapshotResponse,
  type MockEventStateKind,
  type ScenarioSummary,
  type SeasonRecord,
} from './contracts';
import {
  buildMockGolfFieldContestants,
  buildMockGolfOddsContestants,
  buildMockGolfRankingContestants,
} from './golf-player-pool';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toStringValue(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid or missing ${field}`);
  }
  return value;
}

function toOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return toStringValue(value, field);
}

function toNumberValue(value: unknown, field: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`Invalid or missing ${field}`);
  }
  return value;
}

function toOptionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return toNumberValue(value, field);
}

function toReadonlyArray<T>(value: unknown, field: string): readonly T[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid or missing ${field}`);
  }
  return value as readonly T[];
}

function ensureEnumValue<T extends readonly string[]>(value: string, allowed: T, field: string): T[number] {
  if (!allowed.includes(value)) {
    throw new Error(`Invalid ${field}: ${value}`);
  }
  return value as T[number];
}

function ensureIsoDateTime(value: string, field: string): string {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`Invalid ${field}: ${value}`);
  }
  return value;
}

function ensureChronological(start: string, end: string | undefined, startField: string, endField: string): void {
  if (!end) {
    return;
  }
  if (Date.parse(end) < Date.parse(start)) {
    throw new Error(`${endField} must be after ${startField}`);
  }
}

function ensureUniqueIds(values: readonly string[], field: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`Duplicate ${field}: ${value}`);
    }
    seen.add(value);
  }
}

function parseSeason(record: unknown, field: string): SeasonRecord {
  if (!isRecord(record)) {
    throw new Error(`Invalid or missing ${field}`);
  }

  const seasonId = toStringValue(record.seasonId, `${field}.seasonId`);
  const name = toStringValue(record.name, `${field}.name`);
  const year = toNumberValue(record.year, `${field}.year`);
  const startsAt = toOptionalString(record.startsAt, `${field}.startsAt`);
  const endsAt = toOptionalString(record.endsAt, `${field}.endsAt`);

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error(`Invalid ${field}.year`);
  }

  if (startsAt) {
    ensureIsoDateTime(startsAt, `${field}.startsAt`);
  }
  if (endsAt) {
    ensureIsoDateTime(endsAt, `${field}.endsAt`);
  }
  if (startsAt && endsAt) {
    ensureChronological(startsAt, endsAt, `${field}.startsAt`, `${field}.endsAt`);
  }

  return { seasonId, name, year, startsAt, endsAt };
}

function parseSchedule(record: unknown, field: string): EventScheduleRecord {
  if (!isRecord(record)) {
    throw new Error(`Invalid or missing ${field}`);
  }

  const startsAt = ensureIsoDateTime(toStringValue(record.startsAt, `${field}.startsAt`), `${field}.startsAt`);
  const endsAt = toOptionalString(record.endsAt, `${field}.endsAt`);
  const releaseAt = toOptionalString(record.releaseAt, `${field}.releaseAt`);
  const fieldLocksAt = toOptionalString(record.fieldLocksAt, `${field}.fieldLocksAt`);

  if (endsAt) {
    ensureIsoDateTime(endsAt, `${field}.endsAt`);
  }
  if (releaseAt) {
    ensureIsoDateTime(releaseAt, `${field}.releaseAt`);
  }
  if (fieldLocksAt) {
    ensureIsoDateTime(fieldLocksAt, `${field}.fieldLocksAt`);
  }

  ensureChronological(startsAt, endsAt, `${field}.startsAt`, `${field}.endsAt`);
  ensureChronological(releaseAt ?? startsAt, fieldLocksAt, `${field}.releaseAt`, `${field}.fieldLocksAt`);

  return { startsAt, endsAt, releaseAt, fieldLocksAt };
}

function parseVenue(record: unknown, field: string): EventVenueRecord | undefined {
  if (record === undefined) {
    return undefined;
  }
  if (!isRecord(record)) {
    throw new Error(`Invalid ${field}`);
  }

  return {
    name: toStringValue(record.name, `${field}.name`),
    city: toOptionalString(record.city, `${field}.city`),
    region: toOptionalString(record.region, `${field}.region`),
    countryCode: toOptionalString(record.countryCode, `${field}.countryCode`),
    timeZone: toOptionalString(record.timeZone, `${field}.timeZone`),
  };
}

function parseMetadata(record: unknown, field: string): EventMetadataRecord | undefined {
  if (record === undefined) {
    return undefined;
  }
  if (!isRecord(record)) {
    throw new Error(`Invalid ${field}`);
  }

  const notesValue = record.notes;
  const notes =
    notesValue === undefined
      ? undefined
      : toReadonlyArray<string>(notesValue, `${field}.notes`).map((note, index) =>
          toStringValue(note, `${field}.notes[${index}]`),
        );

  return {
    officialName: toOptionalString(record.officialName, `${field}.officialName`),
    eventType: toOptionalString(record.eventType, `${field}.eventType`),
    tour: toOptionalString(record.tour, `${field}.tour`),
    externalEventId: toOptionalString(record.externalEventId, `${field}.externalEventId`),
    notes,
  };
}

function parseContestantRecord(record: unknown, field: string): ContestantRecord {
  if (!isRecord(record)) {
    throw new Error(`Invalid ${field}`);
  }

  const contestantId = toStringValue(record.contestantId, `${field}.contestantId`);
  const participantStatusValue = toOptionalString(record.participantStatus, `${field}.participantStatus`);
  const resultValue = toOptionalString(record.result, `${field}.result`);

  return {
    contestantId,
    name: toStringValue(record.name, `${field}.name`),
    teamName: toOptionalString(record.teamName, `${field}.teamName`),
    countryCode: toOptionalString(record.countryCode, `${field}.countryCode`),
    seed: toOptionalNumber(record.seed, `${field}.seed`),
    participantStatus: participantStatusValue
      ? ensureEnumValue(participantStatusValue, ['active', 'provisional', 'withdrawn', 'alternate', 'cut', 'eliminated', 'inactive'] as const, `${field}.participantStatus`)
      : undefined,
    odds: toOptionalNumber(record.odds, `${field}.odds`),
    ranking: toOptionalNumber(record.ranking, `${field}.ranking`),
    strokes: toOptionalNumber(record.strokes, `${field}.strokes`),
    score: toOptionalNumber(record.score, `${field}.score`),
    result: resultValue
      ? ensureEnumValue(resultValue, ['win', 'loss', 'tie', 'cut', 'withdrawn', 'pending'] as const, `${field}.result`)
      : undefined,
    note: toOptionalString(record.note, `${field}.note`),
  };
}

function parseContestantDeltaRecord(record: unknown, field: string): ContestantDeltaRecord {
  if (!isRecord(record)) {
    throw new Error(`Invalid ${field}`);
  }

  const contestantId = toStringValue(record.contestantId, `${field}.contestantId`);
  const participantStatusValue = toOptionalString(record.participantStatus, `${field}.participantStatus`);
  const resultValue = toOptionalString(record.result, `${field}.result`);

  return {
    contestantId,
    name: toOptionalString(record.name, `${field}.name`),
    teamName: toOptionalString(record.teamName, `${field}.teamName`),
    countryCode: toOptionalString(record.countryCode, `${field}.countryCode`),
    seed: toOptionalNumber(record.seed, `${field}.seed`),
    participantStatus: participantStatusValue
      ? ensureEnumValue(participantStatusValue, ['active', 'provisional', 'withdrawn', 'alternate', 'cut', 'eliminated', 'inactive'] as const, `${field}.participantStatus`)
      : undefined,
    odds: toOptionalNumber(record.odds, `${field}.odds`),
    ranking: toOptionalNumber(record.ranking, `${field}.ranking`),
    strokes: toOptionalNumber(record.strokes, `${field}.strokes`),
    score: toOptionalNumber(record.score, `${field}.score`),
    result: resultValue
      ? ensureEnumValue(resultValue, ['win', 'loss', 'tie', 'cut', 'withdrawn', 'pending'] as const, `${field}.result`)
      : undefined,
    note: toOptionalString(record.note, `${field}.note`),
  };
}

function parseFieldSnapshot(record: unknown, field: string): FieldSnapshotRecord {
  if (!isRecord(record)) {
    throw new Error(`Invalid or missing ${field}`);
  }

  const asOf = ensureIsoDateTime(toStringValue(record.asOf, `${field}.asOf`), `${field}.asOf`);
  const status = ensureEnumValue(
    toStringValue(record.status, `${field}.status`),
    ['provisional', 'announced', 'locked', 'final'] as const,
    `${field}.status`,
  );
  const contestants = toReadonlyArray<unknown>(record.contestants, `${field}.contestants`).map((contestant, index) =>
    parseContestantRecord(contestant, `${field}.contestants[${index}]`),
  );

  ensureUniqueIds(
    contestants.map((contestant) => contestant.contestantId),
    `${field}.contestants.contestantId`,
  );

  return {
    asOf,
    status,
    note: toOptionalString(record.note, `${field}.note`),
    contestants,
  };
}

function parseFeedSnapshot(record: unknown, field: string): FeedSnapshotRecord {
  if (!isRecord(record)) {
    throw new Error(`Invalid or missing ${field}`);
  }

  const asOf = ensureIsoDateTime(toStringValue(record.asOf, `${field}.asOf`), `${field}.asOf`);
  const contestants = toReadonlyArray<unknown>(record.contestants, `${field}.contestants`).map((contestant, index) =>
    parseContestantDeltaRecord(contestant, `${field}.contestants[${index}]`),
  );

  ensureUniqueIds(
    contestants.map((contestant) => contestant.contestantId),
    `${field}.contestants.contestantId`,
  );

  return {
    asOf,
    note: toOptionalString(record.note, `${field}.note`),
    contestants,
  };
}

function parseFeeds(record: unknown, field: string): EventFeedsRecord {
  if (!isRecord(record)) {
    throw new Error(`Invalid or missing ${field}`);
  }

  return {
    odds: parseFeedSnapshot(record.odds, `${field}.odds`),
    rankings: parseFeedSnapshot(record.rankings, `${field}.rankings`),
    results: parseFeedSnapshot(record.results, `${field}.results`),
  };
}

function parseUpdates(record: unknown, field: string): readonly FeedUpdateRecord[] | undefined {
  if (record === undefined) {
    return undefined;
  }

  const updates = toReadonlyArray<unknown>(record, field).map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`Invalid ${field}[${index}]`);
    }

    const updateId = toStringValue(item.updateId, `${field}[${index}].updateId`);
    const asOf = ensureIsoDateTime(
      toStringValue(item.asOf, `${field}[${index}].asOf`),
      `${field}[${index}].asOf`,
    );
    const feedKind = ensureEnumValue(
      toStringValue(item.feedKind, `${field}[${index}].feedKind`),
      feedKinds,
      `${field}[${index}].feedKind`,
    );
    const updateType = ensureEnumValue(
      toStringValue(item.updateType, `${field}[${index}].updateType`),
      ['refresh', 'correction', 'live', 'final'] as const,
      `${field}[${index}].updateType`,
    );
    const contestants = toReadonlyArray<unknown>(item.contestants, `${field}[${index}].contestants`).map(
      (contestant, contestantIndex) =>
        parseContestantDeltaRecord(
          contestant,
          `${field}[${index}].contestants[${contestantIndex}]`,
        ),
    );

    ensureUniqueIds(
      contestants.map((contestant) => contestant.contestantId),
      `${field}[${index}].contestants.contestantId`,
    );

    return {
      updateId,
      asOf,
      feedKind,
      updateType,
      note: toOptionalString(item.note, `${field}[${index}].note`),
      contestants,
    };
  });

  ensureUniqueIds(
    updates.map((update) => update.updateId),
    `${field}.updateId`,
  );

  return updates;
}

function validateFeedReferences(
  fieldSnapshot: FieldSnapshotRecord,
  feeds: EventFeedsRecord,
  updates: readonly FeedUpdateRecord[] | undefined,
  field: string,
): void {
  const knownContestantIds = new Set(fieldSnapshot.contestants.map((contestant) => contestant.contestantId));

  const ensureKnownOrNamed = (contestant: ContestantDeltaRecord, contestantField: string): void => {
    if (knownContestantIds.has(contestant.contestantId)) {
      return;
    }
    if (!contestant.name) {
      throw new Error(`${contestantField} must include name when introducing a new contestant`);
    }
    knownContestantIds.add(contestant.contestantId);
  };

  for (const feedKey of ['odds', 'rankings', 'results'] as const) {
    for (const contestant of feeds[feedKey].contestants) {
      ensureKnownOrNamed(contestant, `${field}.feeds.${feedKey}.contestants`);
    }
  }

  for (const update of updates ?? []) {
    for (const contestant of update.contestants) {
      ensureKnownOrNamed(contestant, `${field}.updates[${update.updateId}].contestants`);
    }
  }
}

function parseEvent(record: unknown, field: string): ContestFeedEventRecord {
  if (!isRecord(record)) {
    throw new Error(`Invalid ${field}`);
  }

  const eventId = toStringValue(record.eventId, `${field}.eventId`);
  const name = toStringValue(record.name, `${field}.name`);
  const status = ensureEnumValue(
    toStringValue(record.status, `${field}.status`),
    ['scheduled', 'field_announced', 'in_progress', 'completed', 'corrected'] as const,
    `${field}.status`,
  );
  const schedule = parseSchedule(record.schedule, `${field}.schedule`);
  const venue = parseVenue(record.venue, `${field}.venue`);
  const metadata = parseMetadata(record.metadata, `${field}.metadata`);
  const fieldSnapshot = parseFieldSnapshot(record.field, `${field}.field`);
  const feeds = parseFeeds(record.feeds, `${field}.feeds`);
  const updates = parseUpdates(record.updates, `${field}.updates`);

  ensureChronological(fieldSnapshot.asOf, schedule.startsAt, `${field}.field.asOf`, `${field}.schedule.startsAt`);
  validateFeedReferences(fieldSnapshot, feeds, updates, field);

  return {
    eventId,
    name,
    status,
    schedule,
    venue,
    metadata,
    field: fieldSnapshot,
    feeds,
    updates,
  };
}

export function validateScenario(record: unknown): ContestFeedScenarioRecord {
  if (!isRecord(record)) {
    throw new Error('Scenario file must contain an object');
  }

  const scenarioId = toStringValue(record.scenarioId, 'scenarioId');
  const sport = ensureEnumValue(toStringValue(record.sport, 'sport'), supportedSports, 'sport');
  const provider = toStringValue(record.provider, 'provider');
  const description = typeof record.description === 'string' ? record.description : undefined;
  const season = parseSeason(record.season, 'season');
  const events = toReadonlyArray<unknown>(record.events, 'events').map((event, index) =>
    parseEvent(event, `events[${index}]`),
  );

  if (provider !== mockFeedProviderId) {
    throw new Error(`Scenario ${scenarioId} must use provider ${mockFeedProviderId}`);
  }

  ensureUniqueIds(
    events.map((event) => event.eventId),
    `scenario ${scenarioId} eventId`,
  );

  if (sport === 'GOLF') {
    for (const event of events) {
      if (event.feeds.odds.contestants.length === 0) {
        throw new Error(`Golf event ${event.eventId} must include odds contestants to define the participant field`);
      }
    }
  }

  return {
    scenarioId,
    sport,
    provider: mockFeedProviderId,
    description,
    season,
    events,
  };
}

function normalizeScenario(record: ContestFeedScenarioRecord): ContestFeedScenarioRecord {
  if (record.sport !== 'GOLF') {
    return record;
  }

  const normalizedEvents = record.events.map((event) => normalizeGolfEvent(event));

  return {
    ...record,
    season: {
      ...record.season,
      startsAt: normalizedEvents[0]?.schedule.startsAt ?? record.season.startsAt,
      endsAt: normalizedEvents.at(-1)?.schedule.endsAt ?? record.season.endsAt,
    },
    events: normalizedEvents,
  };
}

function normalizeGolfEvent(event: ContestFeedEventRecord): ContestFeedEventRecord {
  const fieldContestants = buildMockGolfFieldContestants();
  const oddsContestants = buildMockGolfOddsContestants(event.eventId);
  const rankingContestants = buildMockGolfRankingContestants();
  const usesExplicitRoundScores = event.feeds.results.contestants.some(
    (contestant) => typeof contestant.strokes === 'number',
  );
  const fieldAsOf = event.schedule.releaseAt
    ?? new Date(Date.parse(event.schedule.startsAt) - (7 * 24 * 60 * 60 * 1000)).toISOString();
  const rankingAsOf = new Date(Date.parse(fieldAsOf) + (2 * 60 * 60 * 1000)).toISOString();
  const resultsAsOf = event.status === 'scheduled' || event.status === 'field_announced'
    ? fieldAsOf
    : event.schedule.endsAt
      ?? new Date(Date.parse(event.schedule.startsAt) + (72 * 60 * 60 * 1000)).toISOString();

  return {
    ...event,
    field: {
      ...event.field,
      asOf: fieldAsOf,
      status: isManualTestLifecycleEvent(event) ? event.field.status : normalizeGolfFieldStatus(event.status),
      contestants: fieldContestants,
    },
    feeds: {
      odds: {
        ...event.feeds.odds,
        asOf: fieldAsOf,
        contestants: oddsContestants,
      },
      rankings: {
        ...event.feeds.rankings,
        asOf: rankingAsOf,
        contestants: rankingContestants,
      },
      results: {
        ...event.feeds.results,
        asOf: resultsAsOf,
        contestants: usesExplicitRoundScores
          ? event.feeds.results.contestants
          : buildGolfResultFeed(event, fieldContestants, oddsContestants),
      },
    },
  };
}

function normalizeGolfFieldStatus(
  status: ContestFeedEventRecord['status'],
): FieldSnapshotRecord['status'] {
  switch (status) {
    case 'scheduled':
    case 'field_announced':
      return 'announced';
    case 'in_progress':
      return 'locked';
    case 'completed':
    case 'corrected':
      return 'final';
  }
}

function mergeContestants(
  contestants: readonly ContestantRecord[],
  overrides: readonly ContestantDeltaRecord[],
): readonly ContestantRecord[] {
  const map = new Map<string, ContestantRecord>();

  for (const contestant of contestants) {
    map.set(contestant.contestantId, { ...contestant });
  }

  for (const override of overrides) {
    const current = map.get(override.contestantId) ?? {
      contestantId: override.contestantId,
      name: override.name ?? override.contestantId,
    };
    const merged = { ...current, contestantId: override.contestantId };

    for (const [key, value] of Object.entries(override) as Array<[keyof ContestantDeltaRecord, unknown]>) {
      if (value !== undefined) {
        Object.assign(merged, { [key]: value });
      }
    }

    map.set(override.contestantId, merged);
  }

  return [...map.values()].sort((left, right) => {
    const leftRanking = typeof left.ranking === 'number' ? left.ranking : Number.POSITIVE_INFINITY;
    const rightRanking = typeof right.ranking === 'number' ? right.ranking : Number.POSITIVE_INFINITY;
    if (leftRanking !== rightRanking) return leftRanking - rightRanking;
    const leftOdds = typeof left.odds === 'number' ? left.odds : Number.POSITIVE_INFINITY;
    const rightOdds = typeof right.odds === 'number' ? right.odds : Number.POSITIVE_INFINITY;
    if (leftOdds !== rightOdds) return leftOdds - rightOdds;
    const leftSeed = typeof left.seed === 'number' ? left.seed : Number.POSITIVE_INFINITY;
    const rightSeed = typeof right.seed === 'number' ? right.seed : Number.POSITIVE_INFINITY;
    if (leftSeed !== rightSeed) return leftSeed - rightSeed;
    return left.name.localeCompare(right.name);
  });
}

function resolveContestantsForFeed(
  sport: ContestFeedScenarioRecord['sport'],
  event: ContestFeedEventRecord,
): readonly ContestantRecord[] {
  if (sport === 'GOLF') {
    return mergeContestants(event.field.contestants, event.feeds.odds.contestants);
  }

  return event.field.contestants;
}

function hashUnit(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 4294967295;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeLogOdds(odds: number, minOdds: number, maxOdds: number): number {
  const safeOdds = Math.max(odds, 1.01);
  const low = Math.log(Math.max(minOdds, 1.01));
  const high = Math.log(Math.max(maxOdds, 1.01));

  if (high <= low) {
    return 0.5;
  }

  return (Math.log(safeOdds) - low) / (high - low);
}

function scoreRelativeToPar(input: {
  eventSeed: string;
  tick: number;
  participantId: string;
  decimalOdds: number;
  minOdds: number;
  maxOdds: number;
}): number {
  const oddsFactor = normalizeLogOdds(
    input.decimalOdds,
    input.minOdds,
    input.maxOdds,
  );
  const strength = 1 - oddsFactor;
  const baseline = 12 - (24 * strength);
  const volatility = 3 + (5 * oddsFactor);
  const fieldDrift = (hashUnit(`${input.eventSeed}:${input.tick}:field`) - 0.5) * 4;
  const playerNoise =
    ((hashUnit(`${input.eventSeed}:${input.tick}:${input.participantId}:a`)
      + hashUnit(`${input.eventSeed}:${input.tick}:${input.participantId}:b`)) - 1)
    * volatility;

  return clamp(Math.round(baseline + fieldDrift + playerNoise), -20, 20);
}

type GolfLiveState =
  | 'pre-live'
  | 'r1-in-progress'
  | 'r1-complete'
  | 'r2-complete'
  | 'correction'
  | 'r4-complete-pending-final'
  | 'playoff'
  | 'completed'
  | 'late-correction';

interface GolfLiveBuildContext {
  readonly event: ContestFeedEventRecord;
  readonly contestants: readonly ContestantRecord[];
  readonly state: GolfLiveState;
  readonly asOf: string;
}

function resolveGolfLiveState(
  event: ContestFeedEventRecord,
  mockEventState: MockEventStateKind | undefined,
): GolfLiveState {
  switch (mockEventState) {
    case 'open':
    case 'locked':
    case 'golf-pre-live':
      return 'pre-live';
    case 'live':
    case 'golf-r1-in-progress':
      return 'r1-in-progress';
    case 'golf-r1-complete':
      return 'r1-complete';
    case 'golf-r2-complete':
      return 'r2-complete';
    case 'golf-correction':
      return 'correction';
    case 'golf-r4-complete-pending-final':
      return 'r4-complete-pending-final';
    case 'golf-playoff':
      return 'playoff';
    case 'completed':
    case 'golf-completed':
      return 'completed';
    case 'golf-late-correction':
      return 'late-correction';
    case undefined:
      if (event.status === 'completed') return 'completed';
      if (event.status === 'in_progress') return 'r1-in-progress';
      return 'pre-live';
  }
}

function completedAtForRound(event: ContestFeedEventRecord, round: number): string {
  const startsAt = Date.parse(event.schedule.startsAt);
  const base = Number.isNaN(startsAt) ? Date.UTC(2026, 0, 1, 18) : startsAt;
  return new Date(base + ((round - 1) * 24 * 60 * 60 * 1000) + (8 * 60 * 60 * 1000)).toISOString();
}

function golfRoundScoreToPar(event: ContestFeedEventRecord, contestant: ContestantRecord, round: number): number {
  const seed = typeof contestant.seed === 'number' ? contestant.seed : 80;
  const strength = clamp((81 - seed) / 80, 0, 1);
  const eventSeed = event.metadata?.externalEventId ?? event.eventId;
  const noise = (hashUnit(`${eventSeed}:${contestant.contestantId}:round:${round}`) - 0.5) * 8;
  return clamp(Math.round(4 - (7 * strength) + noise), -7, 7);
}

function completedGolfRound(
  event: ContestFeedEventRecord,
  contestant: ContestantRecord,
  round: number,
  modifier = 0,
  status: LiveGolfRoundStatusKind = 'COMPLETED',
): LiveGolfRoundRecord {
  const scoreToPar = clamp(golfRoundScoreToPar(event, contestant, round) + modifier, -9, 9);
  return {
    round,
    strokes: 72 + scoreToPar,
    scoreToPar,
    thru: round > 4 ? 19 : 18,
    status,
    completedAt: completedAtForRound(event, round),
  };
}

function inProgressGolfRound(event: ContestFeedEventRecord, contestant: ContestantRecord, round: number): LiveGolfRoundRecord {
  const eventSeed = event.metadata?.externalEventId ?? event.eventId;
  const thru = 4 + Math.floor(hashUnit(`${eventSeed}:${contestant.contestantId}:thru:${round}`) * 10);
  const scoreToPar = clamp(golfRoundScoreToPar(event, contestant, round), -4, 4);
  return {
    round,
    strokes: Math.max(0, (thru * 4) + scoreToPar),
    scoreToPar,
    thru,
    status: 'IN_PROGRESS',
  };
}

function isCutContestant(contestant: ContestantRecord, index: number): boolean {
  return (typeof contestant.seed === 'number' && contestant.seed > 70) || index >= 70;
}

function isWithdrawnContestant(contestant: ContestantRecord): boolean {
  return contestant.contestantId === 'golfer-06';
}

function isDisqualifiedContestant(contestant: ContestantRecord): boolean {
  return contestant.contestantId === 'golfer-35';
}

function shouldApplyR2Correction(state: GolfLiveState, contestant: ContestantRecord, index: number): boolean {
  return state === 'correction' && (contestant.contestantId === 'golfer-01' || index === 0);
}

function shouldApplyLateCorrection(state: GolfLiveState, contestant: ContestantRecord, index: number): boolean {
  return state === 'late-correction' && (contestant.contestantId === 'golfer-01' || index === 0);
}

function liveRoundsForContestant(
  context: GolfLiveBuildContext,
  contestant: ContestantRecord,
  index: number,
): readonly LiveGolfRoundRecord[] {
  const rounds: LiveGolfRoundRecord[] = [];
  const addCompleted = (round: number, modifier = 0, status: LiveGolfRoundStatusKind = 'COMPLETED') => {
    rounds.push(completedGolfRound(context.event, contestant, round, modifier, status));
  };

  switch (context.state) {
    case 'pre-live':
      return [];
    case 'r1-in-progress':
      return [inProgressGolfRound(context.event, contestant, 1)];
    case 'r1-complete':
      addCompleted(1);
      return rounds;
    case 'r2-complete':
    case 'correction':
      addCompleted(1);
      if (isDisqualifiedContestant(contestant)) {
        addCompleted(2, 0, 'DSQ');
        return rounds;
      }
      addCompleted(2, shouldApplyR2Correction(context.state, contestant, index) ? -2 : 0, isCutContestant(contestant, index) ? 'MISSED_CUT' : 'COMPLETED');
      return rounds;
    case 'r4-complete-pending-final':
    case 'playoff':
    case 'completed':
    case 'late-correction':
      addCompleted(1);
      if (isDisqualifiedContestant(contestant)) {
        addCompleted(2, 0, 'DSQ');
        return rounds;
      }
      if (isCutContestant(contestant, index)) {
        addCompleted(2, 0, 'MISSED_CUT');
        return rounds;
      }
      addCompleted(2);
      if (isWithdrawnContestant(contestant)) {
        addCompleted(3, 0, 'DNF');
        return rounds;
      }
      addCompleted(3);
      addCompleted(4, shouldApplyLateCorrection(context.state, contestant, index) ? -2 : 0);
      return rounds;
  }
}

function scoreLiveGolfContestant(contestant: LiveGolfContestantRecord): number {
  return contestant.rounds.reduce((sum, round) => sum + round.scoreToPar, 0);
}

function withPlayoffRounds(context: GolfLiveBuildContext, contestants: readonly LiveGolfContestantRecord[]): readonly LiveGolfContestantRecord[] {
  if (context.state !== 'playoff' && context.state !== 'completed' && context.state !== 'late-correction') {
    return contestants;
  }

  const eligible = contestants
    .filter((contestant) => contestant.rounds.length === 4 && contestant.rounds.every((round) => round.status === 'COMPLETED'))
    .sort((left, right) => scoreLiveGolfContestant(left) - scoreLiveGolfContestant(right) || left.name.localeCompare(right.name))
    .slice(0, 2);
  const playoffParticipantIds = new Set(eligible.map((contestant) => contestant.contestantId));

  return contestants.map((contestant) => {
    if (!playoffParticipantIds.has(contestant.contestantId)) {
      return contestant;
    }

    const playoffIndex = eligible.findIndex((eligibleContestant) => eligibleContestant.contestantId === contestant.contestantId);
    const playoffRound =
      context.state === 'playoff' && playoffIndex === 1
        ? { ...completedGolfRound(context.event, contestant, 5, 1), status: 'IN_PROGRESS' as const, thru: 19, completedAt: undefined }
        : completedGolfRound(context.event, contestant, 5, playoffIndex === 0 ? -1 : 1);

    return {
      ...contestant,
      rounds: [...contestant.rounds, playoffRound],
    };
  });
}

function participantStatusForLiveRounds(
  contestant: ContestantRecord,
  rounds: readonly LiveGolfRoundRecord[],
): ContestantRecord['participantStatus'] {
  const terminalStatus = rounds.at(-1)?.status;
  if (terminalStatus === 'MISSED_CUT') return 'cut';
  if (terminalStatus === 'DNF') return 'withdrawn';
  if (terminalStatus === 'DSQ') return 'eliminated';
  return contestant.participantStatus;
}

function validateLiveGolfContestants(
  contestants: readonly LiveGolfContestantRecord[],
  knownContestantIds: ReadonlySet<string>,
): void {
  for (const contestant of contestants) {
    if (!knownContestantIds.has(contestant.contestantId)) {
      throw new Error(`Live golf response contains unknown contestant: ${contestant.contestantId}`);
    }

    const seenRounds = new Set<number>();
    for (const round of contestant.rounds) {
      if (round.round < 1 || round.round > 8) {
        throw new Error(`Live golf response contains invalid round ${round.round} for ${contestant.contestantId}`);
      }
      if (seenRounds.has(round.round)) {
        throw new Error(`Live golf response contains duplicate round ${round.round} for ${contestant.contestantId}`);
      }
      seenRounds.add(round.round);
      if (round.strokes < 0) {
        throw new Error(`Live golf response contains negative strokes for ${contestant.contestantId}`);
      }
      if (round.status !== 'IN_PROGRESS' && round.completedAt === undefined) {
        throw new Error(`Live golf terminal round is missing completedAt for ${contestant.contestantId}`);
      }
      if (round.status === 'IN_PROGRESS' && round.completedAt !== undefined) {
        throw new Error(`Live golf in-progress round has completedAt for ${contestant.contestantId}`);
      }
      if (round.thru !== undefined && round.thru < 0) {
        throw new Error(`Live golf response contains invalid thru for ${contestant.contestantId}`);
      }
    }
  }
}

function buildLiveGolfContestants(
  scenario: ContestFeedScenarioRecord,
  event: ContestFeedEventRecord,
  state: GolfLiveState,
  asOf: string,
): readonly LiveGolfContestantRecord[] {
  const contestants = resolveContestantsForFeed(scenario.sport, event);
  const context: GolfLiveBuildContext = { event, contestants, state, asOf };
  const liveContestants = contestants.map((contestant, index) => {
    const rounds = liveRoundsForContestant(context, contestant, index);
    return {
      contestantId: contestant.contestantId,
      name: contestant.name,
      ...(contestant.teamName ? { teamName: contestant.teamName } : {}),
      ...(contestant.countryCode ? { countryCode: contestant.countryCode } : {}),
      ...(typeof contestant.seed === 'number' ? { seed: contestant.seed } : {}),
      ...(participantStatusForLiveRounds(contestant, rounds) ? { participantStatus: participantStatusForLiveRounds(contestant, rounds) } : {}),
      rounds,
    };
  });
  const withPlayoff = withPlayoffRounds(context, liveContestants);
  validateLiveGolfContestants(withPlayoff, new Set(contestants.map((contestant) => contestant.contestantId)));

  return withPlayoff
    .filter((contestant) => contestant.rounds.length > 0)
    .sort((left, right) => {
      const leftScore = scoreLiveGolfContestant(left);
      const rightScore = scoreLiveGolfContestant(right);
      if (leftScore !== rightScore) return leftScore - rightScore;
      return left.name.localeCompare(right.name);
    });
}

function strokesForGolfScore(score: number): number {
  const mockGolfRoundPar = 72;
  return mockGolfRoundPar + score;
}

function buildGolfResultFeed(
  event: ContestFeedEventRecord,
  fieldContestants: readonly ContestantRecord[],
  oddsContestants: readonly ContestantDeltaRecord[],
): readonly ContestantDeltaRecord[] {
  if (event.status === 'scheduled' || event.status === 'field_announced') {
    return fieldContestants.map((contestant) => ({
      contestantId: contestant.contestantId,
      result: 'pending',
    }));
  }

  const oddsByContestantId = new Map(
    oddsContestants.map((contestant) => [
      contestant.contestantId,
      typeof contestant.odds === 'number' ? contestant.odds : 100,
    ]),
  );
  const oddsValues = [...oddsByContestantId.values()];
  const minOdds = oddsValues.length > 0 ? Math.min(...oddsValues) : 1.01;
  const maxOdds = oddsValues.length > 0 ? Math.max(...oddsValues) : 100;
  const terminalTick = isManualTestLifecycleEvent(event)
    ? manualTestPhaseMinutes
    : event.status === 'in_progress'
      ? 12
      : 72;
  const eventSeed = event.metadata?.externalEventId ?? event.eventId;

  const scored = fieldContestants
    .map((contestant) => {
      const score = scoreRelativeToPar({
        eventSeed,
        tick: terminalTick,
        participantId: contestant.contestantId,
        decimalOdds: oddsByContestantId.get(contestant.contestantId) ?? maxOdds,
        minOdds,
        maxOdds,
      });
      return {
        contestantId: contestant.contestantId,
        score,
        strokes: strokesForGolfScore(score),
      };
    })
    .sort((left, right) => left.score - right.score || left.contestantId.localeCompare(right.contestantId));

  return scored.map((contestant, index) => ({
    contestantId: contestant.contestantId,
    score: contestant.score,
    strokes: contestant.strokes,
    result:
      event.status === 'in_progress'
        ? 'pending'
        : index === 0
          ? 'win'
          : index >= 70
            ? 'cut'
            : 'loss',
  }));
}

function applyMockEventState(
  scenario: ContestFeedScenarioRecord,
  event: ContestFeedEventRecord,
  mockEventState: MockEventStateKind | undefined,
): ContestFeedEventRecord {
  if (!mockEventState) {
    return event;
  }
  if (scenario.sport !== 'GOLF') {
    throw new Error(`Mock event state controls are only supported for GOLF scenarios: ${scenario.scenarioId}`);
  }

  const liveState = resolveGolfLiveState(event, mockEventState);
  const status: ContestFeedEventRecord['status'] =
    liveState === 'r1-in-progress'
      || liveState === 'r1-complete'
      || liveState === 'r2-complete'
      || liveState === 'correction'
      || liveState === 'r4-complete-pending-final'
      || liveState === 'playoff'
      ? 'in_progress'
      : liveState === 'completed' || liveState === 'late-correction'
        ? 'completed'
        : 'field_announced';
  const fieldStatus: FieldSnapshotRecord['status'] =
    status === 'completed'
      ? 'final'
      : liveState === 'pre-live' && mockEventState !== 'locked'
        ? 'announced'
        : 'locked';
  const asOf =
    status === 'completed'
      ? event.schedule.endsAt ?? event.schedule.startsAt
      : status === 'in_progress'
        ? event.schedule.startsAt
        : event.field.asOf;
  const stateEvent = {
    ...event,
    status,
    field: {
      ...event.field,
      asOf,
      status: fieldStatus,
      note: `Mock event state override: ${mockEventState}.`,
    },
  };
  const fieldContestants = stateEvent.field.contestants;
  const oddsContestants = stateEvent.feeds.odds.contestants;

  return {
    ...stateEvent,
    feeds: {
      ...stateEvent.feeds,
      results: {
        ...stateEvent.feeds.results,
        asOf,
        note: `Mock event state override: ${mockEventState}.`,
        contestants: buildGolfResultFeed(stateEvent, fieldContestants, oddsContestants),
      },
    },
  };
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

function addHours(base: Date, hours: number): Date {
  return new Date(base.getTime() + hours * 60 * 60 * 1000);
}

function startOfUtcDay(base: Date): Date {
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
}

function utcWeekdayStartOnOrBefore(base: Date, weekday: number, hour: number): Date {
  const today = startOfUtcDay(base);
  const daysSinceWeekday = (today.getUTCDay() - weekday + 7) % 7;
  let candidate = addHours(addDays(today, -daysSinceWeekday), hour);

  if (candidate.getTime() > base.getTime()) {
    candidate = addDays(candidate, -7);
  }

  return candidate;
}

function toDateStamp(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function emptyFeeds(asOf: string): EventFeedsRecord {
  return {
    odds: {
      asOf,
      contestants: [],
    },
    rankings: {
      asOf,
      contestants: [],
    },
    results: {
      asOf,
      contestants: [],
    },
  };
}

function buildRelativeGolfEvent(input: {
  eventId: string;
  name: string;
  status: ContestFeedEventRecord['status'];
  startsAt: Date;
  endsAt?: Date;
  releaseAt: Date;
  fieldLocksAt: Date;
  fieldStatus?: FieldSnapshotRecord['status'];
  eventType?: string;
  notes: readonly string[];
  updates?: readonly FeedUpdateRecord[];
}): ContestFeedEventRecord {
  const endsAt = input.endsAt ?? addDays(input.startsAt, 4);
  const fieldAsOf = input.releaseAt.toISOString();

  return {
    eventId: input.eventId,
    name: input.name,
    status: input.status,
    schedule: {
      startsAt: input.startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      releaseAt: input.releaseAt.toISOString(),
      fieldLocksAt: input.fieldLocksAt.toISOString(),
    },
    venue: {
      name: 'PoolMaster QA Links',
      city: 'Cincinnati',
      region: 'OH',
      countryCode: 'US',
      timeZone: 'America/New_York',
    },
    metadata: {
      officialName: input.name,
      eventType: input.eventType ?? 'relative-qa',
      tour: 'PoolMaster QA',
      externalEventId: input.eventId,
      notes: input.notes,
    },
    field: {
      asOf: fieldAsOf,
      status: input.fieldStatus ?? (input.status === 'in_progress' ? 'locked' : 'announced'),
      note: input.notes[0],
      contestants: [],
    },
    feeds: emptyFeeds(fieldAsOf),
    updates: input.updates ?? [],
  };
}

function toEventIdTimestamp(date: Date): string {
  return date.toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'z')
    .toLowerCase();
}

function parseManualTestEventStartsAt(eventId: string): Date | null {
  const match = /^golf-relative-manual-test-(\d{8})t(\d{6})z$/.exec(eventId);
  if (!match) {
    return null;
  }

  const [, datePart, timePart] = match;
  const startsAt = new Date(
    `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}`
      + `T${timePart.slice(0, 2)}:${timePart.slice(2, 4)}:${timePart.slice(4, 6)}.000Z`,
  );

  if (Number.isNaN(startsAt.getTime())) {
    return null;
  }

  return startsAt;
}

function resolveManualLifecyclePhase(input: {
  readonly now: Date;
  readonly fieldLocksAt: Date;
  readonly startsAt: Date;
  readonly endsAt: Date;
}): ManualTestLifecyclePhase {
  const time = input.now.getTime();
  if (time < input.fieldLocksAt.getTime()) {
    return 'open';
  }
  if (time < input.startsAt.getTime()) {
    return 'field_locked';
  }
  if (time < input.endsAt.getTime()) {
    return 'in_progress';
  }
  return 'completed';
}

type RelativeGolfLifecyclePhase = 'open' | 'field_locked' | 'in_progress' | 'completed';

function resolveRelativeGolfLifecyclePhase(input: {
  readonly now: Date;
  readonly fieldLocksAt: Date;
  readonly startsAt: Date;
  readonly endsAt: Date;
}): RelativeGolfLifecyclePhase {
  const time = input.now.getTime();
  if (time < input.fieldLocksAt.getTime()) {
    return 'open';
  }
  if (time < input.startsAt.getTime()) {
    return 'field_locked';
  }
  if (time < input.endsAt.getTime()) {
    return 'in_progress';
  }
  return 'completed';
}

function statusForRelativeGolfPhase(phase: RelativeGolfLifecyclePhase): ContestFeedEventRecord['status'] {
  switch (phase) {
    case 'in_progress':
      return 'in_progress';
    case 'completed':
      return 'completed';
    case 'open':
    case 'field_locked':
      return 'field_announced';
  }
}

function fieldStatusForRelativeGolfPhase(phase: RelativeGolfLifecyclePhase): FieldSnapshotRecord['status'] {
  switch (phase) {
    case 'completed':
      return 'final';
    case 'field_locked':
    case 'in_progress':
      return 'locked';
    case 'open':
      return 'announced';
  }
}

function buildManualLifecycleUpdates(input: {
  readonly eventId: string;
  readonly fieldLocksAt: Date;
  readonly startsAt: Date;
  readonly endsAt: Date;
}): readonly FeedUpdateRecord[] {
  return [
    {
      updateId: `${input.eventId}-field-locked`,
      asOf: input.fieldLocksAt.toISOString(),
      feedKind: 'field',
      updateType: 'refresh',
      note: 'Manual test field locked.',
      contestants: [],
    },
    {
      updateId: `${input.eventId}-live`,
      asOf: input.startsAt.toISOString(),
      feedKind: 'results',
      updateType: 'live',
      note: 'Manual test live scoring started.',
      contestants: [],
    },
    {
      updateId: `${input.eventId}-final`,
      asOf: input.endsAt.toISOString(),
      feedKind: 'results',
      updateType: 'final',
      note: 'Manual test final results available.',
      contestants: [],
    },
  ];
}

function buildManualTestLifecycleEvent(anchor: Date, now: Date): ContestFeedEventRecord {
  const fieldLocksAt = new Date(anchor.getTime() + manualTestPhaseMs);
  const startsAt = new Date(fieldLocksAt.getTime() + manualTestPhaseMs);
  const endsAt = new Date(startsAt.getTime() + manualTestPhaseMs);
  const phase = resolveManualLifecyclePhase({ now, fieldLocksAt, startsAt, endsAt });
  const eventId = `golf-relative-manual-test-${toEventIdTimestamp(startsAt)}`;
  const status: ContestFeedEventRecord['status'] =
    phase === 'in_progress'
      ? 'in_progress'
      : phase === 'completed'
        ? 'completed'
        : 'field_announced';

  return buildRelativeGolfEvent({
    eventId,
    name: `Manual Test Golf Tournament for ${startsAt.toISOString()}`,
    status,
    startsAt,
    endsAt,
    releaseAt: new Date(anchor.getTime() - 5 * minuteMs),
    fieldLocksAt,
    fieldStatus:
      phase === 'completed'
        ? 'final'
        : phase === 'open'
          ? 'announced'
          : 'locked',
    eventType: manualTestEventType,
    notes: [
      `Manual test lifecycle phase: ${phase}.`,
      `Open until ${fieldLocksAt.toISOString()}; locked until ${startsAt.toISOString()}; live until ${endsAt.toISOString()}.`,
    ],
    updates: buildManualLifecycleUpdates({ eventId, fieldLocksAt, startsAt, endsAt }),
  });
}

function rollingWeekendEnd(startsAt: Date): Date {
  return addHours(addDays(startsAt, 3), 11);
}

function firstRollingWeekendStart(now: Date): Date {
  return utcWeekdayStartOnOrBefore(now, 4, 12);
}

function buildRollingWeekendGolfEvents(now: Date): readonly ContestFeedEventRecord[] {
  const firstThursday = firstRollingWeekendStart(now);

  return [0, 1].map((weekOffset) => {
    const startsAt = addDays(firstThursday, weekOffset * 7);
    const endsAt = rollingWeekendEnd(startsAt);
    const releaseAt = addDays(startsAt, -14);
    const fieldLocksAt = addHours(startsAt, -20);
    const phase = resolveRelativeGolfLifecyclePhase({ now, fieldLocksAt, startsAt, endsAt });
    const dateStamp = startsAt.toISOString().slice(0, 10).replace(/-/g, '');
    const eventId = `golf-relative-weekend-${dateStamp}`;
    const name = `Rolling QA Weekend ${weekOffset + 1} Championship (${toDateStamp(startsAt)})`;

    return buildRelativeGolfEvent({
      eventId,
      name,
      status: statusForRelativeGolfPhase(phase),
      startsAt,
      endsAt,
      releaseAt,
      fieldLocksAt,
      fieldStatus: fieldStatusForRelativeGolfPhase(phase),
      eventType: 'rolling-weekend-qa',
      notes: [
        `Rolling QA Thursday-Sunday tournament ${weekOffset + 1}.`,
        `Provider lifecycle phase: ${phase}.`,
        `Starts Thursday ${startsAt.toISOString()} and ends Sunday ${endsAt.toISOString()}.`,
        'Field is released early and locks before tournament start for contest creation testing.',
      ],
    });
  });
}

export function buildRelativeTodayGolfScenario(
  now = new Date(),
): ContestFeedScenarioRecord {
  const relativeEvents = buildRollingWeekendGolfEvents(now);

  return normalizeScenario({
    scenarioId: 'golf-relative-today',
    sport: 'GOLF',
    provider: mockFeedProviderId,
    description: 'Generated rolling upcoming golf weekend events for QA sync testing.',
    season: {
      seasonId: `golf-relative-${now.getUTCFullYear()}`,
      name: 'Relative QA Golf Season',
      year: now.getUTCFullYear(),
    },
    events: relativeEvents,
  });
}

function summarizeEvent(
  event: ContestFeedEventRecord,
  sport: ContestFeedScenarioRecord['sport'],
): Record<string, unknown> {
  return {
    eventId: event.eventId,
    name: event.name,
    status: event.status,
    startsAt: event.schedule.startsAt,
    releaseAt: event.schedule.releaseAt,
    fieldLocksAt: event.schedule.fieldLocksAt,
    fieldStatus: event.field.status,
    contestantCount: resolveContestantsForFeed(sport, event).length,
  };
}

function summarizeScenario(scenario: ContestFeedScenarioRecord): Record<string, unknown> {
  return {
    scenarioId: scenario.scenarioId,
    sport: scenario.sport,
    eventCount: scenario.events.length,
    events: scenario.events.map((event) => summarizeEvent(event, scenario.sport)),
  };
}

function loadJsonFile(filePath: string): ContestFeedScenarioRecord {
  const contents = readFileSync(filePath, 'utf8');
  return normalizeScenario(validateScenario(JSON.parse(contents) as unknown));
}

export interface ScenarioStoreOptions {
  readonly now?: () => Date;
  readonly includeRelativeTodayGolfScenario?: boolean;
}

const minuteMs = 60 * 1000;
const manualTestPhaseMinutes = 20;
const manualTestPhaseMs = manualTestPhaseMinutes * minuteMs;
const manualTestEventType = 'relative-manual-test';

type ManualTestLifecyclePhase = 'open' | 'field_locked' | 'in_progress' | 'completed';

export class ScenarioStore {
  private readonly staticScenarios: readonly ContestFeedScenarioRecord[];
  private readonly liveScoreTicks = new Map<string, number>();

  public constructor(
    scenarioDir: string,
    private readonly logger?: FastifyBaseLogger,
    private readonly options: ScenarioStoreOptions = {},
  ) {
    const entries = readdirSync(scenarioDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => loadJsonFile(join(scenarioDir, entry.name)));
    const generatedScenarios =
      options.includeRelativeTodayGolfScenario === false
        ? []
        : [this.buildRelativeTodayGolfScenario()];
    const allScenarios = [...entries, ...generatedScenarios];

    ensureUniqueIds(
      allScenarios.map((scenario) => scenario.scenarioId),
      'scenarioId',
    );

    this.staticScenarios = entries.sort((left, right) => left.scenarioId.localeCompare(right.scenarioId));
    this.logger?.info(
      {
        action: 'mockScenarioStore.load.success',
        data: {
          scenarioDir,
          staticScenarioCount: entries.length,
          generatedScenarioCount: generatedScenarios.length,
          scenarioCount: allScenarios.length,
          eventCount: this.getEventCount(),
          generatedScenarios: generatedScenarios.map((scenario) => ({
            scenarioId: scenario.scenarioId,
            eventCount: scenario.events.length,
          })),
        },
      },
      'Loaded mock contest-feed scenarios',
    );
    this.logger?.debug(
      {
        action: 'mockScenarioStore.load.payload',
        data: {
          scenarios: allScenarios
            .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId))
            .map((scenario) => summarizeScenario(scenario)),
        },
      },
      'Loaded mock contest-feed scenario payload',
    );
  }

  private currentNow(): Date {
    return this.options.now?.() ?? new Date();
  }

  private buildRelativeTodayGolfScenario(): ContestFeedScenarioRecord {
    const now = this.currentNow();
    return buildRelativeTodayGolfScenario(now);
  }

  private getScenarios(): readonly ContestFeedScenarioRecord[] {
    const generatedScenarios =
      this.options.includeRelativeTodayGolfScenario === false
        ? []
        : [this.buildRelativeTodayGolfScenario()];

    return [...this.staticScenarios, ...generatedScenarios]
      .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId));
  }

  public listScenarios(): readonly ScenarioSummary[] {
    const scenarios = this.getScenarios().map((scenario) => ({
      scenarioId: scenario.scenarioId,
      sport: scenario.sport,
      provider: scenario.provider,
      description: scenario.description,
      seasonId: scenario.season.seasonId,
      seasonName: scenario.season.name,
      seasonYear: scenario.season.year,
      eventCount: scenario.events.length,
    }));
    this.logger?.debug(
      { action: 'mockScenarioStore.listScenarios', data: { scenarioCount: scenarios.length, scenarios } },
      'Listed mock contest-feed scenarios',
    );
    return scenarios;
  }

  public getScenario(scenarioId: string): ContestFeedScenarioRecord {
    const scenario = this.getScenarios().find((item) => item.scenarioId === scenarioId);
    if (!scenario) {
      this.logger?.warn(
        { action: 'mockScenarioStore.getScenario.notFound', data: { scenarioId } },
        'Mock contest-feed scenario was not found',
      );
      throw new Error(`Scenario not found: ${scenarioId}`);
    }
    this.logger?.debug(
      { action: 'mockScenarioStore.getScenario.success', data: { scenarioId, scenario: summarizeScenario(scenario) } },
      'Loaded mock contest-feed scenario',
    );
    return scenario;
  }

  public listEvents(scenarioId: string): readonly EventSummary[] {
    const scenario = this.getScenario(scenarioId);
    const events = [...scenario.events]
      .sort(
        (left, right) =>
          left.schedule.startsAt.localeCompare(right.schedule.startsAt) || left.eventId.localeCompare(right.eventId),
      )
      .map((event) => ({
        eventId: event.eventId,
        name: event.name,
        status: event.status,
        startsAt: event.schedule.startsAt,
        endsAt: event.schedule.endsAt,
        releaseAt: event.schedule.releaseAt,
        fieldLocksAt: event.schedule.fieldLocksAt,
        venueName: event.venue?.name,
        fieldStatus: event.field.status,
        contestantCount: resolveContestantsForFeed(scenario.sport, event).length,
      }));
    this.logger?.info(
      {
        action: 'mockScenarioStore.listEvents',
        data: {
          scenarioId,
          eventCount: events.length,
          manualTestEvent: summarizeManualTestEvent(scenario.events, this.currentNow()),
        },
      },
      'Listed mock contest-feed scenario events',
    );
    this.logger?.debug(
      { action: 'mockScenarioStore.listEvents.payload', data: { scenarioId, events } },
      'Listed mock contest-feed scenario event payload',
    );
    return events;
  }

  public getEvent(
    scenarioId: string,
    eventId: string,
    mockEventState?: MockEventStateKind,
  ): ContestFeedEventRecord {
    const scenario = this.getScenario(scenarioId);
    const baseEvent = scenario.events.find((item) => item.eventId === eventId)
      ?? this.buildHistoricalManualTestEvent(scenario, eventId);
    if (!baseEvent) {
      this.logger?.warn(
        { action: 'mockScenarioStore.getEvent.notFound', data: { scenarioId, eventId } },
        'Mock contest-feed event was not found',
      );
      throw new Error(`Event not found: ${scenarioId}/${eventId}`);
    }
    const event = applyMockEventState(scenario, baseEvent, mockEventState);
    this.logger?.debug(
      {
        action: 'mockScenarioStore.getEvent.success',
        data: { scenarioId, eventId, mockEventState: mockEventState ?? null, event: summarizeEvent(event, scenario.sport) },
      },
      'Loaded mock contest-feed event',
    );
    return event;
  }

  private buildHistoricalManualTestEvent(
    scenario: ContestFeedScenarioRecord,
    eventId: string,
  ): ContestFeedEventRecord | null {
    if (scenario.scenarioId !== 'golf-relative-today') {
      return null;
    }

    const startsAt = parseManualTestEventStartsAt(eventId);
    if (!startsAt) {
      return null;
    }

    const anchor = new Date(startsAt.getTime() - manualTestPhaseMs * 2);
    const event = normalizeGolfEvent(buildManualTestLifecycleEvent(anchor, this.currentNow()));
    this.logger?.info(
      {
        action: 'mockScenarioStore.getEvent.historicalManualTest',
        data: {
          scenarioId: scenario.scenarioId,
          eventId,
          startsAt: startsAt.toISOString(),
        },
      },
      'Reconstructed historical mock manual-test event',
    );
    return event;
  }

  public getEventResponse(
    scenarioId: string,
    eventId: string,
    mockEventState?: MockEventStateKind,
  ): ContestFeedEventResponse {
    const scenario = this.getScenario(scenarioId);
    const response: ContestFeedEventResponse = {
      scenarioId,
      sport: scenario.sport,
      provider: scenario.provider,
      scenarioDescription: scenario.description,
      season: scenario.season,
      event: this.getEvent(scenarioId, eventId, mockEventState),
    };
    this.logger?.info(
      {
        action: 'mockScenarioStore.getEventResponse',
        data: {
          scenarioId,
          eventId,
          mockEventState: mockEventState ?? null,
          manualLifecycle: summarizeManualLifecycle(response.event, this.currentNow()),
          participantCount: resolveContestantsForFeed(scenario.sport, response.event).length,
        },
      },
      'Built mock contest-feed event detail response',
    );
    this.logger?.debug(
      { action: 'mockScenarioStore.getEventResponse.payload', data: { response } },
      'Built mock contest-feed event detail response payload',
    );
    return response;
  }

  public getSnapshot(
    scenarioId: string,
    eventId: string,
    feedKind: FeedKind,
    mockEventState?: MockEventStateKind,
  ): ContestFeedSnapshotResponse {
    const scenario = this.getScenario(scenarioId);
    const event = this.getEvent(scenarioId, eventId, mockEventState);

    if (feedKind === 'field') {
      const contestants = resolveContestantsForFeed(scenario.sport, event);
      const fieldSnapshot = {
        scenarioId,
        eventId,
        eventName: event.name,
        feedKind,
        asOf: event.field.asOf,
        note: event.field.note,
        contestants,
      };
      this.logger?.info(
        {
          action: 'mockScenarioStore.getSnapshot.field',
          data: {
            scenarioId,
            eventId,
            mockEventState: mockEventState ?? null,
            manualLifecycle: summarizeManualLifecycle(event, this.currentNow()),
            contestantCount: fieldSnapshot.contestants.length,
          },
        },
        'Built mock field snapshot response',
      );
      this.logger?.debug(
        { action: 'mockScenarioStore.getSnapshot.field.payload', data: { snapshot: fieldSnapshot } },
        'Built mock field snapshot response payload',
      );
      return fieldSnapshot;
    }

    const feed = event.feeds[feedKind];
    const contestants = mergeContestants(
      resolveContestantsForFeed(scenario.sport, event),
      feed.contestants,
    );

    const snapshot = {
      scenarioId,
      eventId,
      eventName: event.name,
      feedKind,
      asOf: feed.asOf,
      note: feed.note,
      contestants,
    };
    this.logger?.info(
      {
        action: 'mockScenarioStore.getSnapshot.feed',
        data: {
          scenarioId,
          eventId,
          feedKind,
          mockEventState: mockEventState ?? null,
          manualLifecycle: summarizeManualLifecycle(event, this.currentNow()),
          contestantCount: contestants.length,
        },
      },
      'Built mock feed snapshot response',
    );
    this.logger?.debug(
      { action: 'mockScenarioStore.getSnapshot.feed.payload', data: { snapshot } },
      'Built mock feed snapshot response payload',
    );
    return snapshot;
  }

  public getUpdates(scenarioId: string, eventId: string): ContestFeedUpdateResponse {
    const scenario = this.getScenario(scenarioId);
    const event = this.getEvent(scenarioId, eventId);
    const baselineContestants = resolveContestantsForFeed(scenario.sport, event);
    const response: ContestFeedUpdateResponse = {
      scenarioId,
      eventId,
      eventName: event.name,
      updates: (event.updates ?? []).map((update) => ({
        ...update,
        contestants: mergeContestants(baselineContestants, update.contestants),
      })),
    };
    this.logger?.info(
      { action: 'mockScenarioStore.getUpdates', data: { scenarioId, eventId, updateCount: response.updates.length } },
      'Built mock contest-feed updates response',
    );
    if (response.updates.length === 0) {
      this.logger?.warn(
        { action: 'mockScenarioStore.getUpdates.empty', data: { scenarioId, eventId } },
        'Mock contest-feed event has no staged updates',
      );
    }
    this.logger?.debug(
      { action: 'mockScenarioStore.getUpdates.payload', data: { response } },
      'Built mock contest-feed updates response payload',
    );
    return response;
  }

  public getScenarioCount(): number {
    return this.getScenarios().length;
  }

  public getEventCount(): number {
    return this.getScenarios().reduce((total, scenario) => total + scenario.events.length, 0);
  }

  public getLiveScores(
    scenarioId: string,
    eventId: string,
    explicitTick?: number,
    mockEventState?: MockEventStateKind,
  ): LiveScoresSnapshotResponse {
    const scenario = this.getScenario(scenarioId);
    const event = this.getEvent(scenarioId, eventId, mockEventState);
    const tickKey = `${scenarioId}:${eventId}`;
    const now = this.currentNow();
    const manualLifecycle = summarizeManualLifecycle(event, now);
    const liveState = scenario.sport === 'GOLF' ? resolveGolfLiveState(event, mockEventState) : 'pre-live';
    const tick = explicitTick
      ?? (mockEventState === 'completed' || liveState === 'completed'
        ? 72
        : isManualTestLifecycleEvent(event)
          ? manualLiveScoreTick(event, now)
          : (this.liveScoreTicks.get(tickKey) ?? 0) + 1);
    if (explicitTick === undefined && !isManualTestLifecycleEvent(event) && liveState !== 'completed') {
      this.liveScoreTicks.set(tickKey, tick);
    }

    const asOf = isManualTestLifecycleEvent(event)
      ? now.toISOString()
      : liveState === 'completed'
        ? event.schedule.endsAt ?? new Date(Date.parse(event.schedule.startsAt) + tick * minuteMs).toISOString()
        : new Date(Date.parse(event.schedule.startsAt) + tick * minuteMs).toISOString();
    const contestants =
      scenario.sport === 'GOLF'
        ? buildLiveGolfContestants(scenario, event, liveState, asOf)
        : [];

    const response: LiveScoresSnapshotResponse = {
      scenarioId,
      eventId,
      eventName: event.name,
      feedKind: 'results',
      asOf,
      note: isManualTestLifecycleEvent(event)
        ? `Manual test lifecycle ${manualLifecycle?.phase ?? 'unknown'} tick ${tick}`
        : `Live scoring state ${liveState} tick ${tick}`,
      contestants,
    };
    this.logger?.info(
      {
        action: 'mockScenarioStore.getLiveScores',
        data: {
          scenarioId,
          eventId,
          tick,
          explicitTick: explicitTick ?? null,
          mockEventState: mockEventState ?? null,
          manualLifecycle,
          contestantCount: contestants.length,
        },
      },
      'Built mock live score response',
    );
    this.logger?.debug(
      { action: 'mockScenarioStore.getLiveScores.payload', data: { response } },
      'Built mock live score response payload',
    );
    return response;
  }
}

export function listSupportedFeedKinds(): readonly FeedKind[] {
  return feedKinds;
}

function isManualTestLifecycleEvent(event: ContestFeedEventRecord): boolean {
  return event.metadata?.eventType === manualTestEventType;
}

function summarizeManualTestEvent(
  events: readonly ContestFeedEventRecord[],
  now: Date,
): Record<string, unknown> | null {
  const event = events.find(isManualTestLifecycleEvent);
  if (!event) {
    return null;
  }

  return summarizeManualLifecycle(event, now);
}

function summarizeManualLifecycle(
  event: ContestFeedEventRecord,
  now: Date,
): Record<string, unknown> | null {
  if (!isManualTestLifecycleEvent(event)) {
    return null;
  }

  const fieldLocksAt = new Date(event.schedule.fieldLocksAt ?? event.schedule.startsAt);
  const startsAt = new Date(event.schedule.startsAt);
  const endsAt = new Date(event.schedule.endsAt ?? event.schedule.startsAt);

  return {
    phase: resolveManualLifecyclePhase({ now, fieldLocksAt, startsAt, endsAt }),
    eventId: event.eventId,
    eventName: event.name,
    startsAt: event.schedule.startsAt,
    fieldLocksAt: event.schedule.fieldLocksAt,
    endsAt: event.schedule.endsAt,
  };
}

function manualLiveScoreTick(event: ContestFeedEventRecord, now: Date): number {
  const startsAt = Date.parse(event.schedule.startsAt);
  if (!Number.isFinite(startsAt)) {
    return 1;
  }

  return Math.max(1, Math.floor((now.getTime() - startsAt) / minuteMs) + 1);
}
