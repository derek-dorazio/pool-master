/**
 * Loads golf-2026.json into a running PoolMaster through its admin API, so a league and its
 * contests can be tested by hand without setting up each tournament first.
 *
 * Seed data is test data, so it stays out of migrations (reference data only goes there).
 * It goes in through the same root-admin endpoints the Manage screens use, so every rule they
 * apply applies here too and nothing writes the database behind the service's back.
 *
 * Each tournament lands released for contests, with its field, rankings, odds, seeds, tiers,
 * prices and four rounds of stored scores. Its dates are the 2026 dates moved forward by whole
 * weeks so the first tournament starts at least a week after the run: a contest can only be
 * created before tee-off. Moving a tournament to In Progress and then Completed settles its
 * contests from the stored scores.
 *
 * Safe to run again: a tour, player or tournament that already exists is reused or skipped,
 * never changed. A tournament the seed stopped part-way through is left a draft and reported.
 */

import type { Client } from '@poolmaster/shared/generated/hey-api/client';
import {
  addEventParticipants,
  applyEventGolfRoundScores,
  applyParticipantLeagueAffiliationUpload,
  autoAssignEventPrices,
  autoAssignEventTiers,
  createEvent,
  createParticipant,
  createSportLeague,
  listEventParticipants,
  listEvents,
  listParticipants,
  listSportLeagues,
  listSports,
  releaseEvent,
  updateEvent,
  updateEventParticipants,
} from '@poolmaster/shared/generated/hey-api';
import {
  golferRoundScore,
  shiftedEventDates,
  seedDateOffsetDays,
  type GolfSeedEvent,
  type GolfSeedFile,
  type GolfSeedGolfer,
  type GolfSeedPlayer,
} from './seed-golf-data';

export type { GolfSeedFile } from './seed-golf-data';

export interface GolfSeedSummary {
  tour: string;
  created: string[];
  skipped: Array<{ name: string; status: string }>;
}

export interface SeedGolfOptions {
  /** A root-admin client. Called before each tournament, so a long run can sign in again. */
  getClient: () => Promise<Client>;
  now: Date;
  log?: (line: string) => void;
}

const PRICE_RANGE = { minPrice: 1000, maxPrice: 10000 };

interface SdkResult<T> {
  data?: T;
  error?: unknown;
  response?: Response;
}

async function must<T>(call: Promise<SdkResult<T>>, what: string): Promise<T> {
  const result = await call;
  if (result.data === undefined || result.error !== undefined) {
    throw new Error(`${what} failed (HTTP ${result.response?.status ?? 'none'}): ${JSON.stringify(result.error)}`);
  }
  return result.data;
}

function splitName(name: string): { firstName: string; lastName: string } {
  const space = name.indexOf(' ');
  return space < 0 ? { firstName: name, lastName: name } : { firstName: name.slice(0, space), lastName: name.slice(space + 1) };
}

