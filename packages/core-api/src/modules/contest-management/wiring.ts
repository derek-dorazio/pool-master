/**
 * The one construction of ContestManagementService. Contest creation lives on the contests
 * module's `createContest` route (#245) and the configuration reads and writes on this module's,
 * so both build the service here rather than each wiring its dependencies.
 */
import type { ContestOpenedNotice } from '../notifications/contest-notices';
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type {
  SportEventMatchRepository,
  SportEventParticipantRepository,
  SportEventParticipantValuationRepository,
  SportEventRepository,
  SportRepository,
} from '@poolmaster/shared/db';
import { MatchStatus, eventSportDefinition, getDefaultTournamentFormatForSport, isSquaresRound } from '@poolmaster/shared/domain';
import {
  PrismaContestConfigTemplateRepository,
  PrismaContestConfigurationRepository,
  PrismaContestRepository,
  PrismaParticipantContestScoringRuleRepository,
  PrismaSportEventMatchRepository,
  PrismaSportEventParticipantRepository,
  PrismaSportEventParticipantValuationRepository,
  PrismaSportEventRepository,
  PrismaSportRepository,
} from '../../adapters';
import { createSportEventTierService } from '../events/wiring';
import { createCupService } from '../cups/wiring';
import type { PlanEntitlementsService } from '../plans/plan-entitlements-service';
import { contestBracketGames, findBracketProblem } from '../scoring-families/head-to-head/bracket-picks';
import { ContestCutoffKind, cutoffTiming } from '../contests/entry-window';
import { knockoutSeeds } from '../scoring-families/head-to-head/score-team';
import { hasSportEventStarted } from '../events/operational-timing';
import { BatchedRead, batchedByIds, batchedByKey, withReads } from '../../core/batched-read';
import type { ContestOpeningReader } from './contest-opening';
import { ContestManagementService, type ContestCreateSportEventReader } from './service';

export function createContestManagementService(
  prisma: PrismaClient,
  logger: FastifyBaseLogger,
  planEntitlements: PlanEntitlementsService,
  /** Who is told a contest has opened (#845); without it, nobody is. */
  contestOpened?: ContestOpenedNotice,
): ContestManagementService {
  const sportEventTierService = createSportEventTierService(prisma, logger);
  return new ContestManagementService({
    contests: new PrismaContestRepository(prisma),
    configTemplates: new PrismaContestConfigTemplateRepository(prisma),
    configurations: new PrismaContestConfigurationRepository(prisma),
    scoringRules: new PrismaParticipantContestScoringRuleRepository(prisma),
    tiers: sportEventTierService,
    logger,
    sportEventReader: createContestSportEventReader({
      sportEvents: new PrismaSportEventRepository(prisma),
      sports: new PrismaSportRepository(prisma),
      field: new PrismaSportEventParticipantRepository(prisma),
      valuations: new PrismaSportEventParticipantValuationRepository(prisma),
      matches: new PrismaSportEventMatchRepository(prisma),
    }),
    cups: createCupService(prisma, logger, planEntitlements),
    planEntitlements,
    contestOpened,
  });
}

/**
 * What contest creation and opening need to know about the event: its status and start time,
 * its release and field-lock timing, its sport league (for a league's own template), its sport's tournament format, how much of its field has
 * loaded, and for budget rules its salary cap and its active golfers' prices (#93). Composed
 * from the slice-2 ports (#247) — it was a raw Prisma read inlined here.
 */
