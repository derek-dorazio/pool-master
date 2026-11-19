/**
 * Customers module (#1882) — the root admin's grids of every league and every user. Mounted at
 * /api/v1/customers. Root admin only.
 */

import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import type { ApiErrorCode, CustomerLeagueListResponse, CustomerUserListResponse } from '@poolmaster/shared/dto';
// Registers ErrorEnvelope, which this module's error responses $ref (#192).
import '@poolmaster/shared/dto/errors.dto';
// Registers the named components this module's routes $ref (#192).
import '@poolmaster/shared/dto/customers.dto';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
import { requireRootAdmin } from '../../core/root-admin-guard';
import { toCustomerLeagueDto, toCustomerUserDto } from '../../mappers';
import type { CustomerService } from './customer-service';

export interface CustomersModuleOptions {
  customers: CustomerService;
}

/**
 * Customers reads one address may make a minute. A grid reloading after each edit stays well
 * inside it; a script hammering the whole-platform reads does not. Per process, as the other
 * per-address limits.
 */
export const CUSTOMERS_READS_PER_MINUTE = 60;

/** An address over its Customers reads for the minute. */
export class CustomersRateLimitError extends Error {
  readonly statusCode = 429;
  readonly code: ApiErrorCode = 'CUSTOMERS_RATE_LIMITED';

  constructor() {
    super('Too many Customers reads from this address; try again in a minute.');
    this.name = 'CustomersRateLimitError';
  }
}

const RATE_LIMITED = ` More than ${CUSTOMERS_READS_PER_MINUTE} reads a minute from one address answer 429 CUSTOMERS_RATE_LIMITED.`;

export async function customersModule(fastify: FastifyInstance, opts: CustomersModuleOptions): Promise<void> {
  void fastify.register(schemaComponentsPlugin);
  // Only the routes that ask for a limit get one (`config.rateLimit`); keyed by `request.ip`.
  // Awaited, so its route hook is in place before the routes below are declared.
  await fastify.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => new CustomersRateLimitError(),
  });
  fastify.addHook('onRequest', requireRootAdmin);

  const envelope = schemaRef('ErrorEnvelope');
  const errors = { 401: envelope, 403: envelope, 429: envelope };
  const config = { rateLimit: { max: CUSTOMERS_READS_PER_MINUTE, timeWindow: 60_000 } };

  fastify.get('/leagues', {
    schema: {
      tags: ['Customers'],
      summary: 'List every league for the Customers grid',
      description: 'Every league on the platform, active or not, by name: never paged and never searched on the server, since the grid filters on the client. '
        + 'Each row carries its plan, owner (its longest-serving active commissioner), active member and open-or-live contest counts, and when its Premium preview ends. '
        + 'Read from four queries, however many leagues. Change the plan with updateLeaguePlan and the preview with extendLeaguePlanRenewal. Root admin only.' + RATE_LIMITED,
      operationId: 'listCustomerLeagues',
      response: { 200: schemaRef('CustomerLeagueListResponse'), ...errors },
    },
    config,
    handler: async (): Promise<CustomerLeagueListResponse> => ({
      leagues: (await opts.customers.listLeagues()).map(toCustomerLeagueDto),
    }),
  });

  fastify.get('/users', {
    schema: {
      tags: ['Customers'],
      summary: 'List every user for the Customers grid',
      description: 'Every user on the platform, active or not, by last then first name: never paged and never searched on the server, since the grid filters on the client. '
        + 'Each row carries its role, status, the leagues it is an active member of, when it joined and when it last signed in. '
        + 'Read from two queries, however many users. Change the name with updateUserProfile and the role with setUserRootAdmin. Root admin only.' + RATE_LIMITED,
      operationId: 'listCustomerUsers',
      response: { 200: schemaRef('CustomerUserListResponse'), ...errors },
    },
    config,
    handler: async (): Promise<CustomerUserListResponse> => ({
      users: (await opts.customers.listUsers()).map(toCustomerUserDto),
    }),
  });
}