async function ensureTour(client: Client, name: string): Promise<string> {
  const { sportLeagues } = await must(listSportLeagues({ client, query: { sport: 'GOLF' } }), 'List tours');
  const existing = sportLeagues.find((league) => league.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;
  const created = await must(createSportLeague({ client, body: { sport: 'GOLF', name, matchKeyword: name } }), `Create tour ${name}`);
  return created.sportLeague.id;
}

/** Each seed player's participant id: found by externalId, then exact name, else created. */
async function ensurePlayers(client: Client, sportId: string, players: readonly GolfSeedPlayer[]): Promise<Map<string, string>> {
  const { participants } = await must(listParticipants({ client, query: { sportId } }), 'List golfers');
  const byExternalId = new Map(participants.filter((p) => p.externalId).map((p) => [p.externalId!, p.id]));
  const byName = new Map(participants.map((p) => [p.name.toLowerCase(), p.id]));
  const ids = new Map<string, string>();
  for (const player of players) {
    let id = byExternalId.get(player.key) ?? byName.get(player.name.toLowerCase());
    if (!id) {
      const created = await must(createParticipant({
        client,
        body: { sportId, participantType: 'INDIVIDUAL', name: player.name, externalId: player.key, nationality: player.countryCode, ...splitName(player.name) },
      }), `Create golfer ${player.name}`);
      id = created.participant.id;
    }
    ids.set(player.key, id);
  }
  return ids;
}

async function seedEvent(client: Client, input: {
  sportLeagueId: string;
  season: number;
  event: GolfSeedEvent;
  offsetDays: number;
  participantIds: Map<string, string>;
}): Promise<void> {
  const { event, participantIds } = input;
  const created = await must(createEvent({
    client,
    body: {
      sportLeagueId: input.sportLeagueId,
      eventYear: input.season,
      name: event.name,
      ...(event.venue ? { venue: event.venue } : {}),
      ...(event.location ? { location: event.location } : {}),
      ...shiftedEventDates(event, input.offsetDays),
      rounds: event.rounds,
      autoLifecycleEnabled: false,
    },
  }), `Create ${event.name}`);
  const eventId = created.event.id;
  const path = { eventId };

  await must(updateEvent({ client, path, body: { roundsPar: event.roundsPar } }), `Set par for ${event.name}`);
  const idOf = (golfer: GolfSeedGolfer) => {
    const id = participantIds.get(golfer.player);
    if (!id) throw new Error(`${event.name}: ${golfer.player} is not in the tour's player list`);
    return id;
  };
  await must(addEventParticipants({ client, path, body: { participantIds: event.field.map(idOf) } }), `Add the field to ${event.name}`);
  const { participants: fieldRows } = await must(listEventParticipants({ client, path }), `Read the field of ${event.name}`);
  const rowByParticipant = new Map(fieldRows.map((row) => [row.participantId, row.id]));
  await must(updateEventParticipants({
    client,
    path,
    body: {
      participants: event.field.map((golfer, index) => ({
        sportEventParticipantId: rowByParticipant.get(idOf(golfer))!,
        ranking: golfer.ranking,
        oddsToWin: golfer.oddsToWin,
        seedNumber: index + 1,
      })),
    },
  }), `Set rankings and odds for ${event.name}`);
  await must(autoAssignEventTiers({ client, path, body: { source: 'ODDS' } }), `Assign tiers for ${event.name}`);
  await must(autoAssignEventPrices({ client, path, body: PRICE_RANGE }), `Assign prices for ${event.name}`);

  for (let roundNumber = 1; roundNumber <= event.rounds; roundNumber += 1) {
    const rows = event.field.flatMap((golfer) => {
      const score = golferRoundScore(golfer, roundNumber, event.roundsPar);
      return score ? [{ participantId: idOf(golfer), ...score }] : [];
    });
    if (rows.length > 0) {
      await must(applyEventGolfRoundScores({ client, path: { eventId, roundNumber }, body: { rows } }), `Store round ${roundNumber} of ${event.name}`);
    }
  }
  await must(releaseEvent({ client, path }), `Release ${event.name}`);
}

export async function seedGolf(seed: GolfSeedFile, options: SeedGolfOptions): Promise<GolfSeedSummary[]> {
  const log = options.log ?? (() => {});
  const offsetDays = seedDateOffsetDays(seed, options.now);
  log(`Moving ${seed.season} dates forward ${offsetDays} days.`);

  const setupClient = await options.getClient();
  const { sports } = await must(listSports({ client: setupClient }), 'List sports');
  const golf = sports.find((sport) => sport.name === 'GOLF');
  if (!golf) throw new Error('No GOLF sport row; the reference-data migration has not run.');

  const summaries: GolfSeedSummary[] = [];
  for (const tour of seed.tours) {
    const summary: GolfSeedSummary = { tour: tour.name, created: [], skipped: [] };
    summaries.push(summary);
    const tourClient = await options.getClient();
    const sportLeagueId = await ensureTour(tourClient, tour.name);
    const participantIds = await ensurePlayers(tourClient, golf.id, tour.players);
    await must(applyParticipantLeagueAffiliationUpload({
      client: tourClient,
      path: { sportLeagueId },
      body: { rows: tour.players.map((player) => ({ participantId: participantIds.get(player.key)!, ranking: player.ranking })) },
    }), `Set ${tour.name} rankings`);
    log(`${tour.name}: ${tour.players.length} golfers ready.`);

    const { events: existing } = await must(listEvents({ client: tourClient, query: { sportLeagueId, eventYear: seed.season } }), `List ${tour.name} tournaments`);
    const existingByName = new Map(existing.map((event) => [event.name.toLowerCase(), event.status]));
    for (const event of tour.events) {
      const status = existingByName.get(event.name.toLowerCase());
      if (status) {
        summary.skipped.push({ name: event.name, status });
        log(`${tour.name}: skipped ${event.name}, which already exists (${status}).`);
        continue;
      }
      await seedEvent(await options.getClient(), { sportLeagueId, season: seed.season, event, offsetDays, participantIds });
      summary.created.push(event.name);
      log(`${tour.name}: seeded ${event.name} (${event.field.length} golfers).`);
    }
  }
  return summaries;
}
