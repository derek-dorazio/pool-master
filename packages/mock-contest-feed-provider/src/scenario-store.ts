import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  feedKinds,
  mockFeedProviderId,
  supportedSports,
  type ContestFeedEventRecord,
  type ContestantRecord,
  type ContestFeedScenarioRecord,
  type ContestFeedSnapshotResponse,
  type ContestFeedUpdateResponse,
  type EventSummary,
  type FeedKind,
  type ScenarioSummary,
} from './contracts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toStringValue(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid or missing ${field}`);
  }
  return value;
}

function toReadonlyArray<T>(value: unknown, field: string): readonly T[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid or missing ${field}`);
  }
  return value as readonly T[];
}

interface ContestantOverride {
  readonly contestantId: string;
  readonly name?: string;
  readonly teamName?: string;
  readonly seed?: number;
  readonly odds?: number;
  readonly ranking?: number;
  readonly score?: number;
  readonly result?: ContestantRecord['result'];
  readonly note?: string;
}

function validateScenario(record: unknown): ContestFeedScenarioRecord {
  if (!isRecord(record)) {
    throw new Error('Scenario file must contain an object');
  }

  const scenarioId = toStringValue(record.scenarioId, 'scenarioId');
  const sport = toStringValue(record.sport, 'sport');
  const provider = toStringValue(record.provider, 'provider');
  const description = typeof record.description === 'string' ? record.description : undefined;
  const events = toReadonlyArray<ContestFeedEventRecord>(record.events, 'events');

  if (provider !== mockFeedProviderId) {
    throw new Error(`Scenario ${scenarioId} must use provider ${mockFeedProviderId}`);
  }

  if (!supportedSports.includes(sport as (typeof supportedSports)[number])) {
    throw new Error(`Scenario ${scenarioId} has unsupported sport ${sport}`);
  }

  return {
    scenarioId,
    sport: sport as ContestFeedScenarioRecord['sport'],
    provider: mockFeedProviderId,
    description,
    events,
  };
}

function mergeContestants(
  contestants: readonly ContestantRecord[],
  overrides: readonly ContestantOverride[],
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
    map.set(override.contestantId, { ...current, ...override, contestantId: override.contestantId });
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
    return String(left.name ?? left.contestantId).localeCompare(String(right.name ?? right.contestantId));
  });
}

function loadJsonFile(filePath: string): ContestFeedScenarioRecord {
  const contents = readFileSync(filePath, 'utf8');
  return validateScenario(JSON.parse(contents) as unknown);
}

export class ScenarioStore {
  private readonly scenarios: readonly ContestFeedScenarioRecord[];

  public constructor(scenarioDir: string) {
    const entries = readdirSync(scenarioDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => loadJsonFile(join(scenarioDir, entry.name)));

    this.scenarios = entries.sort((left, right) => left.scenarioId.localeCompare(right.scenarioId));
  }

  public listScenarios(): readonly ScenarioSummary[] {
    return this.scenarios.map((scenario) => ({
      scenarioId: scenario.scenarioId,
      sport: scenario.sport,
      provider: scenario.provider,
      description: scenario.description,
      eventCount: scenario.events.length,
    }));
  }

  public getScenario(scenarioId: string): ContestFeedScenarioRecord {
    const scenario = this.scenarios.find((item) => item.scenarioId === scenarioId);
    if (!scenario) {
      throw new Error(`Scenario not found: ${scenarioId}`);
    }
    return scenario;
  }

  public listEvents(scenarioId: string): readonly EventSummary[] {
    const scenario = this.getScenario(scenarioId);
    return [...scenario.events]
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt) || left.eventId.localeCompare(right.eventId))
      .map((event) => ({
      eventId: event.eventId,
      name: event.name,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      venue: event.venue,
      contestantCount: event.contestants.length,
      }));
  }

  public getEvent(scenarioId: string, eventId: string): ContestFeedEventRecord {
    const scenario = this.getScenario(scenarioId);
    const event = scenario.events.find((item) => item.eventId === eventId);
    if (!event) {
      throw new Error(`Event not found: ${scenarioId}/${eventId}`);
    }
    return event;
  }

  public getSnapshot(
    scenarioId: string,
    eventId: string,
    feedKind: FeedKind,
  ): ContestFeedSnapshotResponse {
    const event = this.getEvent(scenarioId, eventId);
    const feed = event[feedKind];
    const contestants = mergeContestants(
      event.contestants,
      feed.contestants as readonly ContestantOverride[],
    );

    return {
      scenarioId,
      eventId,
      eventName: event.name,
      feedKind,
      asOf: feed.asOf,
      note: feed.note,
      contestants,
    };
  }

  public getUpdates(scenarioId: string, eventId: string): ContestFeedUpdateResponse {
    const event = this.getEvent(scenarioId, eventId);
    return {
      scenarioId,
      eventId,
      eventName: event.name,
      updates: (event.updates ?? []).map((update) => ({
        ...update,
        contestants: mergeContestants(
          event.contestants,
          update.contestants as readonly ContestantOverride[],
        ),
      })),
    };
  }

  public getScenarioCount(): number {
    return this.scenarios.length;
  }

  public getEventCount(): number {
    return this.scenarios.reduce((total, scenario) => total + scenario.events.length, 0);
  }
}

export function listSupportedFeedKinds(): readonly FeedKind[] {
  return feedKinds;
}
