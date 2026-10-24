/**
 * History module (#837) — what happened in a league's past, under /api/v1/leagues/:id/history.
 * Members of the league read it (root admins bypass).
 */
import type { FastifyInstance } from 'fastify';
import { PlanFeature } from '@poolmaster/shared/domain';
import type { GetSquadYearQuery } from '@poolmaster/shared/dto';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
// Registers the named components these routes $ref (#192).
import '@poolmaster/shared/dto';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
import { getAppPrisma } from '../../core/prisma-context';
import { PrismaLeagueMembershipRepository } from '../../adapters';
import { leagueFromPath, requireCommissioner, requireMemberOfLeague } from '../leagues/permissions';
import { createHistoryHandlers } from './handler';
import { createHistoryService, createYearReviewService } from './wiring';
import type { MailModuleOptions } from '../email';
import { describePlanFeatureGate, requirePlanFeatures } from '../plans/plan-feature-gate';
import type { PlanModuleOptions } from '../plans/routes';

const COMMISSIONERS_ONLY = 'Active commissioners only (root admins bypass).';

const YEAR_PARAMS = {
  type: 'object',
  required: ['id', 'year'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    year: { type: 'integer', minimum: 2000, maximum: 9999, description: 'The year whose review to send, such as 2026: only last year can be sent.' },
  },
} as const;

const MEMBERS_ONLY = 'Active members of the league only (root admins bypass): 403 LEAGUE_MEMBERSHIP_REQUIRED or LEAGUE_MEMBERSHIP_INACTIVE otherwise.';

