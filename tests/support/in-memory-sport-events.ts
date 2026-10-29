/**
 * An in-memory implementation of the event-core, golf and race extension ports (#236, #622), for
 * service tests that assert what a service leaves behind rather than which repository
 * calls it made (testing-rules §1D, the plan's test layering). The Prisma adapters
 * behind the same ports are tested against Postgres in sport-event-repositories.integration.
 *
 * Deliberately simple: ids are sequential, "all or none" writes validate every row
 * before applying any, and orderings follow each port's documented contract.
 */

import type {
  SportEventParticipantStatLineRepository,
  GolfRoundWrite,
  GolfStandingWrite,
  EventSeriesRepository,
  ParticipantLeagueAffiliationRepository,
  ParticipantProviderMappingRepository,
  ParticipantRepository,
  SportEventCreate,
  SportEventParticipantCreate,
  SportEventParticipantGolfRoundRepository,
  SportEventParticipantGolfStandingRepository,
  SportEventParticipantPatch,
  SportEventParticipantRaceResultRepository,
  SportEventParticipantRepository,
  SportEventParticipantRoundRepository,
  SportEventParticipantStandingRepository,
  SportEventParticipantValuationRepository,
  SportEventMatchRepository,
  SportEventRepository,
  SportEventRoundRepository,
  SportEventTierRepository,
  SportEventUpdate,
  SportLeagueRepository,
  SportRepository,
} from '@poolmaster/shared/db';
import type { SportEventBracketServiceDeps } from '../../packages/core-api/src/modules/events/sport-event-bracket-service';
import { MatchEnding, BracketAdvancement, findSportRow, MatchSide, MatchStatus, ParticipantInactiveReason, ParticipantStatus, ValuationSource } from '@poolmaster/shared/domain';
import type {
  SportEventParticipantStatLine,
  GolfRoundResult,
  GolfStandingResult,
  Participant,
  ParticipantLeagueAffiliation,
  ParticipantProviderMapping,
  SportConfig,
  SportEvent,
  SportEventMatch,
  SportEventParticipant,
  SportEventParticipantGolfRound,
  SportEventParticipantGolfStanding,
  SportEventParticipantRaceResult,
  SportEventParticipantRound,
  SportEventParticipantStanding,
  SportEventParticipantValuation,
  SportEventRound,
  SportEventTier,
  SportLeague,
} from '@poolmaster/shared/domain';

const T0 = new Date('2026-01-01T00:00:00.000Z');

function stamp<T extends object>(row: T): T & { createdAt: Date; updatedAt: Date } {
  return { createdAt: T0, updatedAt: T0, ...row };
}

function nullable<T>(value: T | null | undefined): T | undefined {
  return value === null ? undefined : value;
}

/** The picks side of the bracket service (#720) for an event no entry has picked: no spread is ever locked. */
export const NO_PICKS_ON_EVENT: Pick<SportEventBracketServiceDeps, 'predictions'> = {
  predictions: { hasAnyOnMatch: async () => false },
};

export class InMemorySportEvents {
  private sequence = 0;
  sports: SportConfig[] = [];
  sportLeagues: SportLeague[] = [];
  participants: Participant[] = [];
  mappings: ParticipantProviderMapping[] = [];
  affiliationRows: Array<Omit<ParticipantLeagueAffiliation, 'participant'>> = [];
  eventSeriesRows: Array<{ id: string; sportLeagueId: string; name: string; isActive: boolean }> = [];
  events: SportEvent[] = [];
  contestsByEvent = new Map<string, number>();
  picksByEntry = new Map<string, number>();
  roundRows: SportEventRound[] = [];
  field: SportEventParticipant[] = [];
  tierRows: SportEventTier[] = [];
  valuationRows: SportEventParticipantValuation[] = [];
  participantRoundRows: Array<Omit<SportEventParticipantRound, 'roundNumber'>> = [];
  standingRows: SportEventParticipantStanding[] = [];
  golfRoundRows: SportEventParticipantGolfRound[] = [];
  golfStandingRows: SportEventParticipantGolfStanding[] = [];
  raceResultRows: SportEventParticipantRaceResult[] = [];
  statLineRows: SportEventParticipantStatLine[] = [];
  matchRows: SportEventMatch[] = [];

