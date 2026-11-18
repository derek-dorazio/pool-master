/**
 * Tier and pricing profiles (#1844): the platform-level definitions each sport league names one
 * of. Mounted at /api/v1/tier-profiles and /api/v1/pricing-profiles. Root admin only.
 */

import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  ApiErrorCode,
  PricingProfileListResponse,
  PricingProfileResponse,
  PricingProfileWriteRequest,
  TierProfileListResponse,
  TierProfileResponse,
  TierProfileWriteRequest,
} from '@poolmaster/shared/dto';
// Registers ErrorEnvelope, which this module's error responses $ref (#192).
import '@poolmaster/shared/dto/errors.dto';
// Registers the named components this module's routes $ref (#192).
import '@poolmaster/shared/dto/profiles.dto';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
import { requireRootAdmin } from '../../core/root-admin-guard';
import { toPricingProfileDto, toTierProfileDto } from '../../mappers';
import type { PricingProfileService, TierProfileService } from './profile-service';

const PROFILE_PARAMS = {
  type: 'object',
  required: ['profileId'],
  properties: { profileId: { type: 'string', format: 'uuid' } },
};

type ProfileParams = { Params: { profileId: string } };

/**
 * Requests one address may make a minute on each profile route. The admin screens make a handful;
 * a script hammering a route does not stay inside it. Per process, as the other per-address limits.
 */
export const PROFILE_REQUESTS_PER_MINUTE = 120;

/** An address over its requests for the minute on a profile route. */
export class ProfileRateLimitError extends Error {
  readonly statusCode = 429;
  readonly code: ApiErrorCode = 'PROFILE_RATE_LIMITED';

  constructor() {
    super('Too many profile requests from this address; try again in a minute.');
    this.name = 'ProfileRateLimitError';
  }
}

const RATE_LIMITED = ` More than ${PROFILE_REQUESTS_PER_MINUTE} requests a minute from one address answer 429 PROFILE_RATE_LIMITED.`;
const RATE_LIMIT_CONFIG = { rateLimit: { max: PROFILE_REQUESTS_PER_MINUTE, timeWindow: 60_000 } };

/** Only routes that carry `config.rateLimit` get a limit; keyed by `request.ip`. */
async function registerProfileRateLimit(fastify: FastifyInstance): Promise<void> {
  // Awaited, so its route hook is in place before the module's routes are declared.
  await fastify.register(rateLimit, { global: false, errorResponseBuilder: () => new ProfileRateLimitError() });
}

function errors(...statuses: number[]) {
  const envelope = schemaRef('ErrorEnvelope');
  return Object.fromEntries([...statuses, 429].map((status) => [status, envelope]));
}

export interface TierProfilesModuleOptions {
  tierProfiles: TierProfileService;
}

