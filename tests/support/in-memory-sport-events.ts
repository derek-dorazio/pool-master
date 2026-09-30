/**
 * An in-memory implementation of the event-core and golf extension ports (#236), for
 * service tests that assert what a service leaves behind rather than which repository
 * calls it made (testing-rules §1D, the plan's test layering). The Prisma adapters
 * behind the same ports are tested against Postgres in sport-event-repositories.integration.
 *
 * Deliberately simple: ids are sequential, "all or none" writes validate every row
 * before applying any, and orderings follow each port's documented contract.
 */

import type {
  GolfRoundWrite,
  GolfStandingWrite,
  LeagueEventRepository,
  ParticipantLeagueAffiliationRepository,
  ParticipantProviderMappingRepository,
  ParticipantRepository,
  SeasonRepository,
  SportEventCreate,
  SportEventParticipantCreate,
  SportEventParticipantGolfRoundRepository,
  SportEventParticipantGolfStandingRepository,
  SportEventParticipantPatch,
  SportEventParticipantRepository,
  SportEventParticipantRoundRepository,
  SportEventParticipantStandingRepository,
  SportEventParticipantValuationRepository,
  SportEventRepository,
  SportEventRoundRepository,
  SportEventTierRepository,
  SportEventUpdate,
  SportLeagueRepository,
  SportRepository,
} from '@poolmaster/shared/db';
import type {
  GolfRoundResult,
  GolfStandingResult,
  Participant,
  ParticipantLeagueAffiliation,
  ParticipantProviderMapping,
  Season,
  SportConfig,
  SportEvent,
  SportEventParticipant,
  SportEventParticipantGolfRound,
  SportEventParticipantGolfStanding,
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

export class InMemorySportEvents {
  private sequence = 0;
  sports: SportConfig[] = [];
  sportLeagues: SportLeague[] = [];
  seasons: Season[] = [];
  participants: Participant[] = [];
  mappings: ParticipantProviderMapping[] = [];
  affiliationRows: Array<Omit<ParticipantLeagueAffiliation, 'participant'>> = [];
  leagueEventRows: Array<{ id: string; sportLeagueId: string; name: string }> = [];
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

  id(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  // --- Fixtures ---------------------------------------------------------------------

  addSport(name: SportConfig['name']): SportConfig {
    const sport = stamp({ id: this.id('sport'), name, participantType: 'INDIVIDUAL', category: 'GOLF', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' }) as SportConfig;
    this.sports.push(sport);
    return sport;
  }

  addSportLeague(sportId: string, name = 'PGA Tour'): SportLeague {
    const sportLeague = stamp({ id: this.id('sport-league'), sportId, name, matchKeyword: null, currentSeasonId: null, isActive: true });
    this.sportLeagues.push(sportLeague);
    return sportLeague;
  }

  addSeason(sportLeagueId: string, year = 2026): Season {
    const season = stamp({
      id: this.id('season'), sportLeagueId, name: `Season ${year}`, year,
      startDate: new Date(`${year}-01-01T00:00:00.000Z`), endDate: new Date(`${year}-12-31T00:00:00.000Z`), isActive: true,
    });
    this.seasons.push(season);
    return season;
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

  addEvent(overrides: Partial<SportEvent> = {}): SportEvent {
    const event = stamp({
      id: this.id('event'), externalId: 'ext', providerId: 'manual-admin', sport: 'GOLF', name: 'Open',
      startDate: new Date('2026-06-04T12:00:00.000Z'), status: 'SCHEDULED', fieldLocked: false,
      releaseAt: new Date('2026-05-21T12:00:00.000Z'), fieldLocksAt: new Date('2026-06-03T12:00:00.000Z'),
      metadata: {}, syncScope: 'NONE', autoLifecycleEnabled: true, ...overrides,
    }) as SportEvent;
    this.events.push(event);
    return event;
  }

  addToField(sportEventId: string, participantId: string, overrides: Partial<SportEventParticipant> = {}): SportEventParticipant {
    const entry = stamp({ id: this.id('sep'), sportEventId, participantId, isActive: true, metadata: {}, ...overrides });
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
      findByName: async (name) => this.sports.find((sport) => sport.name === name) ?? null,
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
        const created = stamp({ id: this.id('sport-league'), ...input, currentSeasonId: null, isActive: true });
        this.sportLeagues.push(created);
        return created;
      },
      update: async (id, updates) => {
        const row = this.sportLeagues.find((candidate) => candidate.id === id) as SportLeague;
        Object.assign(row, Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined)));
        return row;
      },
    };
  }

  seasonRepo(): SeasonRepository {
    return {
      findById: async (id) => this.seasons.find((row) => row.id === id) ?? null,
      findAll: async (filters) => this.seasons.filter((row) => (
        (filters.sportLeagueId === undefined || row.sportLeagueId === filters.sportLeagueId)
        && (filters.isActive === undefined || row.isActive === filters.isActive)
      )).sort((left, right) => right.year - left.year),
      findBySportLeagueAndYear: async (sportLeagueId, year) => this.seasons.find((row) => row.sportLeagueId === sportLeagueId && row.year === year) ?? null,
      create: async (input) => {
        const created = stamp({ id: this.id('season'), ...input, isActive: true });
        this.seasons.push(created);
        return created;
      },
      update: async (id, updates) => {
        const row = this.seasons.find((candidate) => candidate.id === id) as Season;
        Object.assign(row, Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined)));
        return row;
      },
      countBySportLeagues: async (ids) => new Map(ids.map((id) => [id, this.seasons.filter((row) => row.sportLeagueId === id).length])),
    };
  }

  participantRepo(): ParticipantRepository {
    return {
      findById: async (id) => this.participants.find((row) => row.id === id) ?? null,
      findByIds: async (ids) => this.participants.filter((row) => ids.includes(row.id)),
      findBySport: async (sportId) => this.participants.filter((row) => row.sportId === sportId),
      findByExternalId: async () => null,
      search: async () => [...this.participants],
      findMatching: async (sportId, query) => this.participants.filter((row) => (
        row.sportId === sportId
        && (query.id === undefined || row.id === query.id)
        && (query.externalId === undefined || row.externalId === query.externalId)
        && (query.name === undefined || row.name.toLowerCase() === query.name.toLowerCase())
      )),
      create: async () => { throw new Error('not used'); },
      createMany: async () => 0,
      update: async () => { throw new Error('not used'); },
    };
  }

  mappingRepo(): ParticipantProviderMappingRepository {
    return {
      findByProvider: async (providerId, externalId) => this.mappings.find((row) => row.providerId === providerId && row.externalId === externalId) ?? null,
      findByParticipant: async (participantId) => this.mappings.filter((row) => row.participantId === participantId),
      findByParticipants: async (ids) => this.mappings.filter((row) => ids.includes(row.participantId)),
      findByProviderExternalIds: async (providerId, externalIds) => this.mappings.filter((row) => row.providerId === providerId && externalIds.includes(row.externalId)),
      create: async () => { throw new Error('not used'); },
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

  leagueEventRepo(): LeagueEventRepository {
    return {
      findOrCreate: async (sportLeagueId, name) => {
        let row = this.leagueEventRows.find((candidate) => candidate.sportLeagueId === sportLeagueId && candidate.name === name);
        if (!row) {
          row = { id: this.id('league-event'), sportLeagueId, name };
          this.leagueEventRows.push(row);
        }
        return stamp(row);
      },
    };
  }

  sportEventRepo(): SportEventRepository {
    const count = (ids: readonly string[], of: (id: string) => number) => new Map(ids.map((id) => [id, of(id)]));
    return {
      findById: async (id) => this.events.find((row) => row.id === id) ?? null,
      findByProviderRef: async (providerId, externalId) => this.events.find((row) => row.providerId === providerId && row.externalId === externalId) ?? null,
      findAll: async (filters) => this.events.filter((row) => (
        (filters.sport === undefined || row.sport === filters.sport)
        && (filters.status === undefined || row.status === filters.status)
        && (filters.seasonId === undefined || row.seasonId === filters.seasonId)
        && (filters.q === undefined || row.name.toLowerCase().includes(filters.q.toLowerCase()))
      )),
      create: async (input: SportEventCreate) => this.addEvent({ ...input, metadata: {}, fieldLocked: false }),
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
      countTiers: async (ids) => count(ids, (id) => this.tierRows.filter((row) => row.sportEventId === id).length),
      countContests: async (ids) => count(ids, (id) => this.contestsByEvent.get(id) ?? 0),
      countBySeasons: async (ids) => count(ids, (id) => this.events.filter((row) => row.seasonId === id).length),
      summarizeByProviders: async (providerIds) => new Map(providerIds.map((providerId) => {
        const events = this.events.filter((row) => row.providerId === providerId);
        const changed = events.map((row) => row.updatedAt.getTime());
        return [providerId, {
          activeEventCount: events.filter((row) => row.status === 'SCHEDULED' || row.status === 'IN_PROGRESS').length,
          lastChangedAt: changed.length > 0 ? new Date(Math.max(...changed)) : null,
        }];
      })),
      countFieldRecords: async (ids) => new Map(ids.map((id) => {
        const entryIds = new Set(this.field.filter((row) => row.sportEventId === id).map((row) => row.id));
        return [id, {
          valuations: this.valuationRows.filter((row) => entryIds.has(row.sportEventParticipantId)).length,
          rounds: this.participantRoundRows.filter((row) => entryIds.has(row.sportEventParticipantId)).length,
          picks: [...entryIds].reduce((sum, entryId) => sum + (this.picksByEntry.get(entryId) ?? 0), 0),
        }];
      })),
      findAutoLifecycleCandidates: async () => this.events.filter((row) => (
        row.autoLifecycleEnabled
        && row.syncScope !== 'FULL'
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
      create: async (row) => this.addToField(row.sportEventId, row.participantId, row),
      update: async (id, updates) => {
        const row = this.field.find((candidate) => candidate.id === id) as SportEventParticipant;
        Object.assign(row, updates);
        return row;
      },
      createMany: async (sportEventId, rows: readonly SportEventParticipantCreate[]) => {
        for (const { participantId, ...patch } of rows) {
          apply(this.addToField(sportEventId, participantId), patch);
        }
      },
      upsertMany: async (sportEventId, rows) => {
        for (const { participantId, ...patch } of rows) {
          const row = this.field.find((candidate) => candidate.sportEventId === sportEventId && candidate.participantId === participantId)
            ?? this.addToField(sportEventId, participantId);
          apply(row, patch);
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
      assignPrices: async (assignments) => {
        for (const assignment of assignments) {
          Object.assign(valuationFor(assignment.sportEventParticipantId), { price: assignment.price, priceAssignedSource: assignment.source });
        }
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
      findBySportEventParticipant: async (id) => this.participantRoundRows.filter((row) => row.sportEventParticipantId === id).map(withNumber),
      findBySportEventRound: async (id) => this.participantRoundRows.filter((row) => row.sportEventRoundId === id).map(withNumber),
    };
  }

  standingRepo(): SportEventParticipantStandingRepository {
    return {
      findBySportEvent: async (sportEventId) => {
        const entryIds = new Set(this.field.filter((row) => row.sportEventId === sportEventId).map((row) => row.id));
        return this.standingRows.filter((row) => entryIds.has(row.sportEventParticipantId));
      },
      findBySportEventParticipant: async (id) => this.standingRows.find((row) => row.sportEventParticipantId === id) ?? null,
    };
  }

  private golfRoundResults(): GolfRoundResult[] {
    return this.participantRoundRows.flatMap((row) => {
      const golf = this.golfRoundRows.find((candidate) => candidate.participantRoundId === row.id);
      return golf ? [{ participantRound: { ...row, roundNumber: this.roundNumberOf(row.sportEventRoundId) }, golf }] : [];
    }).sort((left, right) => left.participantRound.roundNumber - right.participantRound.roundNumber);
  }

  private golfStandingResults(): GolfStandingResult[] {
    return this.standingRows.flatMap((standing) => {
      const golf = this.golfStandingRows.find((candidate) => candidate.standingId === standing.id);
      return golf ? [{ standing, golf }] : [];
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
    return { participantRound: { ...core, roundNumber: this.roundNumberOf(core.sportEventRoundId) }, golf };
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
        return { standing, golf };
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
}
