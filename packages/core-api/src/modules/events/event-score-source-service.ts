/**
 * EventScoreSourceService — the cross-sport half of "browse a provider's
 * catalog and link it to an admin-authored SportEvent for live scoring"
 * (plans/124 §3.4/§4.4). Lives beside event-lifecycle-service.ts, not in
 * modules/golf/, because nothing about it is golf-shaped: browsing a
 * provider's upcoming events and linking/unlinking a score source is exactly
 * as true for a future admin-created NBA game as it is for a golf
 * tournament. Golf's admin routes call it the same way they call
 * event-lifecycle-service.ts for status transitions.
 *
 * `listCandidateEvents` is deliberately a plain filtered list, not a scored
 * match — an earlier draft's `findCandidateMatches` similarity-scoring
 * design was deleted per explicit direction, not simplified (plans/124
 * §4.4). It is also the single place that resolves "which provider is
 * registered for this id" for every read-only catalog lookup the admin-golf
 * module needs, so there is exactly one failure mode when a provider isn't
 * registered.
 */

import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { MANUAL_ADMIN_PROVIDER_ID, SportEventSyncScope, type Sport } from '@poolmaster/shared/domain';
import { ProviderRegistry } from '../ingestion/core/provider-registry';
import type { DateRange, SportEvent as ProviderCatalogSportEvent } from '../ingestion/core/provider-interface';

export class EventScoreSourceError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'EventScoreSourceError';
  }
}

export interface ProviderCatalogEventRow {
  externalId: string;
  name: string;
  startDate: Date;
  endDate: Date | null;
  status: ProviderCatalogSportEvent['status'];
}

const DEFAULT_LOOKBACK_DAYS = 3;
const DEFAULT_LOOKAHEAD_DAYS = 90;

export class EventScoreSourceService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly providerRegistry: ProviderRegistry = new ProviderRegistry(),
    private readonly logger?: FastifyBaseLogger,
  ) {}

  /**
   * Calls `provider.getUpcomingEvents` live — no dependency on any persisted
   * SportEvent row or on schedule/field sync being enabled. Serves both the
   * tournament-creation browse mode and the score-source linking picker
   * (plans/124 §4.4/§4.4a) — the only candidate-lookup operation.
   */
  async listCandidateEvents(
    providerId: string,
    sport: Sport,
    options: { sportLeagueId?: string; from?: Date; to?: Date; search?: string } = {},
  ): Promise<ProviderCatalogEventRow[]> {
    const provider = this.providerRegistry.getProviderById(providerId);
    if (!provider) {
      throw new EventScoreSourceError(`Provider ${providerId} was not found.`, 'PROVIDER_NOT_FOUND', 404);
    }

    const now = new Date();
    const dateRange: DateRange = {
      from: options.from ?? new Date(now.getTime() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000),
      to: options.to ?? new Date(now.getTime() + DEFAULT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000),
    };

    const events = await provider.getUpcomingEvents(sport, dateRange);

    const matchKeyword = options.sportLeagueId
      ? (await this.prisma.sportLeague.findUnique({ where: { id: options.sportLeagueId } }))?.matchKeyword ?? null
      : null;
    const search = options.search?.trim().toLowerCase() || null;

    return events
      .filter((event) => !matchKeyword || event.name.toLowerCase().includes(matchKeyword.toLowerCase()))
      .filter((event) => !search || event.name.toLowerCase().includes(search))
      .map((event) => ({
        externalId: event.externalId,
        name: event.name,
        startDate: event.startDate,
        endDate: event.endDate ?? null,
        status: event.status,
      }));
  }

  /**
   * Sets providerId/externalId/syncScope=SCORES_ONLY in one write. Does not,
   * by itself, import the provider's field or odds — a tournament that
   * already has an admin/season-authored field keeps it untouched
   * (plans/124 §4.4).
   */
  async linkScoreSource(
    sportEventId: string,
    input: { providerId: string; externalId: string },
  ): Promise<void> {
    const existing = await this.requireSportEvent(sportEventId);
    this.assertAdminManaged(existing);

    const conflict = await this.prisma.sportEvent.findFirst({
      where: {
        providerId: input.providerId,
        externalId: input.externalId,
        NOT: { id: sportEventId },
      },
    });
    if (conflict) {
      throw new EventScoreSourceError(
        `Another sport event is already linked to ${input.providerId}/${input.externalId}.`,
        'EXTERNAL_EVENT_ALREADY_LINKED',
        409,
      );
    }

    await this.prisma.sportEvent.update({
      where: { id: sportEventId },
      data: {
        providerId: input.providerId,
        externalId: input.externalId,
        syncScope: SportEventSyncScope.SCORES_ONLY,
      },
    });

    this.logger?.info(
      { sportEventId, providerId: input.providerId, externalId: input.externalId },
      'Linked sport event score source',
    );
  }

  /**
   * Reverts to the manual-admin placeholder identity and syncScope=NONE.
   * Already-synced score rows are left as-is — the tournament simply stops
   * receiving further automatic score updates (plans/124 §4.4).
   */
  async unlinkScoreSource(sportEventId: string): Promise<void> {
    const existing = await this.requireSportEvent(sportEventId);
    this.assertAdminManaged(existing);

    await this.prisma.sportEvent.update({
      where: { id: sportEventId },
      data: {
        providerId: MANUAL_ADMIN_PROVIDER_ID,
        externalId: `manual-${randomUUID()}`,
        syncScope: SportEventSyncScope.NONE,
      },
    });

    this.logger?.info({ sportEventId }, 'Unlinked sport event score source');
  }

  private async requireSportEvent(sportEventId: string) {
    const existing = await this.prisma.sportEvent.findUnique({ where: { id: sportEventId } });
    if (!existing) {
      throw new EventScoreSourceError(`Sport event ${sportEventId} was not found.`, 'EVENT_NOT_FOUND', 404);
    }
    return existing;
  }

  private assertAdminManaged(sportEvent: { syncScope: string }): void {
    if (sportEvent.syncScope === SportEventSyncScope.FULL) {
      throw new EventScoreSourceError(
        'This sport event is provider-owned and cannot be edited through admin routes.',
        'EVENT_NOT_ADMIN_MANAGED',
        409,
      );
    }
  }
}
