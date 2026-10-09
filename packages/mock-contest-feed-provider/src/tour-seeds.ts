import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  mockFeedProviderId,
  type ContestFeedEventRecord,
  type ContestFeedScenarioRecord,
} from './contracts';
import type { GolfPoolPlayerRecord } from './golf-player-pool';

/**
 * #383 — hand-maintained golf tour seeds: one ranked player list per tour
 * (`<tourId>-players.json`) and one event slate per tour and season (`<tourId>-<season>.json`),
 * in `contest-feed-scenarios/tours/`. Each slate becomes a scenario whose id is
 * `<tourId>-<season>`, so a tour's season is listed in one call. Every event's field is the
 * tour's whole player list. Nothing here reads today's date: event status is always
 * `scheduled`, and scores only move once a live replay is started.
 */
export const tourSeedDirName = 'tours';

interface TourSeedPlayer {
  readonly playerId: string;
  readonly name: string;
  readonly countryCode?: string;
  /** Order only. Players files also flag `rankingEstimated` for humans; the mock ignores it. */
  readonly ranking: number;
}

interface TourSeedEvent {
  readonly eventId: string;
  readonly name: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly rounds: number;
  readonly venue?: {
    readonly name?: string;
    readonly city?: string;
    readonly region?: string;
    readonly countryCode?: string;
    readonly timeZone?: string;
  };
  readonly purse?: number;
  readonly eventType?: string;
  readonly notes?: readonly string[];
}

interface TourSeasonFile {
  readonly tour: string;
  readonly tourId: string;
  readonly season: number;
  readonly published: string;
  readonly notes?: string;
  readonly events: readonly TourSeedEvent[];
}

interface TourPlayersFile {
  readonly tour: string;
  readonly tourId: string;
  readonly players: readonly TourSeedPlayer[];
}

export interface TourSeedScenario {
  readonly scenario: ContestFeedScenarioRecord;
  readonly pool: readonly GolfPoolPlayerRecord[];
}

const dayMs = 24 * 60 * 60 * 1000;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function atUtc(day: string, hour: number): Date {
  return new Date(`${day}T${String(hour).padStart(2, '0')}:00:00.000Z`);
}

function toPool(file: TourPlayersFile, source: string): readonly GolfPoolPlayerRecord[] {
  const ids = new Set<string>();
  return file.players.map((player) => {
    if (!player.playerId || !player.name || !Number.isInteger(player.ranking) || player.ranking < 1) {
      throw new Error(`${source}: every player needs a playerId, a name and a positive whole ranking`);
    }
    if (ids.has(player.playerId)) {
      throw new Error(`${source}: duplicate playerId ${player.playerId}`);
    }
    ids.add(player.playerId);
    return { contestantId: player.playerId, name: player.name, countryCode: player.countryCode, ranking: player.ranking };
  });
}

function toEvent(tour: string, event: TourSeedEvent, source: string): ContestFeedEventRecord {
  if (!isoDatePattern.test(event.startDate) || !isoDatePattern.test(event.endDate) || event.endDate < event.startDate) {
    throw new Error(`${source}: event ${event.eventId} needs startDate <= endDate as YYYY-MM-DD`);
  }
  const startsAt = atUtc(event.startDate, 12);
  const releaseAt = new Date(startsAt.getTime() - 7 * dayMs);
  const notes = [...(event.notes ?? []), `${event.rounds} rounds.`];

  return {
    eventId: event.eventId,
    name: event.name,
    status: 'scheduled',
    schedule: {
      startsAt: startsAt.toISOString(),
      endsAt: atUtc(event.endDate, 23).toISOString(),
      releaseAt: releaseAt.toISOString(),
      fieldLocksAt: new Date(startsAt.getTime() - dayMs).toISOString(),
    },
    venue: event.venue?.name
      ? {
        name: event.venue.name,
        city: event.venue.city,
        region: event.venue.region,
        countryCode: event.venue.countryCode,
        timeZone: event.venue.timeZone,
      }
      : undefined,
    metadata: {
      officialName: event.name,
      eventType: event.eventType ?? 'stroke_play',
      tour,
      externalEventId: event.eventId,
      notes,
    },
    field: { asOf: releaseAt.toISOString(), status: 'announced', contestants: [] },
    feeds: {
      odds: { asOf: releaseAt.toISOString(), contestants: [] },
      results: { asOf: releaseAt.toISOString(), contestants: [] },
    },
    updates: [],
  };
}

/** Loads every tour season under `<scenarioDir>/tours`; returns none when the folder is absent. */
export function loadTourSeedScenarios(scenarioDir: string): readonly TourSeedScenario[] {
  const tourDir = join(scenarioDir, tourSeedDirName);
  if (!existsSync(tourDir)) {
    return [];
  }

  const files = readdirSync(tourDir).filter((name) => name.endsWith('.json')).sort();
  const pools = new Map<string, readonly GolfPoolPlayerRecord[]>();
  for (const name of files.filter((file) => file.endsWith('-players.json'))) {
    const file = readJson(join(tourDir, name)) as TourPlayersFile;
    pools.set(file.tourId, toPool(file, name));
  }

  return files
    .filter((name) => !name.endsWith('-players.json'))
    .map((name) => {
      const file = readJson(join(tourDir, name)) as TourSeasonFile;
      const pool = pools.get(file.tourId);
      if (!pool) {
        throw new Error(`${name}: no ${file.tourId}-players.json for tour ${file.tourId}`);
      }
      const eventIds = new Set<string>();
      const events = file.events.map((event) => {
        if (eventIds.has(event.eventId)) {
          throw new Error(`${name}: duplicate eventId ${event.eventId}`);
        }
        eventIds.add(event.eventId);
        return toEvent(file.tour, event, name);
      });
      const scenario: ContestFeedScenarioRecord = {
        scenarioId: `${file.tourId}-${file.season}`,
        sport: 'GOLF',
        provider: mockFeedProviderId,
        description: `${file.tour} ${file.season} schedule (${file.published}).${file.notes ? ` ${file.notes}` : ''}`,
        season: { seasonId: `${file.tourId}-${file.season}`, name: `${file.tour} ${file.season}`, year: file.season },
        events,
      };
      return { scenario, pool };
    });
}