export async function tierProfilesModule(fastify: FastifyInstance, opts: TierProfilesModuleOptions): Promise<void> {
  void fastify.register(schemaComponentsPlugin);
  await registerProfileRateLimit(fastify);
  fastify.addHook('onRequest', requireRootAdmin);
  const tags = ['Tier profiles'];
  const { tierProfiles } = opts;

  fastify.get('/', {
    schema: {
      tags,
      summary: 'List tier profiles',
      description: 'Every tier profile, by name, each with how many sport leagues name it. Root admin only.' + RATE_LIMITED,
      operationId: 'listTierProfiles',
      response: { 200: schemaRef('TierProfileListResponse'), ...errors(401, 403) },
    },
    config: RATE_LIMIT_CONFIG,
    handler: async (): Promise<TierProfileListResponse> => ({
      tierProfiles: (await tierProfiles.list()).map(({ profile, sportLeagueCount }) => toTierProfileDto(profile, sportLeagueCount)),
    }),
  });

  fastify.get('/:profileId', {
    schema: {
      tags,
      summary: 'Get a tier profile',
      description: '404 TIER_PROFILE_NOT_FOUND for an unknown profile. Root admin only.' + RATE_LIMITED,
      operationId: 'getTierProfile',
      params: PROFILE_PARAMS,
      response: { 200: schemaRef('TierProfileResponse'), ...errors(401, 403, 404) },
    },
    config: RATE_LIMIT_CONFIG,
    handler: async (request: FastifyRequest<ProfileParams>): Promise<TierProfileResponse> => {
      const { profile, sportLeagueCount } = await tierProfiles.get(request.params.profileId);
      return { tierProfile: toTierProfileDto(profile, sportLeagueCount) };
    },
  });

  fastify.post('/', {
    schema: {
      tags,
      summary: 'Create a tier profile',
      description: '409 TIER_PROFILE_NAME_TAKEN when another tier profile has the name; 422 TIER_PROFILE_INVALID when lastTierMax is not set exactly for a CAPPED last tier. Root admin only.' + RATE_LIMITED,
      operationId: 'createTierProfile',
      body: schemaRef('TierProfileWriteRequest'),
      response: { 201: schemaRef('TierProfileResponse'), ...errors(400, 401, 403, 409, 422) },
    },
    config: RATE_LIMIT_CONFIG,
    handler: async (request: FastifyRequest<{ Body: TierProfileWriteRequest }>, reply: FastifyReply) => {
      const { profile, sportLeagueCount } = await tierProfiles.create(request.body);
      return reply.status(201).send({ tierProfile: toTierProfileDto(profile, sportLeagueCount) } satisfies TierProfileResponse);
    },
  });

  fastify.put('/:profileId', {
    schema: {
      tags,
      summary: 'Update a tier profile',
      description: 'Replaces the profile\'s name and layout. Every sport league naming it uses the new layout from then on: a new event starts with its tier count, and the next auto-tiering of a draft event uses it. An event already made keeps its tiers. '
        + '404 TIER_PROFILE_NOT_FOUND, 409 TIER_PROFILE_NAME_TAKEN, 422 TIER_PROFILE_INVALID as for create. Root admin only.' + RATE_LIMITED,
      operationId: 'updateTierProfile',
      params: PROFILE_PARAMS,
      body: schemaRef('TierProfileWriteRequest'),
      response: { 200: schemaRef('TierProfileResponse'), ...errors(400, 401, 403, 404, 409, 422) },
    },
    config: RATE_LIMIT_CONFIG,
    handler: async (request: FastifyRequest<ProfileParams & { Body: TierProfileWriteRequest }>): Promise<TierProfileResponse> => {
      const { profile, sportLeagueCount } = await tierProfiles.update(request.params.profileId, request.body);
      return { tierProfile: toTierProfileDto(profile, sportLeagueCount) };
    },
  });

  fastify.delete('/:profileId', {
    schema: {
      tags,
      summary: 'Delete a tier profile',
      description: '409 TIER_PROFILE_IN_USE while any sport league names it: point those leagues at another profile first. 404 TIER_PROFILE_NOT_FOUND for an unknown profile. Root admin only.' + RATE_LIMITED,
      operationId: 'deleteTierProfile',
      params: PROFILE_PARAMS,
      response: { 204: { type: 'null' }, ...errors(401, 403, 404, 409) },
    },
    config: RATE_LIMIT_CONFIG,
    handler: async (request: FastifyRequest<ProfileParams>, reply: FastifyReply) => {
      await tierProfiles.delete(request.params.profileId);
      return reply.status(204).send();
    },
  });
}

export interface PricingProfilesModuleOptions {
  pricingProfiles: PricingProfileService;
}