  id(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  // --- Fixtures ---------------------------------------------------------------------

  addSport(sport: SportConfig['sport']): SportConfig {
    const row: SportConfig = stamp({ id: this.id('sport'), sport, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' });
    this.sports.push(row);
    return row;
  }

  addSportLeague(sportId: string, name = 'PGA Tour'): SportLeague {
    const sportLeague = stamp({ id: this.id('sport-league'), sportId, name, matchKeyword: null, bracketAdvancement: BracketAdvancement.FIXED, roundNames: [], tierCount: null, matchPeriodLayout: null, squaresFromRound: null, noun: null, displayName: null, displayOrder: null, participantType: null, scoringFamily: null, currentEventYear: null, isActive: true });
    this.sportLeagues.push(sportLeague);
    return sportLeague;
  }

  addParticipant(sportId: string, name: string, overrides: Partial<Participant> = {}): Participant {
    const participant = stamp({
      id: this.id('participant'), sportId, name, participantType: 'INDIVIDUAL', status: 'ACTIVE',
      injuryStatus: { status: 'HEALTHY' }, externalIds: {}, ...overrides,
    }) as Participant;
    this.participants.push(participant);
    return participant;
  }

  affiliate(sportLeagueId: string, participantId: string, ranking: number | null = null): void {
    this.affiliationRows.push(stamp({ id: this.id('affiliation'), sportLeagueId, participantId, ranking }));
  }

  /**
   * An event, by default an edition of a series of its own on a placeholder sport league.
   * Pass `sportLeagueId` (and `eventSeriesId`, `eventYear`) to place it on a real one.
   */
  addEvent(overrides: Partial<SportEvent> = {}): SportEvent {
    const event = stamp({
      id: this.id('event'), externalId: 'ext', providerId: 'manual-admin', sport: 'GOLF', name: 'Open',
      eventSeriesId: this.id('event-series'), eventYear: 2026, sportLeagueId: 'sport-league-unplaced',
      startDate: new Date('2026-06-04T12:00:00.000Z'), status: 'SCHEDULED',
      metadata: {}, syncScope: 'NONE', autoLifecycleEnabled: true, ...overrides,
    }) as SportEvent;
    this.events.push(event);
    return event;
  }

  addToField(sportEventId: string, participantId: string, overrides: Partial<SportEventParticipant> = {}): SportEventParticipant {
    const entry = stamp({ id: this.id('sep'), sportEventId, participantId, isActive: true, isPlayInPlace: false, metadata: {}, ...overrides });
    this.field.push(entry);
    return entry;
  }

  roundNumberOf(sportEventRoundId: string): number {
    return this.roundRows.find((round) => round.id === sportEventRoundId)?.roundNumber ?? 0;
  }

  // --- Ports ---------------------------------------------------------------------------

  sportRepo(): SportRepository {
    return {
      findById: async (id) => this.sports.find((sport) => sport.id === id) ?? null,
      findBySport: async (sport) => findSportRow(this.sports, sport) ?? null,
      findAll: async () => [...this.sports],
    };
  }

  sportLeagueRepo(): SportLeagueRepository {
    return {
      findById: async (id) => this.sportLeagues.find((row) => row.id === id) ?? null,
      findAll: async (filters) => this.sportLeagues.filter((row) => (
        (filters.sportId === undefined || row.sportId === filters.sportId)
        && (filters.isActive === undefined || row.isActive === filters.isActive)
      )),
      findBySportAndName: async (sportId, name) => this.sportLeagues.find((row) => row.sportId === sportId && row.name === name) ?? null,
      create: async (input) => {
        const created = stamp({ id: this.id('sport-league'), ...input, roundNames: [], tierCount: null, matchPeriodLayout: null, squaresFromRound: null, noun: null, displayName: null, displayOrder: null, participantType: null, scoringFamily: null, currentEventYear: null, isActive: true });
        this.sportLeagues.push(created);
        return created;
      },
      update: async (id, updates) => {
        const row = this.sportLeagues.find((candidate) => candidate.id === id) as SportLeague;
        Object.assign(row, Object.fromEntries(Object.entries<unknown>(updates).filter(([, value]) => value !== undefined)));
        return row;
      },
    };
  }

  participantRepo(): ParticipantRepository {
    return {
      findById: async (id) => this.participants.find((row) => row.id === id) ?? null,
      findByIds: async (ids) => this.participants.filter((row) => ids.includes(row.id)),
      search: async () => [...this.participants],
      findMatching: async (sportId, query) => this.participants.filter((row) => (
        row.sportId === sportId
        && (query.id === undefined || row.id === query.id)
        && (query.externalId === undefined || row.externalId === query.externalId)
        && (query.name === undefined || row.name.toLowerCase() === query.name.toLowerCase())
      )),
      create: async () => { throw new Error('not used'); },
      update: async () => { throw new Error('not used'); },
    };
  }

  mappingRepo(): ParticipantProviderMappingRepository {
    return {
      findByParticipant: async (participantId) => this.mappings.filter((row) => row.participantId === participantId),
      findByProviderExternalIds: async (providerId, externalIds) => this.mappings.filter((row) => row.providerId === providerId && externalIds.includes(row.externalId)),
      bind: async (mapping) => {
        this.mappings = this.mappings.filter((row) => !(row.providerId === mapping.providerId && row.externalId === mapping.externalId));
        const row = stamp({ id: this.id('mapping'), ...mapping });
        this.mappings.push(row);
        return row;
      },
    };
  }

  affiliationRepo(): ParticipantLeagueAffiliationRepository {
    const withParticipant = (row: Omit<ParticipantLeagueAffiliation, 'participant'>): ParticipantLeagueAffiliation => ({
      ...row,
      participant: this.participants.find((participant) => participant.id === row.participantId) as Participant,
    });
    return {
      findBySportLeague: async (sportLeagueId) => this.affiliationRows
        .filter((row) => row.sportLeagueId === sportLeagueId)
        .sort((left, right) => (left.ranking ?? Infinity) - (right.ranking ?? Infinity))
        .map(withParticipant),
      find: async (sportLeagueId, participantId) => {
        const row = this.affiliationRows.find((candidate) => candidate.sportLeagueId === sportLeagueId && candidate.participantId === participantId);
        return row ? withParticipant(row) : null;
      },
      create: async (sportLeagueId, participantId) => {
        const row = stamp({ id: this.id('affiliation'), sportLeagueId, participantId, ranking: null });
        this.affiliationRows.push(row);
        return withParticipant(row);
      },
      delete: async (sportLeagueId, participantId) => {
        this.affiliationRows = this.affiliationRows.filter((row) => !(row.sportLeagueId === sportLeagueId && row.participantId === participantId));
      },
      updateRankings: async () => undefined,
      upsertRankings: async () => undefined,
      countBySportLeagues: async (ids) => new Map(ids.map((id) => [id, this.affiliationRows.filter((row) => row.sportLeagueId === id).length])),
    };
  }

  eventSeriesRepo(): EventSeriesRepository {
    return {
      findOrCreate: async (sportLeagueId, name) => {
        let row = this.eventSeriesRows.find((candidate) => candidate.sportLeagueId === sportLeagueId && candidate.name === name);
        if (!row) {
          row = { id: this.id('event-series'), sportLeagueId, name, isActive: true };
          this.eventSeriesRows.push(row);
        }
        return stamp(row);
      },
    };
  }

  sportEventRepo(): SportEventRepository {
    const count = (ids: readonly string[], of: (id: string) => number) => new Map(ids.map((id) => [id, of(id)]));
    return {
      findById: async (id) => this.events.find((row) => row.id === id) ?? null,
      findByIds: async (ids) => this.events.filter((row) => ids.includes(row.id)),
      findByProviderRef: async (providerId, externalId) => this.events.find((row) => row.providerId === providerId && row.externalId === externalId) ?? null,
      // No sport filter: every event is golf while Sport has one member.
      findAll: async (filters) => this.events.filter((row) => (
        (filters.statuses === undefined || filters.statuses.includes(row.status))
        && (filters.sportLeagueId === undefined || row.sportLeagueId === filters.sportLeagueId)
        && (filters.eventYear === undefined || row.eventYear === filters.eventYear)
        && (filters.q === undefined || row.name.toLowerCase().includes(filters.q.toLowerCase()))
        && (!filters.releasedOnly || row.status !== 'DRAFT')
        && (filters.startsFrom === undefined || row.startDate >= filters.startsFrom)
        && (filters.startsBefore === undefined || row.startDate < filters.startsBefore)
      )),
      findEventYears: async (sportLeagueId, options) => [...new Set(this.events
        .filter((row) => row.sportLeagueId === sportLeagueId && (!options.releasedOnly || row.status !== 'DRAFT'))
        .map((row) => row.eventYear))].sort((left, right) => left - right),
      create: async (input: SportEventCreate) => {
        // The database's one-edition-per-year constraint, raised the way Prisma raises it.
        if (this.events.some((row) => row.eventSeriesId === input.eventSeriesId && row.eventYear === input.eventYear)) {
          throw Object.assign(new Error('Unique constraint failed'), {
            code: 'P2002',
            meta: { target: ['event_series_id', 'event_year'] },
          });
        }
        const series = this.eventSeriesRows.find((row) => row.id === input.eventSeriesId);
        return this.addEvent({ ...input, sportLeagueId: series?.sportLeagueId ?? 'sport-league-unplaced', metadata: {} });
      },
      update: async (id, updates: SportEventUpdate) => {
        const row = this.events.find((candidate) => candidate.id === id) as SportEvent;
        for (const [key, value] of Object.entries(updates)) {
          if (value !== undefined) (row as unknown as Record<string, unknown>)[key] = nullable(value);
        }
        return row;
      },
      delete: async (id) => {
        const entryIds = new Set(this.field.filter((row) => row.sportEventId === id).map((row) => row.id));
        this.field = this.field.filter((row) => row.sportEventId !== id);
        this.valuationRows = this.valuationRows.filter((row) => !entryIds.has(row.sportEventParticipantId));
        this.roundRows = this.roundRows.filter((row) => row.sportEventId !== id);
        this.tierRows = this.tierRows.filter((row) => row.sportEventId !== id);
        this.events = this.events.filter((row) => row.id !== id);
      },
      countParticipants: async (ids) => count(ids, (id) => this.field.filter((row) => row.sportEventId === id).length),
      countUntieredActiveParticipants: async (ids) => count(ids, (id) => this.field.filter((row) => (
        row.sportEventId === id
        && row.isActive
        && !this.valuationRows.some((valuation) => valuation.sportEventParticipantId === row.id && valuation.sportEventTierId)
      )).length),
      countUnpricedActiveParticipants: async (ids) => count(ids, (id) => this.field.filter((row) => (
        row.sportEventId === id
        && row.isActive
        && !this.valuationRows.some((valuation) => valuation.sportEventParticipantId === row.id && valuation.price !== null)
      )).length),
      countTiers: async (ids) => count(ids, (id) => this.tierRows.filter((row) => row.sportEventId === id).length),
      findEmptyTierLabels: async (ids) => new Map(ids.map((id) => [id, this.tierRows
        .filter((tier) => tier.sportEventId === id && !this.valuationRows.some((valuation) => (
          valuation.sportEventTierId === tier.id
          && this.field.some((row) => row.id === valuation.sportEventParticipantId && row.isActive)
        )))
        .sort((left, right) => left.tierNumber - right.tierNumber)
        .map((tier) => tier.label)])),
      countContests: async (ids) => count(ids, (id) => this.contestsByEvent.get(id) ?? 0),
      countBySportLeagues: async (ids, filters = {}) => count(ids, (id) => this.events.filter((row) => (
        row.sportLeagueId === id && (filters.eventYear === undefined || row.eventYear === filters.eventYear)
      )).length),
      sportLeagueHasLoadedBracket: async (sportLeagueId) => this.matchRows.some((match) => (
        this.events.some((event) => event.id === match.sportEventId && event.sportLeagueId === sportLeagueId)
      )),
      summarizeByProviders: async (providerIds) => new Map(providerIds.map((providerId) => {
        const events = this.events.filter((row) => row.providerId === providerId);
        const changed = events.map((row) => row.updatedAt.getTime());
        return [providerId, {
          activeEventCount: events.filter((row) => row.status === 'SCHEDULED' || row.status === 'IN_PROGRESS').length,
          lastChangedAt: changed.length > 0 ? new Date(Math.max(...changed)) : null,
        }];
      })),
      findAutoLifecycleCandidates: async () => this.events.filter((row) => (
        row.autoLifecycleEnabled
        && (row.status === 'SCHEDULED' || row.status === 'IN_PROGRESS')
      )),
    };
  }

  roundRepo(): SportEventRoundRepository {
    return {
      findBySportEvent: async (sportEventId) => this.roundRows
        .filter((row) => row.sportEventId === sportEventId)
        .sort((left, right) => left.roundNumber - right.roundNumber),
      findBySportEvents: async (sportEventIds) => new Map(sportEventIds.map((sportEventId) => [
        sportEventId,
        this.roundRows
          .filter((row) => row.sportEventId === sportEventId)
          .sort((left, right) => left.roundNumber - right.roundNumber),
      ])),
      createMany: async (sportEventId, rounds) => {
        for (const round of rounds) {
          this.roundRows.push(stamp({ id: this.id('round'), sportEventId, roundNumber: round.roundNumber, scheduledDate: round.scheduledDate, scheduledEndAt: round.scheduledEndAt ?? null }));
        }
      },
      reschedule: async (sportEventId, rounds) => {
        if (rounds.some((round) => !this.roundRows.some((row) => row.sportEventId === sportEventId && row.roundNumber === round.roundNumber))) {
          throw new Error('unknown round');
        }
        for (const round of rounds) {
          const row = this.roundRows.find((candidate) => candidate.sportEventId === sportEventId && candidate.roundNumber === round.roundNumber) as SportEventRound;
          row.scheduledDate = round.scheduledDate;
          if (round.scheduledEndAt !== undefined) row.scheduledEndAt = round.scheduledEndAt;
        }
      },
      findOrCreate: async (sportEventId, roundNumber) => {
        let row = this.roundRows.find((candidate) => candidate.sportEventId === sportEventId && candidate.roundNumber === roundNumber);
        if (!row) {
          row = stamp({ id: this.id('round'), sportEventId, roundNumber, scheduledDate: T0, scheduledEndAt: null });
          this.roundRows.push(row);
        }
        return row;
      },
    };
  }

  fieldRepo(): SportEventParticipantRepository {
    const apply = (row: SportEventParticipant, patch: SportEventParticipantPatch) => {
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) (row as unknown as Record<string, unknown>)[key] = nullable(value);
      }
    };
    const setPrice = (id: string, price: number | null) => {
      let valuation = this.valuationRows.find((row) => row.sportEventParticipantId === id);
      if (!valuation) {
        valuation = stamp({ id: this.id('valuation'), sportEventParticipantId: id, sportEventTierId: null, tierOrderIndex: null, tierAssignedSource: null, price: null, priceAssignedSource: null });
        this.valuationRows.push(valuation);
      }
      valuation.price = price;
      valuation.priceAssignedSource = 'MANUAL';
    };
    return {
      findById: async (id) => this.field.find((row) => row.id === id) ?? null,
      findBySportEvent: async (sportEventId) => this.field
        .filter((row) => row.sportEventId === sportEventId)
        .sort((left, right) => (left.seedNumber ?? Infinity) - (right.seedNumber ?? Infinity)),
      countDistinctParticipants: async (sportEventIds) => new Set(this.field
        .filter((row) => sportEventIds.includes(row.sportEventId))
        .map((row) => row.participantId)).size,
      createMany: async (sportEventId, rows: readonly SportEventParticipantCreate[]) => {
        for (const { participantId, ...patch } of rows) {
          apply(this.addToField(sportEventId, participantId), patch);
        }
      },
      updateMany: async (entries) => {
        if (entries.some((entry) => !this.field.some((row) => row.id === entry.id))) {
          throw new Error('unknown field row');
        }
        for (const entry of entries) {
          apply(this.field.find((row) => row.id === entry.id) as SportEventParticipant, entry.updates);
          if (entry.price !== undefined) setPrice(entry.id, entry.price);
        }
      },
      delete: async (id) => {
        this.field = this.field.filter((row) => row.id !== id);
        this.valuationRows = this.valuationRows.filter((row) => row.sportEventParticipantId !== id);
      },
      countPicks: async (id) => this.picksByEntry.get(id) ?? 0,
      fillPlayInSlot: async ({ id, winnerParticipantId, pairingParticipantId }) => {
        const row = this.field.find((entry) => entry.id === id);
        const pairing = this.participants.find((participant) => participant.id === pairingParticipantId);
        if (!row || !pairing) throw new Error('unknown field row or participant');
        row.participantId = winnerParticipantId;
        row.isPlayInPlace = false;
        pairing.status = ParticipantStatus.INACTIVE;
      },
      replaceWithdrawn: async ({ withdrawnId, matchId, side, replacementParticipantId, valuation }) => {
        const withdrawn = this.field.find((entry) => entry.id === withdrawnId);
        const match = this.matchRows.find((row) => row.id === matchId);
        if (!withdrawn || !match) throw new Error('unknown field row or match');
        withdrawn.isActive = false;
        withdrawn.inactiveReason = ParticipantInactiveReason.WITHDRAWN;
        const replacement = this.addToField(withdrawn.sportEventId, replacementParticipantId);
        if (valuation) {
          this.valuationRows.push(stamp({
            id: this.id('valuation'),
            sportEventParticipantId: replacement.id,
            sportEventTierId: valuation.sportEventTierId,
            tierOrderIndex: valuation.tierOrderIndex,
            tierAssignedSource: valuation.sportEventTierId === null ? null : ValuationSource.MANUAL,
            price: valuation.price,
            priceAssignedSource: valuation.price === null ? null : ValuationSource.MANUAL,
          }));
        }
        if (side === MatchSide.HOME) match.homeSportEventParticipantId = replacement.id;
        else match.awaySportEventParticipantId = replacement.id;
        return replacement.id;
      },
    };
  }

  tierRepo(): SportEventTierRepository {
    return {
      findBySportEvent: async (sportEventId) => this.tierRows
        .filter((row) => row.sportEventId === sportEventId)
        .sort((left, right) => left.tierNumber - right.tierNumber),
      createMany: async (sportEventId, tiers) => {
        for (const tier of tiers) this.tierRows.push(stamp({ id: this.id('tier'), sportEventId, ...tier }));
      },
      replace: async (sportEventId, tiers, reassignTo) => {
        const existing = this.tierRows.filter((row) => row.sportEventId === sportEventId);
        const keep = new Set(tiers.map((tier) => tier.tierKey));
        for (const tier of tiers) {
          const row = existing.find((candidate) => candidate.tierKey === tier.tierKey);
          if (row) Object.assign(row, tier);
          else this.tierRows.push(stamp({ id: this.id('tier'), sportEventId, ...tier }));
        }
        const removed = new Set(existing.filter((row) => !keep.has(row.tierKey)).map((row) => row.id));
        const target = this.tierRows.find((row) => row.sportEventId === sportEventId && row.tierKey === reassignTo);
        for (const valuation of this.valuationRows) {
          if (valuation.sportEventTierId && removed.has(valuation.sportEventTierId)) {
            valuation.sportEventTierId = target?.id ?? null;
            valuation.tierOrderIndex = null;
          }
        }
        this.tierRows = this.tierRows.filter((row) => !removed.has(row.id));
      },
      countValuations: async (sportEventId) => new Map(this.tierRows
        .filter((row) => row.sportEventId === sportEventId)
        .map((tier) => [tier.id, this.valuationRows.filter((valuation) => valuation.sportEventTierId === tier.id).length])),
    };
  }

  valuationRepo(): SportEventParticipantValuationRepository {
    const valuationFor = (sportEventParticipantId: string) => {
      let row = this.valuationRows.find((candidate) => candidate.sportEventParticipantId === sportEventParticipantId);
      if (!row) {
        row = stamp({ id: this.id('valuation'), sportEventParticipantId, sportEventTierId: null, tierOrderIndex: null, tierAssignedSource: null, price: null, priceAssignedSource: null });
        this.valuationRows.push(row);
      }
      return row;
    };
    return {
      findBySportEvent: async (sportEventId) => {
        const entryIds = new Set(this.field.filter((row) => row.sportEventId === sportEventId).map((row) => row.id));
        return this.valuationRows.filter((row) => entryIds.has(row.sportEventParticipantId));
      },
      assignTiers: async (assignments) => {
        for (const assignment of assignments) {
          Object.assign(valuationFor(assignment.sportEventParticipantId), {
            sportEventTierId: assignment.sportEventTierId,
            tierOrderIndex: assignment.tierOrderIndex,
            tierAssignedSource: assignment.source,
          });
        }
      },
      assignEventPrices: async ({ sportEventId, pricingConfig, assignments }) => {
        for (const assignment of assignments) {
          Object.assign(valuationFor(assignment.sportEventParticipantId), { price: assignment.price, priceAssignedSource: assignment.source });
        }
        Object.assign(this.events.find((row) => row.id === sportEventId) as SportEvent, { pricingConfig });
      },
    };
  }

  participantRoundRepo(): SportEventParticipantRoundRepository {
    const withNumber = (row: Omit<SportEventParticipantRound, 'roundNumber'>): SportEventParticipantRound => ({ ...row, roundNumber: this.roundNumberOf(row.sportEventRoundId) });
    return {
      findBySportEvent: async (sportEventId) => {
        const entryIds = new Set(this.field.filter((row) => row.sportEventId === sportEventId).map((row) => row.id));
        return this.participantRoundRows.filter((row) => entryIds.has(row.sportEventParticipantId)).map(withNumber)
          .sort((left, right) => left.roundNumber - right.roundNumber);
      },
    };
  }

  standingRepo(): SportEventParticipantStandingRepository {
    return {
      findBySportEvent: async (sportEventId) => {
        const entryIds = new Set(this.field.filter((row) => row.sportEventId === sportEventId).map((row) => row.id));
        return this.standingRows.filter((row) => entryIds.has(row.sportEventParticipantId));
      },
    };
  }

  // Reads and writes hand back copies, as a database does: a caller holding an earlier read
  // must not see it change under a later write.
  private golfRoundResults(): GolfRoundResult[] {
    return this.participantRoundRows.flatMap((row) => {
      const golf = this.golfRoundRows.find((candidate) => candidate.participantRoundId === row.id);
      return golf ? [{ participantRound: { ...row, roundNumber: this.roundNumberOf(row.sportEventRoundId) }, golf: { ...golf } }] : [];
    }).sort((left, right) => left.participantRound.roundNumber - right.participantRound.roundNumber);
  }

  private golfStandingResults(): GolfStandingResult[] {
    return this.standingRows.flatMap((standing) => {
      const golf = this.golfStandingRows.find((candidate) => candidate.standingId === standing.id);
      return golf ? [{ standing: { ...standing }, golf: { ...golf } }] : [];
    });
  }

  private writeGolfRound(write: GolfRoundWrite): GolfRoundResult {
    let core = this.participantRoundRows.find((row) => row.sportEventParticipantId === write.sportEventParticipantId && row.sportEventRoundId === write.sportEventRoundId);
    if (!core) {
      core = stamp({ id: this.id('participant-round'), sportEventParticipantId: write.sportEventParticipantId, sportEventRoundId: write.sportEventRoundId, status: write.status, completedAt: write.completedAt });
      this.participantRoundRows.push(core);
    }
    Object.assign(core, { status: write.status, completedAt: write.completedAt });
    let golf = this.golfRoundRows.find((row) => row.participantRoundId === core.id);
    if (!golf) {
      golf = stamp({ id: this.id('golf-round'), participantRoundId: core.id, strokes: 0, scoreToPar: 0, thru: null });
      this.golfRoundRows.push(golf);
    }
    Object.assign(golf, { strokes: write.strokes, scoreToPar: write.scoreToPar, thru: write.thru });
    return { participantRound: { ...core, roundNumber: this.roundNumberOf(core.sportEventRoundId) }, golf: { ...golf } };
  }

  golfRoundRepo(): SportEventParticipantGolfRoundRepository {
    return {
      findBySportEvent: async (sportEventId) => {
        const entryIds = new Set(this.field.filter((row) => row.sportEventId === sportEventId).map((row) => row.id));
        return this.golfRoundResults().filter((result) => entryIds.has(result.participantRound.sportEventParticipantId));
      },
      findBySportEventRound: async (id) => this.golfRoundResults().filter((result) => result.participantRound.sportEventRoundId === id),
      findBySportEventParticipants: async (ids) => this.golfRoundResults().filter((result) => ids.includes(result.participantRound.sportEventParticipantId)),
      upsert: async (write) => this.writeGolfRound(write),
      upsertMany: async (writes) => {
        if (writes.some((write) => !this.field.some((row) => row.id === write.sportEventParticipantId))) {
          throw new Error('unknown field row');
        }
        for (const write of writes) this.writeGolfRound(write);
      },
    };
  }

  golfStandingRepo(): SportEventParticipantGolfStandingRepository {
    return {
      findBySportEvent: async (sportEventId) => {
        const entryIds = new Set(this.field.filter((row) => row.sportEventId === sportEventId).map((row) => row.id));
        return this.golfStandingResults().filter((result) => entryIds.has(result.standing.sportEventParticipantId));
      },
      findBySportEventParticipants: async (ids) => this.golfStandingResults().filter((result) => ids.includes(result.standing.sportEventParticipantId)),
      upsert: async (write: GolfStandingWrite) => {
        let standing = this.standingRows.find((row) => row.sportEventParticipantId === write.sportEventParticipantId);
        if (!standing) {
          standing = stamp({ id: this.id('standing'), sportEventParticipantId: write.sportEventParticipantId, position: null, displayPosition: null, status: write.status, asOf: write.asOf, currentRound: write.currentRound });
          this.standingRows.push(standing);
        }
        Object.assign(standing, { status: write.status, asOf: write.asOf, currentRound: write.currentRound });
        let golf = this.golfStandingRows.find((row) => row.standingId === standing.id);
        if (!golf) {
          golf = stamp({ id: this.id('golf-standing'), standingId: standing.id, eventScoreToPar: 0, eventStrokes: 0, currentRoundThru: null });
          this.golfStandingRows.push(golf);
        }
        Object.assign(golf, { eventScoreToPar: write.eventScoreToPar, eventStrokes: write.eventStrokes, currentRoundThru: write.currentRoundThru });
        return { standing: { ...standing }, golf: { ...golf } };
      },
      updateRanks: async (ranks) => {
        for (const rank of ranks) {
          const standing = this.standingRows.find((row) => row.id === rank.standingId);
          if (!standing) throw new Error('unknown standing');
          Object.assign(standing, { position: rank.position, displayPosition: rank.displayPosition });
        }
      },
    };
  }

  matchRepo(): SportEventMatchRepository {
    const findBySportEvents = async (sportEventIds: readonly string[]) => this.matchRows
      .filter((row) => sportEventIds.includes(row.sportEventId))
      .sort((left, right) => left.sportEventId.localeCompare(right.sportEventId) || left.matchNumber - right.matchNumber)
      .map((row) => ({ ...row, periodScores: [...row.periodScores].sort((left, right) => left.periodNumber - right.periodNumber) }));
    const requireRow = (id: string) => {
      const row = this.matchRows.find((match) => match.id === id);
      if (!row) throw new Error('unknown match');
      return row;
    };
    return {
      findBySportEvent: async (sportEventId) => findBySportEvents([sportEventId]),
      findBySportEvents,
      replaceBracket: async (sportEventId, matches) => {
        const roundNumbers = new Set(this.roundRows.filter((round) => round.sportEventId === sportEventId).map((round) => round.roundNumber));
        if (matches.some((match) => !roundNumbers.has(match.roundNumber))) throw new Error('unknown round');
        this.matchRows = [
          ...this.matchRows.filter((row) => row.sportEventId !== sportEventId),
          ...matches.map((match) => stamp({
            ...match,
            sportEventId,
            homeSpread: null,
            periodScores: [],
            status: MatchStatus.SCHEDULED,
            winnerSide: null,
            homeScore: null,
            awayScore: null,
            homeShootoutScore: null,
            awayShootoutScore: null, ending: MatchEnding.PLAYED,
          })),
        ];
      },
      placeSides: async (sides) => {
        for (const { id, ...placed } of sides) {
          const row = this.matchRows.find((match) => match.id === id);
          if (!row) throw new Error('unknown match');
          Object.assign(row, placed);
        }
      },
      update: async (id, patch) => {
        const row = this.matchRows.find((match) => match.id === id);
        if (!row) throw new Error('unknown match');
        Object.assign(row, Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)));
      },
      applyResult: async ({ result, sideFill, standings }) => {
        const { id, ...values } = result;
        const row = this.matchRows.find((match) => match.id === id);
        if (!row) throw new Error('unknown match');
        Object.assign(row, values);
        if (sideFill) {
          const next = this.matchRows.find((match) => match.id === sideFill.id);
          if (!next) throw new Error('unknown match');
          if (sideFill.side === MatchSide.HOME) next.homeSportEventParticipantId = sideFill.sportEventParticipantId;
          else next.awaySportEventParticipantId = sideFill.sportEventParticipantId;
        }
        for (const { sportEventParticipantId, ...standing } of standings) {
          let stored = this.standingRows.find((candidate) => candidate.sportEventParticipantId === sportEventParticipantId);
          if (!stored) {
            stored = stamp({ id: this.id('standing'), sportEventParticipantId, ...standing });
            this.standingRows.push(stored);
          }
          Object.assign(stored, standing);
        }
      },
      savePeriodScore: async (sportEventMatchId, score) => {
        const row = requireRow(sportEventMatchId);
        row.periodScores = [...row.periodScores.filter((other) => other.periodNumber !== score.periodNumber), { ...score }];
      },
      deletePeriodScore: async (sportEventMatchId, periodNumber) => {
        const row = requireRow(sportEventMatchId);
        row.periodScores = row.periodScores.filter((other) => other.periodNumber !== periodNumber);
      },
    };
  }

  statLineRepo(): SportEventParticipantStatLineRepository {
    return {
      findBySportEvent: async (sportEventId) => {
        const entryIds = new Set(this.field.filter((row) => row.sportEventId === sportEventId).map((row) => row.id));
        const roundIds = new Set(this.participantRoundRows.filter((row) => entryIds.has(row.sportEventParticipantId)).map((row) => row.id));
        return this.statLineRows.filter((row) => roundIds.has(row.participantRoundId)).map((row) => ({ ...row }));
      },
      replaceGameLines: async (writes) => {
        for (const { sportEventParticipantId, sportEventRoundId, stats, completedAt } of writes) {
          let core = this.participantRoundRows.find((row) => row.sportEventParticipantId === sportEventParticipantId && row.sportEventRoundId === sportEventRoundId);
          if (core) {
            const roundId = core.id;
            this.statLineRows = this.statLineRows.filter((row) => row.participantRoundId !== roundId);
          }
          if (stats.length === 0) {
            this.participantRoundRows = this.participantRoundRows.filter((row) => row !== core);
            continue;
          }
          if (!core) {
            core = stamp({ id: this.id('participant-round'), sportEventParticipantId, sportEventRoundId, status: 'COMPLETED' as const, completedAt });
            this.participantRoundRows.push(core);
          }
          Object.assign(core, { status: 'COMPLETED', completedAt });
          const roundId = core.id;
          this.statLineRows.push(...stats.map(({ stat, value }) => stamp({ id: this.id('stat-line'), participantRoundId: roundId, stat, value })));
        }
      },
    };
  }

  raceResultRepo(): SportEventParticipantRaceResultRepository {
    const entryIdsOf = (sportEventId: string) => new Set(this.field.filter((row) => row.sportEventId === sportEventId).map((row) => row.id));
    return {
      findBySportEvent: async (sportEventId) => {
        const entryIds = entryIdsOf(sportEventId);
        return this.raceResultRows
          .filter((row) => entryIds.has(row.sportEventParticipantId))
          .sort((left, right) => left.sportEventParticipantId.localeCompare(right.sportEventParticipantId))
          .map((row) => ({ ...row }));
      },
      applyResults: async (sportEventId, { results, isOfficial, standings }) => {
        const entryIds = entryIdsOf(sportEventId);
        if ([...results, ...standings].some((write) => !entryIds.has(write.sportEventParticipantId))) {
          throw new Error('unknown field row');
        }
        for (const { sportEventParticipantId, ...values } of results) {
          let row = this.raceResultRows.find((candidate) => candidate.sportEventParticipantId === sportEventParticipantId);
          if (!row) {
            row = stamp({ id: this.id('race-result'), sportEventParticipantId, ...values, isOfficial });
            this.raceResultRows.push(row);
          }
          Object.assign(row, values);
        }
        for (const row of this.raceResultRows) {
          if (entryIds.has(row.sportEventParticipantId)) row.isOfficial = isOfficial;
        }
        for (const { sportEventParticipantId, ...values } of standings) {
          let standing = this.standingRows.find((row) => row.sportEventParticipantId === sportEventParticipantId);
          if (!standing) {
            standing = stamp({ id: this.id('standing'), sportEventParticipantId, ...values });
            this.standingRows.push(standing);
          }
          Object.assign(standing, values);
        }
      },
    };
  }
}
