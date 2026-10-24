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
import { MatchStatus, getDefaultTournamentFormatForSport } from '@poolmaster/shared/domain';
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
        tournamentFormat: sport?.tournamentFormat ?? getDefaultTournamentFormatForSport(event.sport),
        participantCount: event.participantCount ?? null,
        loadedParticipantCount: loaded.get(sportEventId) ?? 0,
        rounds: event.rounds ?? null,
        salaryCap: event.pricingConfig?.salaryCap ?? null,
        squaresFromRound: event.squaresFromRound ?? null,
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
