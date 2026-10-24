import type { FastifyInstance } from 'fastify';
import { PlanFeature } from '@poolmaster/shared/domain';
// Registers the named components this module's routes $ref (#192).
import '@poolmaster/shared/dto';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
import { PrismaLeagueMembershipRepository } from '../../adapters';
import { requireCommissioner } from '../leagues/permissions';
import { createContestManagementHandlers } from './handler';
import { createContestManagementService } from './wiring';
import { getAppPrisma } from '../../core/prisma-context';
import { readApplicationBaseUrl, type MailModuleOptions } from '../email';
import { createContestNotices } from '../notifications/wiring';
import { describePlanFeatureGate, requirePlanFeatures } from '../plans/plan-feature-gate';
import type { PlanModuleOptions } from '../plans/routes';

export function contestManagementModule(
  fastify: FastifyInstance,
  opts: MailModuleOptions & PlanModuleOptions,
): void {
  void fastify.register(schemaComponentsPlugin);

  const prisma = getAppPrisma(fastify);
  const membershipRepo = new PrismaLeagueMembershipRepository(prisma);
  const contestManagementService = createContestManagementService(prisma, fastify.log, opts.planEntitlements, createContestNotices(prisma, {
    email: opts.email,
    appBaseUrl: readApplicationBaseUrl(process.env),
    logger: fastify.log,
    planEntitlements: opts.planEntitlements,
  }));
  const handlers = createContestManagementHandlers(contestManagementService);

  fastify.get('/contests/:contestId', {
    schema: {
      tags: ['Contest Management'],
      summary: 'Get a contest\'s configuration',
      description:
        'Returns a contest with its configuration and the tiers it inherits from its event: what the configuration editor reads. Commissioner only. Named for the object it returns, not the role that reads it (#248; was getManagedContest).',
      operationId: 'getContestConfiguration',
      response: {
        200: schemaRef('ContestManagementResponse'),
        400: schemaRef('ErrorEnvelope'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: handlers.getContest,
  });

  fastify.put('/contests/:contestId/configuration', {
    schema: {
      tags: ['Contest Management'],
      summary: 'Update a contest\'s configuration',
      description:
        'Updates a draft contest\'s configuration and returns it as getContestConfiguration does. Commissioner only. Refused with 409 CONTEST_CONFIGURATION_LOCKED once the contest is no longer DRAFT: opening it to the league locks its settings for good.',
      operationId: 'updateContestConfiguration',
      body: schemaRef('ContestConfigurationRequest'),
      response: {
        200: schemaRef('ContestManagementResponse'),
        400: schemaRef('ErrorEnvelope'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
        409: {
          ...schemaRef('ErrorEnvelope'),
          description: 'CONTEST_CONFIGURATION_LOCKED — the contest has been opened to the league (it is not DRAFT), so its configuration can no longer change. CONTEST_EVENT_NOT_PRICED — budget rules on an event whose golfers have no prices. CONTEST_BUDGET_UNFILLABLE — the cheapest golfers for every roster place cost more than the event\'s salary cap.',
        },
        422: {
          ...schemaRef('ErrorEnvelope'),
          description: 'CONTEST_RULES_SELECTION_TYPE_MISMATCH — the rules are of another selection type than the contest\'s. CONTEST_TIER_FIELD_OUT_OF_RANGE — the tiered rules do not fit the event\'s tiers. CONTEST_BUDGET_FIELD_OUT_OF_RANGE — counted scores above the roster size.',
        },
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: handlers.updateContestConfiguration,
  });

  fastify.post('/contests/:contestId/open', {
    schema: {
      tags: ['Contest Management'],
      summary: 'Open a draft contest to the league',
      description:
        'Moves a DRAFT contest to OPEN so league members can see and enter it, and returns it as getContestConfiguration does. Commissioner only. There is no undo: from here its name, configuration and existence are locked. The event\'s field need not be ready; entries wait on it.',
      operationId: 'openContest',
      response: {
        200: schemaRef('ContestManagementResponse'),
        400: schemaRef('ErrorEnvelope'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: {
          ...schemaRef('ErrorEnvelope'),
          description: 'CONTEST_NOT_FOUND, or SPORT_EVENT_NOT_FOUND when the contest\'s event is gone.',
        },
        409: {
          ...schemaRef('ErrorEnvelope'),
          description: 'CONTEST_NOT_DRAFT — the contest is already open, or past it. CONTEST_EVENT_ALREADY_STARTED — the event\'s start time has passed or it is IN_PROGRESS, COMPLETED or CANCELLED; the draft stays a draft. CONTEST_EVENT_NOT_PRICED or CONTEST_BUDGET_UNFILLABLE — budget rules the event\'s active field can no longer fill under its salary cap, for example after withdrawals; edit the draft first.',
        },
        422: {
          ...schemaRef('ErrorEnvelope'),
          description: 'CONTEST_TIER_FIELD_OUT_OF_RANGE — the stored configuration no longer fits the event\'s tiers; edit the draft first. CONTEST_RULES_SELECTION_TYPE_MISMATCH or CONTEST_BUDGET_FIELD_OUT_OF_RANGE — stored rules that break their selection type\'s checks. CONTEST_SELECTION_TYPE_NOT_ALLOWED — the event\'s sport no longer offers the contest\'s selection type.',
        },
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: handlers.openContest,
  });

  fastify.put('/contests/:contestId/cup-weight', {
    schema: {
      tags: ['Contest Management'],
      summary: 'Set how much a contest counts toward its cup',
      description:
        `Sets how much the contest counts toward its sports league cup and the league championship (#841) and returns it as getContestConfiguration does. Commissioner only. Allowed while the contest is DRAFT, OPEN or ACTIVE; once it is COMPLETED its weight is fixed, because the championship keeps the points it earned at settlement. ${describePlanFeatureGate([PlanFeature.CUP_SETTINGS])}`,
      operationId: 'setContestCupWeight',
      body: schemaRef('SetContestCupWeightRequest'),
      response: {
        200: schemaRef('ContestManagementResponse'),
        400: schemaRef('ErrorEnvelope'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: {
          ...schemaRef('ErrorEnvelope'),
          description: 'CONTEST_NOT_FOUND — no such contest in this league.',
        },
        409: {
          ...schemaRef('ErrorEnvelope'),
          description: 'CONTEST_FINAL — the contest is COMPLETED, so its weight is fixed.',
        },
      },
    },
    preHandler: [requireCommissioner(membershipRepo), requirePlanFeatures(opts.planEntitlements, [PlanFeature.CUP_SETTINGS])],
    handler: handlers.setContestCupWeight,
  });

  fastify.put('/contests/:contestId/sport-events', {
    schema: {
      tags: ['Contest Management'],
      summary: 'Set the events a contest covers',
      description:
        'Sets the events the contest covers (#713) and returns it as getContestConfiguration does. Commissioner only. Send every event the contest should cover; one left out is removed, and its picks with it. The contest keeps its events in start-date order. An added event must be released, have its field loaded, not have started, and be from the contest\'s sport league; the contest\'s rules are checked against it as at create. Events can be added while the contest is DRAFT, OPEN or ACTIVE, and removed only while none of its events has started.',
      operationId: 'setContestSportEvents',
      body: schemaRef('SetContestSportEventsRequest'),
      response: {
        200: schemaRef('ContestManagementResponse'),
        400: schemaRef('ErrorEnvelope'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: {
          ...schemaRef('ErrorEnvelope'),
          description: 'CONTEST_NOT_FOUND, or SPORT_EVENT_NOT_FOUND for an event that does not exist.',
        },
        409: {
          ...schemaRef('ErrorEnvelope'),
          description: 'CONTEST_EVENTS_LOCKED — an event would be removed after one of the contest\'s events started, or the contest is COMPLETED or drawn. CONTEST_BUDGET_SALARY_CAP_MISMATCH — a budget contest\'s events were priced against different salary caps, or an open one\'s new event against another cap than its entries were built under. CONTEST_EVENT_NOT_PRICED or CONTEST_BUDGET_UNFILLABLE — budget rules an added event cannot fill.',
        },
        422: {
          ...schemaRef('ErrorEnvelope'),
          description: 'SPORT_EVENT_NOT_RELEASED, SPORT_EVENT_FIELD_NOT_LOADED or SPORT_EVENT_ALREADY_STARTED — an added event is not one contests can be built on. CONTEST_EVENTS_LEAGUE_MISMATCH — an event from another sport league. CONTEST_DRAW_SINGLE_EVENT — a random-draw contest given more than one event. CONTEST_BRACKET_SINGLE_EVENT — a bracket contest given more than one event. CONTEST_TIER_FIELD_OUT_OF_RANGE or CONTEST_SCORING_ROUNDS_MISMATCH — the rules do not fit an added event. CONTEST_EVENT_HAS_NO_GAMES, CONTEST_EVENT_GAME_UNDECIDED or CONTEST_EVENT_SPREAD_MISSING — an added week cannot be picked under the pick\'em rules. CONTEST_SPREAD_NOT_OFFERED — a pick\'em pool against the spread in a sport whose pools have no spread (#792).',
        },
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: handlers.setContestSportEvents,
  });
}
