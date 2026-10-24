/**
 * Billing module (#987), under /api/v1/leagues/:id/billing: a contest's entry cap and its
 * expansions (plans/payments.md §4, §5). Commissioners read and expand; a root admin gives an
 * expansion free. Members never see prices, so nothing here is for them.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  BillingConfig,
  ContestExpansionResponse,
  ExpandContestRequest,
  GrantContestExpansionRequest,
  LeaguePaymentListResponse,
} from '@poolmaster/shared/dto';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
// Registers the named components these routes $ref (#192).
import '@poolmaster/shared/dto';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
import {
  PrismaContestExpansionRepository,
  PrismaContestRepository,
  PrismaLeagueMembershipRepository,
  PrismaLeaguePaymentRepository,
  PrismaLeagueRepository,
} from '../../adapters';
import { getAppPrisma } from '../../core/prisma-context';
import { requireRootAdmin } from '../../core/root-admin-guard';
import { requireAuthUser } from '../../plugins/auth-guard';
import { requireCommissioner } from '../leagues/permissions';
import { createContestService } from '../contests/wiring';
import type { PlanModuleOptions } from '../plans/routes';
import { toLeaguePaymentListResponse } from '../../mappers/billing.mapper';
import type { ContestExpandedNotices } from '../notifications/contest-expanded-notices';
import { ContestExpansionService } from './contest-expansion-service';
import { PaymentHistoryService } from './payment-history-service';

export interface BillingModuleOptions extends PlanModuleOptions {
  /** BILLING_CONFIG as it stands now. */
  readBillingConfig: () => BillingConfig;
  contestExpanded: Pick<ContestExpandedNotices, 'tellExpanded'>;
}

type ContestParams = { Params: { id: string; contestId: string } };

const notFound = {
  ...schemaRef('ErrorEnvelope'),
  description: 'CONTEST_NOT_FOUND — no such contest in this league.',
};

export function billingModule(fastify: FastifyInstance, opts: BillingModuleOptions): void {
  void fastify.register(schemaComponentsPlugin);

  const prisma = getAppPrisma(fastify);
  const membershipRepo = new PrismaLeagueMembershipRepository(prisma);
  const expansions = new ContestExpansionService({
    contests: new PrismaContestRepository(prisma),
    leagues: new PrismaLeagueRepository(prisma),
    expansions: new PrismaContestExpansionRepository(prisma),
    planEntitlements: opts.planEntitlements,
    entryWindow: createContestService(prisma, fastify.log, { planEntitlements: opts.planEntitlements }),
    readConfig: opts.readBillingConfig,
    expanded: opts.contestExpanded,
    logger: fastify.log,
  });

  const history = new PaymentHistoryService({ payments: new PrismaLeaguePaymentRepository(prisma), logger: fastify.log });

  fastify.get('/payments', {
    schema: {
      tags: ['Billing'],
      summary: 'List a league\'s payment history',
      description:
        'Every payment made in the league, newest first (#987): date, amount in US cents, what it was for, its contest and who paid. While payments are off, each expansion is a $0 line that says it was free; a root admin\'s gift is a $0 line with its reason. No card data is kept. Commissioners and root admins only.',
      operationId: 'listLeaguePayments',
      response: {
        200: schemaRef('LeaguePaymentListResponse'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: notFound,
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: async (request: FastifyRequest<{ Params: { id: string } }>, _reply: FastifyReply): Promise<LeaguePaymentListResponse> =>
      toLeaguePaymentListResponse(await history.listForLeague(request.params.id)),
  });

  fastify.get('/contests/:contestId/expansion', {
    schema: {
      tags: ['Billing'],
      summary: 'Get a contest\'s entry cap and expansions',
      description:
        'The contest\'s entry cap (the higher of its league plan\'s and its expansion), its entries counted drafts included, and the bands above its cap on its plan\'s price list, with what each would cost (#987). Commissioners and root admins only: members never see prices.',
      operationId: 'getContestExpansion',
      response: {
        200: schemaRef('ContestExpansionResponse'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: notFound,
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: async (request: FastifyRequest<ContestParams>, _reply: FastifyReply): Promise<ContestExpansionResponse> =>
      expansions.getExpansion(request.params.id, request.params.contestId),
  });

  fastify.post('/contests/:contestId/expansion', {
    schema: {
      tags: ['Billing'],
      summary: 'Expand a contest',
      description:
        'Raises the contest\'s entry cap to one of its offered bands, at once, from its creation until it stops taking entries (#987). While payments are off it is free, and the league\'s payment history records a $0 line, "free while payments are off". A step up records the band it came from. Commissioners and root admins. 409 CONTEST_EXPANSION_CLOSED once the contest has stopped taking entries; CONTEST_EXPANSION_BAND_UNAVAILABLE for a band not offered; CONTEST_EXPANSION_NOT_ABOVE_CAP when another expansion to this band or higher landed first; PAYMENTS_CHECKOUT_UNAVAILABLE while payments are on, because checkout is not built yet. 400 LEAGUE_DETAILS_READ_ONLY_WHEN_INACTIVE for an inactive league; a root admin can still give an expansion.',
      operationId: 'expandContest',
      body: schemaRef('ExpandContestRequest'),
      response: {
        200: schemaRef('ContestExpansionResponse'),
        400: schemaRef('ErrorEnvelope'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: notFound,
        409: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: async (request: FastifyRequest<ContestParams & { Body: ExpandContestRequest }>, _reply: FastifyReply): Promise<ContestExpansionResponse> =>
      expansions.expand(request.params.id, request.params.contestId, request.body.entriesPerContest, requireAuthUser(request).userId),
  });

  fastify.post('/contests/:contestId/expansion/grant', {
    schema: {
      tags: ['Billing'],
      summary: 'Give a contest an expansion free',
      description:
        'A root admin raises the contest\'s entry cap to any number above it, free, with a reason, at any time (#987). The league\'s payment history records a $0 line with the reason. Root admin only. 409 CONTEST_EXPANSION_NOT_ABOVE_CAP when the number is not above the contest\'s cap, or the contest has no limit.',
      operationId: 'grantContestExpansion',
      body: schemaRef('GrantContestExpansionRequest'),
      response: {
        200: schemaRef('ContestExpansionResponse'),
        400: schemaRef('ErrorEnvelope'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: notFound,
        409: schemaRef('ErrorEnvelope'),
      },
    },
    onRequest: requireRootAdmin,
    handler: async (request: FastifyRequest<ContestParams & { Body: GrantContestExpansionRequest }>, _reply: FastifyReply): Promise<ContestExpansionResponse> =>
      expansions.grant(
        request.params.id,
        request.params.contestId,
        request.body.entriesPerContest,
        request.body.reason,
        requireAuthUser(request).userId,
      ),
  });
}
