/**
 * Tier and pricing profiles (#1844): the platform-level definitions each sport league names one
 * of. Mounted at /api/v1/tier-profiles and /api/v1/pricing-profiles. Root admin only.
 */

import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  ApiErrorCode,
  PlatformPricingProfileListResponse,
  PlatformPricingProfileResponse,
  PlatformPricingProfileWriteRequest,
  PlatformTierProfileListResponse,
  PlatformTierProfileResponse,
  PlatformTierProfileWriteRequest,
} from '@poolmaster/shared/dto';
// Registers ErrorEnvelope, which this module's error responses $ref (#192).
import '@poolmaster/shared/dto/errors.dto';
// Registers the named components this module's routes $ref (#192).
import '@poolmaster/shared/dto/profiles.dto';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
import { requireRootAdmin } from '../../core/root-admin-guard';
import { toPlatformPricingProfileDto, toPlatformTierProfileDto } from '../../mappers';
import type { PlatformPricingProfileService, PlatformTierProfileService } from './profile-service';

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

export interface PlatformTierProfilesModuleOptions {
  platformTierProfiles: PlatformTierProfileService;
}

export async function platformTierProfilesModule(fastify: FastifyInstance, opts: PlatformTierProfilesModuleOptions): Promise<void> {
  void fastify.register(schemaComponentsPlugin);
  await registerProfileRateLimit(fastify);
  fastify.addHook('onRequest', requireRootAdmin);
  const tags = ['Tier profiles'];
  const { platformTierProfiles } = opts;

  fastify.get('/', {
    schema: {
      tags,
      summary: 'List tier profiles',
      description: 'Every tier profile, by name, each with how many sport leagues name it. Root admin only.' + RATE_LIMITED,
      operationId: 'listPlatformTierProfiles',
      response: { 200: schemaRef('PlatformTierProfileListResponse'), ...errors(401, 403) },
    },
    config: RATE_LIMIT_CONFIG,
    handler: async (): Promise<PlatformTierProfileListResponse> => ({
      platformTierProfiles: (await platformTierProfiles.list()).map(({ profile, sportLeagueCount }) => toPlatformTierProfileDto(profile, sportLeagueCount)),
    }),
  });

  fastify.get('/:profileId', {
    schema: {
      tags,
      summary: 'Get a tier profile',
      description: '404 PLATFORM_TIER_PROFILE_NOT_FOUND for an unknown profile. Root admin only.' + RATE_LIMITED,
      operationId: 'getPlatformTierProfile',
      params: PROFILE_PARAMS,
      response: { 200: schemaRef('PlatformTierProfileResponse'), ...errors(401, 403, 404) },
    },
    config: RATE_LIMIT_CONFIG,
    handler: async (request: FastifyRequest<ProfileParams>): Promise<PlatformTierProfileResponse> => {
      const { profile, sportLeagueCount } = await platformTierProfiles.get(request.params.profileId);
      return { platformTierProfile: toPlatformTierProfileDto(profile, sportLeagueCount) };
    },
  });

  fastify.post('/', {
    schema: {
      tags,
      summary: 'Create a tier profile',
      description: '409 PLATFORM_TIER_PROFILE_CODE_TAKEN or PLATFORM_TIER_PROFILE_NAME_TAKEN when another tier profile has the code or the name; 422 PLATFORM_TIER_PROFILE_INVALID when lastTierMax is not set exactly for a CAPPED last tier. Root admin only.' + RATE_LIMITED,
      operationId: 'createPlatformTierProfile',
      body: schemaRef('PlatformTierProfileWriteRequest'),
      response: { 201: schemaRef('PlatformTierProfileResponse'), ...errors(400, 401, 403, 409, 422) },
    },
    config: RATE_LIMIT_CONFIG,
    handler: async (request: FastifyRequest<{ Body: PlatformTierProfileWriteRequest }>, reply: FastifyReply) => {
      const { profile, sportLeagueCount } = await platformTierProfiles.create(request.body);
      return reply.status(201).send({ platformTierProfile: toPlatformTierProfileDto(profile, sportLeagueCount) } satisfies PlatformTierProfileResponse);
    },
  });

  fastify.put('/:profileId', {
    schema: {
      tags,
      summary: 'Update a tier profile',
      description: 'Replaces the profile\'s name and layout. Every sport league naming it uses the new layout from then on: a new event starts with its tier count, and the next auto-tiering of a draft event uses it. An event already made keeps its tiers. '
        + '404 PLATFORM_TIER_PROFILE_NOT_FOUND, 409 PLATFORM_TIER_PROFILE_CODE_TAKEN, 409 PLATFORM_TIER_PROFILE_NAME_TAKEN, 422 PLATFORM_TIER_PROFILE_INVALID as for create. Root admin only.' + RATE_LIMITED,
      operationId: 'updatePlatformTierProfile',
      params: PROFILE_PARAMS,
      body: schemaRef('PlatformTierProfileWriteRequest'),
      response: { 200: schemaRef('PlatformTierProfileResponse'), ...errors(400, 401, 403, 404, 409, 422) },
    },
    config: RATE_LIMIT_CONFIG,
    handler: async (request: FastifyRequest<ProfileParams & { Body: PlatformTierProfileWriteRequest }>): Promise<PlatformTierProfileResponse> => {
      const { profile, sportLeagueCount } = await platformTierProfiles.update(request.params.profileId, request.body);
      return { platformTierProfile: toPlatformTierProfileDto(profile, sportLeagueCount) };
    },
  });

  fastify.delete('/:profileId', {
    schema: {
      tags,
      summary: 'Delete a tier profile',
      description: '409 PLATFORM_TIER_PROFILE_IN_USE while any sport league names it: point those leagues at another profile first. 404 PLATFORM_TIER_PROFILE_NOT_FOUND for an unknown profile. Root admin only.' + RATE_LIMITED,
      operationId: 'deletePlatformTierProfile',
      params: PROFILE_PARAMS,
      response: { 204: { type: 'null' }, ...errors(401, 403, 404, 409) },
    },
    config: RATE_LIMIT_CONFIG,
    handler: async (request: FastifyRequest<ProfileParams>, reply: FastifyReply) => {
      await platformTierProfiles.delete(request.params.profileId);
      return reply.status(204).send();
    },
  });
}

