/**
 * #1315 — the contest service's leaderboard reads for a fan-out over many contests, batched.
 *
 * Every leaderboard reads per contest: the contest, its events, its rules, its entries, their
 * picks, its frozen standings and each event's field. Built side by side under `Promise.all`, the
 * boards ask for those in step, so each read here collects the asks made together and answers
 * them from one read of the same port (`BatchedRead`). A cup's projection builds every live
 * contest's board this way: the same leaderboard code, in the same statements for 2 contests as
 * for 20.
 *
 * Every read answers exactly what the port's own read would. Build the deps for one fan-out and
 * let them go with it: they remember nothing between batches.
 */
import { ContestEntryStatus, contestEntryEventStatus } from '@poolmaster/shared/domain';
import { BatchedRead, batchedByKey } from '../../core/batched-read';
import type { ContestServiceDeps } from './service';

/** `target` with `reads` in place of its own methods of those names, and every other method its own. */
function withReads<Port extends object>(target: Port, reads: Partial<Port>): Port {
  return Object.assign(Object.create(target) as Port, reads);
}

/** A batched read of rows by a list of ids each: one read of every id asked for, each asker given its own ids' rows in its order. */
function batchedByIds<Row>(readMany: (ids: readonly string[]) => Promise<readonly Row[]>, idOf: (row: Row) => string): BatchedRead<readonly string[], Row[]> {
  return new BatchedRead(async (asks) => {
    const byId = new Map<string, Row>((await readMany([...new Set(asks.flat())])).map((row) => [idOf(row), row]));
    return asks.map((ids) => [...new Set(ids)].map((id) => byId.get(id)).filter((row): row is Row => row !== undefined));
  });
}

/**
 * A batched read of rows by entry and event: one read across every entry and event asked for,
 * each asker given the rows of its own entries in its own events, in the read's order.
 */
function batchedByEntriesAndEvents<Row>(
  readMany: (entryIds: readonly string[], sportEventIds: readonly string[]) => Promise<readonly Row[]>,
  keysOf: (row: Row) => { entryId: string; sportEventId: string },
): BatchedRead<{ entryIds: readonly string[]; sportEventIds: readonly string[] }, Row[]> {
  return new BatchedRead(async (asks) => {
    const rows = await readMany(
      [...new Set(asks.flatMap((ask) => ask.entryIds))],
      [...new Set(asks.flatMap((ask) => ask.sportEventIds))],
    );
    return asks.map((ask) => {
      const entryIds = new Set(ask.entryIds);
      const sportEventIds = new Set(ask.sportEventIds);
      return rows.filter((row) => {
        const { entryId, sportEventId } = keysOf(row);
        return entryIds.has(entryId) && sportEventIds.has(sportEventId);
      });
    });
  });
}

/** `deps` with every per-contest leaderboard read batched across the contests read together. */
export function batchedLeaderboardDeps(deps: ContestServiceDeps): ContestServiceDeps {
  const contests = batchedByIds((ids) => deps.contests.findByIds(ids), (contest) => contest.id);
  const configurations = batchedByIds((contestIds) => deps.configurations.findByContests(contestIds), (configuration) => configuration.contestId);
  const scoringRules = batchedByKey((ids) => deps.scoringRules.findByContestConfigurations(ids), (rule) => rule.contestConfigurationId);
  const eventStandings = batchedByKey((contestIds) => deps.eventStandings.findByContests(contestIds), (standing) => standing.contestId);
  const entries = batchedByKey((contestIds) => deps.entries.findByContestsWithSquad(contestIds), (entry) => entry.contestId);
  const picks = batchedByEntriesAndEvents((entryIds, sportEventIds) => deps.picks.findByEntriesAndEvents(entryIds, sportEventIds), (pick) => pick);
  const sportEvents = batchedByIds((ids) => deps.sportEvents.findByIds(ids), (event) => event.id);
  const matches = batchedByKey((sportEventIds) => deps.matches.findBySportEvents(sportEventIds), (match) => match.sportEventId);
  const predictions = batchedByEntriesAndEvents(
    (entryIds, sportEventIds) => deps.predictions.findByEntriesAndEvents(entryIds, sportEventIds),
    (prediction) => ({ entryId: prediction.contestEntryId, sportEventId: prediction.sportEventId }),
  );
  const participants = batchedByIds((ids) => deps.participants.findByIds(ids), (participant) => participant.id);
  return {
    ...deps,
    contests: withReads(deps.contests, { findById: async (id) => (await contests.load([id])).at(0) ?? null }),
    configurations: withReads(deps.configurations, { findByContest: async (contestId) => (await configurations.load([contestId])).at(0) ?? null }),
    scoringRules: withReads(deps.scoringRules, { findByContestConfiguration: (id) => scoringRules.load(id) }),
    eventStandings: withReads(deps.eventStandings, { findByContest: (contestId) => eventStandings.load(contestId) }),
    entries: withReads(deps.entries, {
      findByContestWithSquad: async (contestId, options) => {
        const contestEntries = await entries.load(contestId);
        const { submittedFor } = options ?? {};
        return submittedFor === undefined
          ? contestEntries
          : contestEntries.filter((entry) => contestEntryEventStatus(entry, submittedFor) === ContestEntryStatus.SUBMITTED);
      },
    }),
    picks: withReads(deps.picks, { findByEntriesAndEvents: (entryIds, sportEventIds) => picks.load({ entryIds, sportEventIds }) }),
    sportEvents: withReads(deps.sportEvents, { findByIds: (ids) => sportEvents.load(ids) }),
    matches: {
      findBySportEvent: (sportEventId) => matches.load(sportEventId),
      // By event, as the port's read orders them.
      findBySportEvents: async (sportEventIds) => (await Promise.all([...new Set(sportEventIds)].sort().map((sportEventId) => matches.load(sportEventId)))).flat(),
    },
    predictions: {
      findByEntriesAndEvent: (entryIds, sportEventId) => predictions.load({ entryIds, sportEventIds: [sportEventId] }),
      findByEntriesAndEvents: (entryIds, sportEventIds) => predictions.load({ entryIds, sportEventIds }),
    },
    participants: { findByIds: (ids) => participants.load(ids) },
    eventParticipants: deps.eventParticipants.batchedFieldReads(),
  };
}