export function historyModule(fastify: FastifyInstance, opts: MailModuleOptions & PlanModuleOptions): void {
  void fastify.register(schemaComponentsPlugin);

  const prisma = getAppPrisma(fastify);
  const memberships = new PrismaLeagueMembershipRepository(prisma);
  const membersOnly = requireMemberOfLeague(memberships, leagueFromPath);
  const commissionersOnly = requireCommissioner(memberships);
  const history = createHistoryService(prisma, fastify.log, opts.planEntitlements);
  const handlers = createHistoryHandlers(
    history,
    createYearReviewService(prisma, { history, email: opts.email, logger: fastify.log }),
    opts.planEntitlements,
  );
  const inPlan = (...features: PlanFeature[]) => requirePlanFeatures(opts.planEntitlements, features);

  fastify.get('/year-review', {
    schema: {
      tags: ['History'],
      summary: 'Get last year\'s year in review',
      description: `Where the league's year in review for last year (US Eastern) stands: NOTHING_TO_SEND when no championship contest counted that year, READY from 1 January until the commissioner sends it, then SENT with when and by whom. The "ready to send" banner and the Send button read it. ${COMMISSIONERS_ONLY} ${describePlanFeatureGate([PlanFeature.EMAIL_YEAR_IN_REVIEW])}`,
      operationId: 'getYearReview',
      response: {
        200: schemaRef('YearReviewResponse'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: [commissionersOnly, inPlan(PlanFeature.EMAIL_YEAR_IN_REVIEW)],
    handler: handlers.getYearReview,
  });

  fastify.post('/year-review/:year/send', {
    schema: {
      tags: ['History'],
      summary: 'Send the year in review',
      description: `Allows a commissioner to send last year's year in review: each active owner of an active squad that placed that year gets an email with their squad's year (championship place and points, contest 1sts, 2nds and 3rds, the cups it placed in, its trophies) and a link to its squad page for that year. Owners who turned off Results email are skipped. Sent once per league and year. 409 YEAR_REVIEW_NOT_OPEN for any year but last year; 409 YEAR_REVIEW_NOTHING_TO_SEND when no championship contest counted that year; 409 YEAR_REVIEW_ALREADY_SENT once it is sent. ${COMMISSIONERS_ONLY} ${describePlanFeatureGate([PlanFeature.EMAIL_YEAR_IN_REVIEW])}`,
      operationId: 'sendYearReview',
      params: YEAR_PARAMS,
      response: {
        200: schemaRef('YearReviewResponse'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        409: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: [commissionersOnly, inPlan(PlanFeature.EMAIL_YEAR_IN_REVIEW)],
    handler: handlers.sendYearReview,
  });

  fastify.get('/summary', {
    schema: {
      tags: ['History'],
      summary: 'Get the All years summary',
      description: `Every year the league has a counted championship contest or a cup in, newest first: the championship's champions (its leaders for the current year) and each cup of that season with its champions (its leaders while open). Tiles for the most championships won (years over only) and the most cups won (crowned cups only), ties naming every squad. ${MEMBERS_ONLY} ${describePlanFeatureGate([PlanFeature.ALL_TIME_SUMMARY])}`,
      operationId: 'getHistorySummary',
      response: {
        200: schemaRef('HistorySummaryResponse'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: [membersOnly, inPlan(PlanFeature.ALL_TIME_SUMMARY)],
    handler: handlers.getHistorySummary,
  });

  fastify.get('/trophies', {
    schema: {
      tags: ['History'],
      summary: 'List the perpetual trophies',
      description: `The league's perpetual trophies, worked out on read: one for each contest of one event it has run in two or more years, the same event series and the same way of picking, with a plate per year naming its 1st place squads (none for a contest that went final with nobody placed). A week of games (several games, one round, none sending its winner on, such as an NFL regular-season week) earns none, and contests not counted are left out. ${MEMBERS_ONLY} ${describePlanFeatureGate([PlanFeature.TROPHY_SHELF])}`,
      operationId: 'listPerpetualTrophies',
      response: {
        200: schemaRef('PerpetualTrophyListResponse'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: [membersOnly, inPlan(PlanFeature.TROPHY_SHELF)],
    handler: handlers.listPerpetualTrophies,
  });

  fastify.get('/records', {
    schema: {
      tags: ['History'],
      summary: 'List the record book',
      description: `The league's record book, worked out on read from its counted contest finishes and its championships of years over: most championships, the longest run of championships in consecutive years, most contest wins in a year and of all time, the longest run of contests on the podium, and the biggest field won; then the Hall of Lame (most 2nds, 4ths and last places, the longest drought), unless the league hides it. Each names every holder on a tie and the next best. Contests not counted and cancelled ones are left out. ${MEMBERS_ONLY} ${describePlanFeatureGate([PlanFeature.RECORD_BOOK])}`,
      operationId: 'listRecords',
      response: {
        200: schemaRef('RecordListResponse'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: [membersOnly, inPlan(PlanFeature.RECORD_BOOK)],
    handler: handlers.listRecords,
  });

  fastify.get('/squads/:squadId/years', {
    schema: {
      tags: ['History'],
      summary: 'Get a squad\'s history',
      description: `A squad's whole history for its squad page: its contest medals all time (its championship rows' 1sts, 2nds and 3rds summed over every year), its trophy shelf (league championships finished 1st to 3rd in years that are over, and crowned cups' trophies), and its year, as \`getSquadYear\` reads it, for every year the league has a championship or a cup season in, newest first. A league whose plan lacks PAST_YEARS gets only the current year; each year's championship row is null without CHAMPIONSHIP, and its cup rows empty without CUP_STANDINGS. A squad of another league is 404 SQUAD_NOT_FOUND. ${MEMBERS_ONLY} ${describePlanFeatureGate([PlanFeature.TROPHY_SHELF])}`,
      operationId: 'getSquadHistory',
      response: {
        200: schemaRef('SquadHistoryResponse'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: [membersOnly, inPlan(PlanFeature.TROPHY_SHELF)],
    handler: handlers.getSquadHistory,
  });

  fastify.get('/squads/:squadId', {
    schema: {
      tags: ['History'],
      summary: 'Get a squad\'s year',
      description: `One squad's year for its squad page: its row of the league championship (place, points, gap to 1st, movement, finish matrix row) and its row of each cup of the season with that year, read through the same services as the Championship and Points race tabs. Its contests are \`listContestResults\` with its squadId. The championship row is null while the league's plan lacks CHAMPIONSHIP, and the cup rows empty while it lacks CUP_STANDINGS. A squad of another league is 404 SQUAD_NOT_FOUND. ${MEMBERS_ONLY} ${describePlanFeatureGate([], true)}`,
      operationId: 'getSquadYear',
      querystring: schemaRef('GetSquadYearQuery'),
      response: {
        200: schemaRef('SquadYearResponse'),
        400: schemaRef('ErrorEnvelope'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: [membersOnly, requirePlanFeatures(opts.planEntitlements, [], {
      yearOf: (request) => (request.query as GetSquadYearQuery).year,
    })],
    handler: handlers.getSquadYear,
  });

  fastify.get('/contests', {
    schema: {
      tags: ['History'],
      summary: 'List a year\'s final contests',
      description: `Every contest of the league that went final in the championship year (US Eastern), newest first, with its winners and whether it counted. With squadId, only the counted contests that squad placed in; with squadId and place, only those it finished in that place, so each list matches the finish matrix. No paging: a league finishes a few hundred contests a year at most. ${MEMBERS_ONLY}`,
      operationId: 'listContestResults',
      querystring: schemaRef('ListContestResultsQuery'),
      response: {
        200: schemaRef('ContestResultListResponse'),
        400: schemaRef('ErrorEnvelope'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: membersOnly,
    handler: handlers.listContestResults,
  });
}
