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
} from '@poolmaster/shared/dto';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
// Registers the named components these routes $ref (#192).
import '@poolmaster/shared/dto';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
import { PrismaContestExpansionRepository, PrismaContestRepository, PrismaLeagueMembershipRepository } from '../../adapters';
import { getAppPrisma } from '../../core/prisma-context';
import { requireRootAdmin } from '../../core/root-admin-guard';
import { requireCommissioner } from '../leagues/permissions';
import { createContestService } from '../contests/wiring';
import type { PlanModuleOptions } from '../plans/routes';
import { ContestExpansionService } from './contest-expansion-service';

export interface BillingModuleOptions extends PlanModuleOptions {
  /** BILLING_CONFIG as it stands now. */
  readBillingConfig: () => BillingConfig;
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
    expansions: new PrismaContestExpansionRepository(prisma),
    planEntitlements: opts.planEntitlements,
    entryWindow: createContestService(prisma, fastify.log, { planEntitlements: opts.planEntitlements }),
    readConfig: opts.readBillingConfig,
    logger: fastify.log,
  });

  function actorId(request: FastifyRequest): string {
    // The auth guard has run, so a signed-in user is there.
    return request.authUser?.userId ?? '';
  }

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
        'Raises the contest\'s entry cap to one of its offered bands, at once, from its creation until it stops taking entries (#987). While payments are off it is free, and the league\'s payment history records a $0 line, "free while payments are off". A step up records the band it came from. Commissioners and root admins. 409 CONTEST_EXPANSION_CLOSED once the contest has stopped taking entries; CONTEST_EXPANSION_BAND_UNAVAILABLE for a band not offered; CONTEST_EXPANSION_NOT_ABOVE_CAP when another expansion to this band or higher landed first; PAYMENTS_CHECKOUT_UNAVAILABLE while payments are on, because checkout is not built yet.',
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
      expansions.expand(request.params.id, request.params.contestId, request.body.entriesPerContest, actorId(request)),
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
        actorId(request),
      ),
  });
}