export function createContestSportEventReader({ sportEvents, sports, field, valuations, matches }: {
  sportEvents: SportEventRepository;
  sports: SportRepository;
  field: SportEventParticipantRepository;
  valuations: SportEventParticipantValuationRepository;
  matches: SportEventMatchRepository;
}): ContestCreateSportEventReader {
  return {
    findById: async (sportEventId) => {
      const event = await sportEvents.findById(sportEventId);
      if (!event) {
        return null;
      }
      const [sport, loaded] = await Promise.all([
        sports.findBySport(event.sport),
        sportEvents.countParticipants([sportEventId]),
      ]);
      return {
        id: event.id,
        status: event.status,
        startDate: event.startDate,
        sport: event.sport,
        sportLeagueId: event.sportLeagueId,
        eventYear: event.eventYear,
        // A sport league scored by its own family plays its own format (#934: a stat pool plays
        // golf's, not its team sport's matches); any other plays its sport's.
        tournamentFormat: (event.scoringFamily ?? null) === null
          ? sport?.tournamentFormat ?? getDefaultTournamentFormatForSport(event.sport)
          : eventSportDefinition(event).tournamentFormat,
        participantCount: event.participantCount ?? null,
        loadedParticipantCount: loaded.get(sportEventId) ?? 0,
        rounds: event.rounds ?? null,
        salaryCap: event.pricingConfig?.salaryCap ?? null,
        squaresFromRound: event.squaresFromRound ?? null,
        participantType: event.participantType ?? null,
        scoringFamily: event.scoringFamily ?? null,
      };
    },
    findActiveFieldPrices: async (sportEventId) => {
      const [entries, eventValuations] = await Promise.all([
        field.findBySportEvent(sportEventId),
        valuations.findBySportEvent(sportEventId),
      ]);
      const activeEntryIds = new Set(entries.filter((entry) => entry.isActive).map((entry) => entry.id));
      return eventValuations.flatMap((valuation) =>
        activeEntryIds.has(valuation.sportEventParticipantId) && valuation.price !== null ? [valuation.price] : []);
    },
    countGames: async (sportEventId) =>
      (await matches.findBySportEvent(sportEventId)).filter((match) => match.status !== MatchStatus.CANCELLED).length,
    countUndecidedGames: async (sportEventId, options) => {
      const games = (await matches.findBySportEvent(sportEventId)).filter((match) => match.status !== MatchStatus.CANCELLED);
      const openingRound = Math.min(...games.map((match) => match.roundNumber));
      return games.filter((match) => (options?.openingRoundOnly !== true || match.roundNumber === openingRound)
        && (match.homeSportEventParticipantId === null || match.awaySportEventParticipantId === null)).length;
    },
    countGamesWithoutSpread: async (sportEventId) =>
      (await matches.findBySportEvent(sportEventId)).filter((match) => match.status !== MatchStatus.CANCELLED && match.homeSpread === null).length,
    findBracketProblem: async (sportEventId, startsAtRound) => {
      const [games, entries] = await Promise.all([matches.findBySportEvent(sportEventId), field.findBySportEvent(sportEventId)]);
      return findBracketProblem(contestBracketGames(games, startsAtRound), knockoutSeeds(entries), startsAtRound);
    },
    findGame: async (sportEventId, sportEventMatchId) => {
      const game = (await matches.findBySportEvent(sportEventId)).find((match) => match.id === sportEventMatchId);
      return game === undefined ? null : { status: game.status, roundNumber: game.roundNumber };
    },
    findCutoffTiming: async (sportEvent, cutoff) => cutoff.kind === ContestCutoffKind.EVENT_START
      ? sportEvent
      : cutoffTiming(cutoff, sportEvent, await matches.findBySportEvent(sportEvent.id)),
  };
}

/**
 * What asking whether a setup could open on an event needs (#1007): contest creation's reader,
 * plus the next game a squares contest could still be played on. Its reads are batched (#1316):
 * the events asked about together, as an event page's offers are, are read together, each read
 * once for all of them. Build one for each page read and let it go with it.
 */
export function createContestOpeningReader(prisma: PrismaClient): ContestOpeningReader {
  const sportEvents = new PrismaSportEventRepository(prisma);
  const sports = new PrismaSportRepository(prisma);
  const field = new PrismaSportEventParticipantRepository(prisma);
  const eventMatches = new PrismaSportEventMatchRepository(prisma);
  const eventsById = batchedByIds((ids) => sportEvents.findByIds(ids), (event) => event.id);
  const participantCounts = new BatchedRead<string, number>(async (sportEventIds) => {
    const counts = await sportEvents.countParticipants([...new Set(sportEventIds)]);
    return sportEventIds.map((sportEventId) => counts.get(sportEventId) ?? 0);
  });
  // The sport rows are a fixed list of a handful, so the first ask reads them all.
  const sportRows = batchedByKey(() => sports.findAll(), (sport) => sport.sport);
  const gamesOf = batchedByKey((sportEventIds) => eventMatches.findBySportEvents(sportEventIds), (game) => game.sportEventId);
  const fieldOf = batchedByKey((sportEventIds) => field.findBySportEvents(sportEventIds), (row) => row.sportEventId);
  const matches = withReads(eventMatches, { findBySportEvent: (sportEventId) => gamesOf.load(sportEventId) });
  const reader = createContestSportEventReader({
    sportEvents: withReads(sportEvents, {
      findById: async (id) => (await eventsById.load([id])).at(0) ?? null,
      countParticipants: async (sportEventIds) => new Map(await Promise.all(sportEventIds.map(async (sportEventId) => [sportEventId, await participantCounts.load(sportEventId)] as const))),
    }),
    sports: withReads(sports, { findBySport: async (sport) => (await sportRows.load(sport)).at(0) ?? null }),
    field: withReads(field, { findBySportEvent: (sportEventId) => fieldOf.load(sportEventId) }),
    valuations: new PrismaSportEventParticipantValuationRepository(prisma),
    matches,
  });
  return {
    ...reader,
    nextSquaresKickoff: async (sportEvent, now) => {
      const games = await matches.findBySportEvent(sportEvent.id);
      const kickoffs = games
        .filter((game) => game.status !== MatchStatus.CANCELLED && isSquaresRound(sportEvent.squaresFromRound, game.roundNumber))
        .map((game) => cutoffTiming({ kind: ContestCutoffKind.MATCH_START, sportEventMatchId: game.id }, sportEvent, games))
        .filter((timing) => !hasSportEventStarted(timing, now))
        .map((timing) => timing.startDate.getTime());
      return kickoffs.length === 0 ? null : new Date(Math.min(...kickoffs));
    },
  };
}
