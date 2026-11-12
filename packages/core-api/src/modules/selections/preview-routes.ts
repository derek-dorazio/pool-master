import type { FastifyInstance } from 'fastify';
// Registers the named components this module's routes $ref (#192).
import '@poolmaster/shared/dto';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
import { PrismaLeagueMembershipRepository } from '../../adapters';
import { getAppPrisma } from '../../core/prisma-context';
import { requireCommissioner } from '../leagues/permissions';
import type { PlanModuleOptions } from '../plans/routes';
import { createPickPreviewHandlers } from './preview-handler';
import { createPredictionService, createSelectionService } from './wiring';

const PREVIEW_WRITES_NOTHING = 'It writes nothing: no contest, entry or pick is created, and the trial picks are only read back.';

/**
 * The member pick screen for a contest setup before it is saved (#1612), for a league's
 * commissioners while they create or edit a contest. Both routes are POST because the setup and
 * the trial picks are a body; neither writes.
 */
export function pickPreviewModule(fastify: FastifyInstance, opts: PlanModuleOptions): void {
  void fastify.register(schemaComponentsPlugin);

  const prisma = getAppPrisma(fastify);
  const membershipRepo = new PrismaLeagueMembershipRepository(prisma);
  const handlers = createPickPreviewHandlers(
    createSelectionService(prisma, fastify.log, { planEntitlements: opts.planEntitlements }),
    createPredictionService(prisma, fastify.log),
  );

  fastify.post('/roster', {
    schema: {
      tags: ['Selections'],
      summary: 'Preview a roster setup\'s pick screen',
      description:
        `The pick screen a tiered or budget setup gives members, from the setup's rules as the form holds them, unsaved, and the event's real field, tiers and prices: the field grouped as the rules group it, with the trial picks marked, whether they make a lineup an entry could submit, and a budget setup's spend against the event's salary cap. ${PREVIEW_WRITES_NOTHING} Commissioners of the league only (root admins bypass). 404 SPORT_EVENT_NOT_FOUND for an unknown event; 400 PARTICIPANT_NOT_IN_EVENT for a trial pick outside its field; 409 CONTEST_EVENT_NOT_PRICED for a budget setup on an event whose field was never priced.`,
      operationId: 'previewRosterPicks',
      body: schemaRef('RosterPickPreviewRequest'),
      response: {
        200: schemaRef('RosterPickPreviewResponse'),
        400: schemaRef('ErrorEnvelope'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
        409: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: handlers.previewRosterPicks,
  });

  fastify.post('/games', {
    schema: {
      tags: ['Selections'],
      summary: 'Preview a game setup\'s pick screen',
      description:
        `The pick screen a pick'em, bracket or survivor setup gives members, from the setup's rules as the form holds them, unsaved, and the event's real games and lines: the games an entry would pick (a bracket's from its starting round), each locked as it would be once the contest opens, with the trial picks resolved as an entry's would be. A bracket's later games hold the teams the earlier trial picks put there, and a trial pick that no longer follows, or a tie pick the setup does not offer, is dropped, and so is a confidence value the setup's mode does not take (a saved entry is refused for one instead). ${PREVIEW_WRITES_NOTHING} Commissioners of the league only (root admins bypass). 404 SPORT_EVENT_NOT_FOUND for an unknown event; 404 PREDICTION_GAME_NOT_FOUND for a trial pick on a game the setup does not pick; 400 PREDICTION_PICK_INVALID for a TEAM pick without its team or a TIE pick with one.`,
      operationId: 'previewGamePicks',
      body: schemaRef('GamePickPreviewRequest'),
      response: {
        200: schemaRef('GamePickPreviewResponse'),
        400: schemaRef('ErrorEnvelope'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: handlers.previewGamePicks,
  });
}