export interface PlatformPricingProfilesModuleOptions {
  platformPricingProfiles: PlatformPricingProfileService;
}

export async function platformPricingProfilesModule(fastify: FastifyInstance, opts: PlatformPricingProfilesModuleOptions): Promise<void> {
  void fastify.register(schemaComponentsPlugin);
  await registerProfileRateLimit(fastify);
  fastify.addHook('onRequest', requireRootAdmin);
  const tags = ['Pricing profiles'];
  const { platformPricingProfiles } = opts;

  fastify.get('/', {
    schema: {
      tags,
      summary: 'List pricing profiles',
      description: 'Every pricing profile, by name, each with how many sport leagues name it. The price dialog on an event\'s Tiers page offers them. Root admin only.' + RATE_LIMITED,
      operationId: 'listPlatformPricingProfiles',
      response: { 200: schemaRef('PlatformPricingProfileListResponse'), ...errors(401, 403) },
    },
    config: RATE_LIMIT_CONFIG,
    handler: async (): Promise<PlatformPricingProfileListResponse> => ({
      platformPricingProfiles: (await platformPricingProfiles.list()).map(({ profile, sportLeagueCount }) => toPlatformPricingProfileDto(profile, sportLeagueCount)),
    }),
  });

  fastify.get('/:profileId', {
    schema: {
      tags,
      summary: 'Get a pricing profile',
      description: '404 PLATFORM_PRICING_PROFILE_NOT_FOUND for an unknown profile. Root admin only.' + RATE_LIMITED,
      operationId: 'getPlatformPricingProfile',
      params: PROFILE_PARAMS,
      response: { 200: schemaRef('PlatformPricingProfileResponse'), ...errors(401, 403, 404) },
    },
    config: RATE_LIMIT_CONFIG,
    handler: async (request: FastifyRequest<ProfileParams>): Promise<PlatformPricingProfileResponse> => {
      const { profile, sportLeagueCount } = await platformPricingProfiles.get(request.params.profileId);
      return { platformPricingProfile: toPlatformPricingProfileDto(profile, sportLeagueCount) };
    },
  });

  fastify.post('/', {
    schema: {
      tags,
      summary: 'Create a pricing profile',
      description: '409 PLATFORM_PRICING_PROFILE_CODE_TAKEN or PLATFORM_PRICING_PROFILE_NAME_TAKEN when another pricing profile has the code or the name; 422 PLATFORM_PRICING_PROFILE_INVALID when the values contradict each other (a floor share above the top share, or a unit larger than the worst price). Root admin only.' + RATE_LIMITED,
      operationId: 'createPlatformPricingProfile',
      body: schemaRef('PlatformPricingProfileWriteRequest'),
      response: { 201: schemaRef('PlatformPricingProfileResponse'), ...errors(400, 401, 403, 409, 422) },
    },
    config: RATE_LIMIT_CONFIG,
    handler: async (request: FastifyRequest<{ Body: PlatformPricingProfileWriteRequest }>, reply: FastifyReply) => {
      const { profile, sportLeagueCount } = await platformPricingProfiles.create(request.body);
      return reply.status(201).send({ platformPricingProfile: toPlatformPricingProfileDto(profile, sportLeagueCount) } satisfies PlatformPricingProfileResponse);
    },
  });

  fastify.put('/:profileId', {
    schema: {
      tags,
      summary: 'Update a pricing profile',
      description: 'Replaces the profile\'s name and values. A synced field never priced, of any sport league naming it, is priced with the new values; a field already priced keeps the values it was priced with. '
        + '404 PLATFORM_PRICING_PROFILE_NOT_FOUND, 409 PLATFORM_PRICING_PROFILE_CODE_TAKEN, 409 PLATFORM_PRICING_PROFILE_NAME_TAKEN, 422 PLATFORM_PRICING_PROFILE_INVALID as for create. Root admin only.' + RATE_LIMITED,
      operationId: 'updatePlatformPricingProfile',
      params: PROFILE_PARAMS,
      body: schemaRef('PlatformPricingProfileWriteRequest'),
      response: { 200: schemaRef('PlatformPricingProfileResponse'), ...errors(400, 401, 403, 404, 409, 422) },
    },
    config: RATE_LIMIT_CONFIG,
    handler: async (request: FastifyRequest<ProfileParams & { Body: PlatformPricingProfileWriteRequest }>): Promise<PlatformPricingProfileResponse> => {
      const { profile, sportLeagueCount } = await platformPricingProfiles.update(request.params.profileId, request.body);
      return { platformPricingProfile: toPlatformPricingProfileDto(profile, sportLeagueCount) };
    },
  });

  fastify.delete('/:profileId', {
    schema: {
      tags,
      summary: 'Delete a pricing profile',
      description: '409 PLATFORM_PRICING_PROFILE_IN_USE while any sport league names it: point those leagues at another profile first. 404 PLATFORM_PRICING_PROFILE_NOT_FOUND for an unknown profile. Root admin only.' + RATE_LIMITED,
      operationId: 'deletePlatformPricingProfile',
      params: PROFILE_PARAMS,
      response: { 204: { type: 'null' }, ...errors(401, 403, 404, 409) },
    },
    config: RATE_LIMIT_CONFIG,
    handler: async (request: FastifyRequest<ProfileParams>, reply: FastifyReply) => {
      await platformPricingProfiles.delete(request.params.profileId);
      return reply.status(204).send();
    },
  });
}
