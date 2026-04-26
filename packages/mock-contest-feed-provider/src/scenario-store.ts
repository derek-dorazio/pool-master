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
      status: normalizeGolfFieldStatus(event.status),
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
        contestants: buildGolfResultFeed(event, fieldContestants, oddsContestants),
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

function buildLiveGolfScores(
  scenario: ContestFeedScenarioRecord,
  event: ContestFeedEventRecord,
  tick: number,
): readonly ContestantRecord[] {
  const contestants = resolveContestantsForFeed(scenario.sport, event);
  const oddsValues = contestants
    .map((contestant) => contestant.odds)
    .filter((odds): odds is number => typeof odds === 'number');

  const minOdds = oddsValues.length > 0 ? Math.min(...oddsValues) : 1.01;
  const maxOdds = oddsValues.length > 0 ? Math.max(...oddsValues) : 100;
  const eventSeed = event.metadata?.externalEventId ?? event.eventId;

  return contestants
    .map((contestant) => ({
      ...contestant,
      score: scoreRelativeToPar({
        eventSeed,
        tick,
        participantId: contestant.contestantId,
        decimalOdds: contestant.odds ?? maxOdds,
        minOdds,
        maxOdds,
      }),
      result: 'pending' as const,
    }))
    .sort((left, right) => {
      const leftScore = typeof left.score === 'number' ? left.score : Number.POSITIVE_INFINITY;
      const rightScore = typeof right.score === 'number' ? right.score : Number.POSITIVE_INFINITY;
      if (leftScore !== rightScore) {
        return leftScore - rightScore;
      }

      return left.name.localeCompare(right.name);
    });
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
  const terminalTick = event.status === 'in_progress' ? 12 : 72;
  const eventSeed = event.metadata?.externalEventId ?? event.eventId;

  const scored = fieldContestants
    .map((contestant) => ({
      contestantId: contestant.contestantId,
      score: scoreRelativeToPar({
        eventSeed,
        tick: terminalTick,
        participantId: contestant.contestantId,
        decimalOdds: oddsByContestantId.get(contestant.contestantId) ?? maxOdds,
        minOdds,
        maxOdds,
      }),
    }))
    .sort((left, right) => left.score - right.score || left.contestantId.localeCompare(right.contestantId));

  return scored.map((contestant, index) => ({
    contestantId: contestant.contestantId,
    score: contestant.score,
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

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

function addHours(base: Date, hours: number): Date {
  return new Date(base.getTime() + hours * 60 * 60 * 1000);
}

function startOfUtcDay(base: Date): Date {
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
}

function atUtcDayOffset(base: Date, days: number, hour: number): Date {
  return addHours(addDays(startOfUtcDay(base), days), hour);
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
  releaseAt: Date;
  fieldLocksAt: Date;
  notes: readonly string[];
}): ContestFeedEventRecord {
  const endsAt = addDays(input.startsAt, 4);
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
      eventType: 'relative-qa',
      tour: 'PoolMaster QA',
      externalEventId: input.eventId,
      notes: input.notes,
    },
    field: {
      asOf: fieldAsOf,
      status: input.status === 'in_progress' ? 'locked' : 'announced',
      note: input.notes[0],
      contestants: [],
    },
    feeds: emptyFeeds(fieldAsOf),
    updates: [],
  };
}

export function buildRelativeTodayGolfScenario(now = new Date()): ContestFeedScenarioRecord {
  const relativeEvents = [
    buildRelativeGolfEvent({
      eventId: 'golf-relative-live-now',
      name: 'Relative QA Live Score Open',
      status: 'in_progress',
      startsAt: addHours(now, 0.5),
      releaseAt: addDays(now, -8),
      fieldLocksAt: addHours(now, -1),
      notes: ['Relative event that keeps the live-score workflow active today.'],
    }),
    buildRelativeGolfEvent({
      eventId: 'golf-relative-locked-tomorrow',
      name: 'Relative QA Locked Tomorrow Invitational',
      status: 'field_announced',
      startsAt: atUtcDayOffset(now, 1, 12),
      releaseAt: atUtcDayOffset(now, -6, 16),
      fieldLocksAt: addHours(now, -1),
      notes: ['Relative event that starts tomorrow with the field already locked.'],
    }),
    buildRelativeGolfEvent({
      eventId: 'golf-relative-ready-5d',
      name: 'Relative QA Contest Ready Classic',
      status: 'field_announced',
      startsAt: atUtcDayOffset(now, 5, 12),
      releaseAt: atUtcDayOffset(now, -1, 16),
      fieldLocksAt: atUtcDayOffset(now, 4, 16),
      notes: ['Relative event inside the participant lead window with participants available.'],
    }),
    buildRelativeGolfEvent({
      eventId: 'golf-relative-field-pending-6d',
      name: 'Relative QA Field Pending Open',
      status: 'scheduled',
      startsAt: atUtcDayOffset(now, 6, 12),
      releaseAt: atUtcDayOffset(now, 2, 16),
      fieldLocksAt: atUtcDayOffset(now, 5, 16),
      notes: ['Relative event inside seven days but not released yet for field-availability testing.'],
    }),
    buildRelativeGolfEvent({
      eventId: 'golf-relative-participant-boundary-7d',
      name: 'Relative QA Participant Boundary Championship',
      status: 'field_announced',
      startsAt: atUtcDayOffset(now, 7, 12),
      releaseAt: atUtcDayOffset(now, -1, 16),
      fieldLocksAt: atUtcDayOffset(now, 6, 16),
      notes: ['Relative event at the seven-day participant lead boundary.'],
    }),
    buildRelativeGolfEvent({
      eventId: 'golf-relative-schedule-boundary-30d',
      name: 'Relative QA Schedule Boundary Cup',
      status: 'scheduled',
      startsAt: atUtcDayOffset(now, 30, 11),
      releaseAt: atUtcDayOffset(now, 22, 16),
      fieldLocksAt: atUtcDayOffset(now, 29, 16),
      notes: ['Relative event at the thirty-day schedule lookahead boundary.'],
    }),
  ];

  return normalizeScenario({
    scenarioId: 'golf-relative-today',
    sport: 'GOLF',
    provider: mockFeedProviderId,
    description: 'Generated rolling golf lifecycle events anchored to the current UTC day for QA sync testing.',
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

export class ScenarioStore {
  private readonly scenarios: readonly ContestFeedScenarioRecord[];
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
        : [buildRelativeTodayGolfScenario(options.now?.() ?? new Date())];
    const allScenarios = [...entries, ...generatedScenarios];

    ensureUniqueIds(
      allScenarios.map((scenario) => scenario.scenarioId),
      'scenarioId',
    );

    this.scenarios = allScenarios.sort((left, right) => left.scenarioId.localeCompare(right.scenarioId));
    this.logger?.info(
      {
        action: 'mockScenarioStore.load.success',
        data: {
          scenarioDir,
          staticScenarioCount: entries.length,
          generatedScenarioCount: generatedScenarios.length,
          scenarioCount: this.scenarios.length,
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
          scenarios: this.scenarios.map((scenario) => summarizeScenario(scenario)),
        },
      },
      'Loaded mock contest-feed scenario payload',
    );
  }

  public listScenarios(): readonly ScenarioSummary[] {
    const scenarios = this.scenarios.map((scenario) => ({
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
    const scenario = this.scenarios.find((item) => item.scenarioId === scenarioId);
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
      { action: 'mockScenarioStore.listEvents', data: { scenarioId, eventCount: events.length } },
      'Listed mock contest-feed scenario events',
    );
    this.logger?.debug(
      { action: 'mockScenarioStore.listEvents.payload', data: { scenarioId, events } },
      'Listed mock contest-feed scenario event payload',
    );
    return events;
  }

  public getEvent(scenarioId: string, eventId: string): ContestFeedEventRecord {
    const scenario = this.getScenario(scenarioId);
    const event = scenario.events.find((item) => item.eventId === eventId);
    if (!event) {
      this.logger?.warn(
        { action: 'mockScenarioStore.getEvent.notFound', data: { scenarioId, eventId } },
        'Mock contest-feed event was not found',
      );
      throw new Error(`Event not found: ${scenarioId}/${eventId}`);
    }
    this.logger?.debug(
      {
        action: 'mockScenarioStore.getEvent.success',
        data: { scenarioId, eventId, event: summarizeEvent(event, scenario.sport) },
      },
      'Loaded mock contest-feed event',
    );
    return event;
  }

  public getEventResponse(scenarioId: string, eventId: string): ContestFeedEventResponse {
    const scenario = this.getScenario(scenarioId);
    const response: ContestFeedEventResponse = {
      scenarioId,
      sport: scenario.sport,
      provider: scenario.provider,
      scenarioDescription: scenario.description,
      season: scenario.season,
      event: this.getEvent(scenarioId, eventId),
    };
    this.logger?.info(
      {
        action: 'mockScenarioStore.getEventResponse',
        data: {
          scenarioId,
          eventId,
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

  public getSnapshot(scenarioId: string, eventId: string, feedKind: FeedKind): ContestFeedSnapshotResponse {
    const scenario = this.getScenario(scenarioId);
    const event = this.getEvent(scenarioId, eventId);

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
        { action: 'mockScenarioStore.getSnapshot.field', data: { scenarioId, eventId, contestantCount: fieldSnapshot.contestants.length } },
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
      { action: 'mockScenarioStore.getSnapshot.feed', data: { scenarioId, eventId, feedKind, contestantCount: contestants.length } },
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
    return this.scenarios.length;
  }

  public getEventCount(): number {
    return this.scenarios.reduce((total, scenario) => total + scenario.events.length, 0);
  }

  public getLiveScores(
    scenarioId: string,
    eventId: string,
    explicitTick?: number,
  ): ContestFeedSnapshotResponse {
    const scenario = this.getScenario(scenarioId);
    const event = this.getEvent(scenarioId, eventId);
    const tickKey = `${scenarioId}:${eventId}`;
    const tick = explicitTick ?? ((this.liveScoreTicks.get(tickKey) ?? 0) + 1);
    if (explicitTick === undefined) {
      this.liveScoreTicks.set(tickKey, tick);
    }

    const contestants =
      scenario.sport === 'GOLF'
        ? buildLiveGolfScores(scenario, event, tick)
        : mergeContestants(
          resolveContestantsForFeed(scenario.sport, event),
          event.feeds.results.contestants,
        );

    const response: ContestFeedSnapshotResponse = {
      scenarioId,
      eventId,
      eventName: event.name,
      feedKind: 'results',
      asOf: new Date(Date.parse(event.schedule.startsAt) + tick * 60 * 1000).toISOString(),
      note: `Live scoring tick ${tick}`,
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