export async function pricingProfilesModule(fastify: FastifyInstance, opts: PricingProfilesModuleOptions): Promise<void> {
  void fastify.register(schemaComponentsPlugin);
  await registerProfileRateLimit(fastify);
  fastify.addHook('onRequest', requireRootAdmin);
  const tags = ['Pricing profiles'];
  const { pricingProfiles } = opts;

  fastify.get('/', {
    schema: {
      tags,
      summary: 'List pricing profiles',
      description: 'Every pricing profile, by name, each with how many sport leagues name it. The price dialog on an event\'s Tiers page offers them. Root admin only.' + RATE_LIMITED,
      operationId: 'listPricingProfiles',
      response: { 200: schemaRef('PricingProfileListResponse'), ...errors(401, 403) },
    },
    config: RATE_LIMIT_CONFIG,
    handler: async (): Promise<PricingProfileListResponse> => ({
      pricingProfiles: (await pricingProfiles.list()).map(({ profile, sportLeagueCount }) => toPricingProfileDto(profile, sportLeagueCount)),
    }),
  });

  fastify.get('/:profileId', {
    schema: {
      tags,
      summary: 'Get a pricing profile',
      description: '404 PRICING_PROFILE_NOT_FOUND for an unknown profile. Root admin only.' + RATE_LIMITED,
      operationId: 'getPricingProfile',
      params: PROFILE_PARAMS,
      response: { 200: schemaRef('PricingProfileResponse'), ...errors(401, 403, 404) },
    },
    config: RATE_LIMIT_CONFIG,
    handler: async (request: FastifyRequest<ProfileParams>): Promise<PricingProfileResponse> => {
      const { profile, sportLeagueCount } = await pricingProfiles.get(request.params.profileId);
      return { pricingProfile: toPricingProfileDto(profile, sportLeagueCount) };
    },
  });

  fastify.post('/', {
    schema: {
      tags,
      summary: 'Create a pricing profile',
      description: '409 PRICING_PROFILE_NAME_TAKEN when another pricing profile has the name; 422 PRICING_PROFILE_INVALID when the values contradict each other (a floor share above the top share, or a unit larger than the worst price). Root admin only.' + RATE_LIMITED,
      operationId: 'createPricingProfile',
      body: schemaRef('PricingProfileWriteRequest'),
      response: { 201: schemaRef('PricingProfileResponse'), ...errors(400, 401, 403, 409, 422) },
    },
    config: RATE_LIMIT_CONFIG,
    handler: async (request: FastifyRequest<{ Body: PricingProfileWriteRequest }>, reply: FastifyReply) => {
      const { profile, sportLeagueCount } = await pricingProfiles.create(request.body);
      return reply.status(201).send({ pricingProfile: toPricingProfileDto(profile, sportLeagueCount) } satisfies PricingProfileResponse);
    },
  });

  fastify.put('/:profileId', {
    schema: {
      tags,
      summary: 'Update a pricing profile',
      description: 'Replaces the profile\'s name and values. A synced field never priced, of any sport league naming it, is priced with the new values; a field already priced keeps the values it was priced with. '
        + '404 PRICING_PROFILE_NOT_FOUND, 409 PRICING_PROFILE_NAME_TAKEN, 422 PRICING_PROFILE_INVALID as for create. Root admin only.' + RATE_LIMITED,
      operationId: 'updatePricingProfile',
      params: PROFILE_PARAMS,
      body: schemaRef('PricingProfileWriteRequest'),
      response: { 200: schemaRef('PricingProfileResponse'), ...errors(400, 401, 403, 404, 409, 422) },
    },
    config: RATE_LIMIT_CONFIG,
    handler: async (request: FastifyRequest<ProfileParams & { Body: PricingProfileWriteRequest }>): Promise<PricingProfileResponse> => {
      const { profile, sportLeagueCount } = await pricingProfiles.update(request.params.profileId, request.body);
      return { pricingProfile: toPricingProfileDto(profile, sportLeagueCount) };
    },
  });

  fastify.delete('/:profileId', {
    schema: {
      tags,
      summary: 'Delete a pricing profile',
      description: '409 PRICING_PROFILE_IN_USE while any sport league names it: point those leagues at another profile first. 404 PRICING_PROFILE_NOT_FOUND for an unknown profile. Root admin only.' + RATE_LIMITED,
      operationId: 'deletePricingProfile',
      params: PROFILE_PARAMS,
      response: { 204: { type: 'null' }, ...errors(401, 403, 404, 409) },
    },
    config: RATE_LIMIT_CONFIG,
    handler: async (request: FastifyRequest<ProfileParams>, reply: FastifyReply) => {
      await pricingProfiles.delete(request.params.profileId);
      return reply.status(204).send();
    },
  });
}
