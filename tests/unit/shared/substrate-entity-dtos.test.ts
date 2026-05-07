/**
 * Defect-proof structural assertions for pool-master-rop.78.5 — substrate
 * entity DTOs and mappers per plans/117 §4.1 / §12.1.
 *
 * Pre-fix state on origin/main:
 *   - the SportEventDto / SportEventParticipantDto / SportDto schemas did
 *     not exist, OR
 *   - SportDtoSchema used `z.enum(Object.values(SportCategory) as [string, ...string[]])`
 *     which is permissive — adding a new SportCategory value would be
 *     silently accepted at the DTO boundary.
 *
 * On this branch:
 *   - all three schemas exist as pure row projections;
 *   - `category`, `tournamentFormat`, `participantType`, `sport` use
 *     `z.nativeEnum(...)` so the enum values are compile-time exhaustive.
 */

import { z } from 'zod';
import {
  ParticipantType,
  Sport,
  SportCategory,
  TournamentFormat,
} from '@poolmaster/shared/domain';
import {
  SportDtoSchema,
  SportEventDtoSchema,
  SportEventParticipantDtoSchema,
} from '@poolmaster/shared/dto/events.dto';
import { mapSportToDto } from '../../../packages/core-api/src/mappers/sports.mapper';
import { mapSportEventToDto } from '../../../packages/core-api/src/mappers/sport-events.mapper';
import { mapSportEventParticipantToDto } from '../../../packages/core-api/src/mappers/sport-event-participants.mapper';

describe('pool-master-rop.78.5 — substrate entity DTOs', () => {
  describe('SportDto', () => {
    it('uses z.nativeEnum for category / tournamentFormat / participantType (exhaustive)', () => {
      const shape = SportDtoSchema.shape;
      expect(shape.category).toBeInstanceOf(z.ZodNativeEnum);
      expect(shape.tournamentFormat).toBeInstanceOf(z.ZodNativeEnum);
      expect(shape.participantType).toBeInstanceOf(z.ZodNativeEnum);
    });

    it('rejects category values outside SportCategory at the DTO boundary', () => {
      const result = SportDtoSchema.safeParse({
        id: 's-1',
        name: 'GOLF',
        participantType: ParticipantType.INDIVIDUAL,
        category: 'NOT_A_REAL_CATEGORY',
        tournamentFormat: TournamentFormat.STROKE_PLAY_TOURNAMENT,
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-01T00:00:00.000Z',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('SportEventDto', () => {
    it('is a pure row projection — no derived operational fields', () => {
      const shape = SportEventDtoSchema.shape;
      // Pure row keys present
      expect(shape).toHaveProperty('id');
      expect(shape).toHaveProperty('externalId');
      expect(shape).toHaveProperty('providerId');
      expect(shape).toHaveProperty('sport');
      expect(shape).toHaveProperty('metadata');
      expect(shape).toHaveProperty('fieldLocked');
      // Derived fields (legacy EventSummaryDto territory) absent
      expect(shape).not.toHaveProperty('readinessStatus');
      expect(shape).not.toHaveProperty('readinessReasons');
      expect(shape).not.toHaveProperty('contestEligible');
    });

    it('uses z.nativeEnum(Sport) so adding a new sport surfaces at the DTO boundary', () => {
      const shape = SportEventDtoSchema.shape;
      expect(shape.sport).toBeInstanceOf(z.ZodNativeEnum);
    });
  });

  describe('SportEventParticipantDto', () => {
    it('uses .nullable() (not .optional()) so every key is always present', () => {
      // A row with all-null optional columns parses successfully.
      const result = SportEventParticipantDtoSchema.safeParse({
        id: 'sep-1',
        sportEventId: 'evt-1',
        participantId: 'pp-1',
        status: null,
        worldRanking: null,
        oddsToWin: null,
        seedNumber: null,
        metadata: {},
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-01T00:00:00.000Z',
      });
      expect(result.success).toBe(true);
    });

    it('rejects payloads where nullable keys are omitted (not .optional())', () => {
      const result = SportEventParticipantDtoSchema.safeParse({
        id: 'sep-1',
        sportEventId: 'evt-1',
        participantId: 'pp-1',
        // status omitted on purpose
        metadata: {},
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-01T00:00:00.000Z',
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('pool-master-rop.78.5 — entity mappers (pure projections)', () => {
  it('mapSportToDto produces a SportDto that round-trips through SportDtoSchema', () => {
    const dto = mapSportToDto({
      id: 's-1',
      name: 'GOLF',
      participantType: ParticipantType.INDIVIDUAL,
      category: SportCategory.GOLF,
      tournamentFormat: TournamentFormat.STROKE_PLAY_TOURNAMENT,
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-01T00:00:00.000Z'),
    });
    expect(SportDtoSchema.safeParse(dto).success).toBe(true);
  });

  it('mapSportEventToDto is a pure projection — no readinessStatus / contestEligible synthesis', () => {
    const dto = mapSportEventToDto({
      id: 'evt-1',
      externalId: 'masters-2026',
      providerId: 'mock-contest-feed',
      sport: Sport.GOLF,
      name: 'The Masters',
      venue: 'Augusta National',
      location: 'Augusta, GA',
      startDate: new Date('2026-04-09T00:00:00.000Z'),
      endDate: new Date('2026-04-12T00:00:00.000Z'),
      status: 'SCHEDULED',
      rounds: 4,
      participantCount: 96,
      releaseAt: new Date('2026-04-06T12:00:00.000Z'),
      fieldLocksAt: new Date('2026-04-09T00:00:00.000Z'),
      fieldLocked: false,
      metadata: { course: 'Augusta National' },
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-01T00:00:00.000Z'),
    });
    expect(SportEventDtoSchema.safeParse(dto).success).toBe(true);
    // Derived/operational fields are absent.
    expect(dto).not.toHaveProperty('readinessStatus');
    expect(dto).not.toHaveProperty('contestEligible');
  });

  it('mapSportEventParticipantToDto coerces Decimal-like oddsToWin to a plain number', () => {
    const decimalLike = { toNumber: () => 12.5 };
    const dto = mapSportEventParticipantToDto({
      id: 'sep-1',
      sportEventId: 'evt-1',
      participantId: 'pp-1',
      status: 'ACTIVE',
      worldRanking: 3,
      oddsToWin: decimalLike,
      seedNumber: null,
      metadata: {},
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-01T00:00:00.000Z'),
    });
    expect(dto.oddsToWin).toBe(12.5);
    expect(SportEventParticipantDtoSchema.safeParse(dto).success).toBe(true);
  });

  it('mapSportEventParticipantToDto preserves null when oddsToWin is null', () => {
    const dto = mapSportEventParticipantToDto({
      id: 'sep-1',
      sportEventId: 'evt-1',
      participantId: 'pp-1',
      status: null,
      worldRanking: null,
      oddsToWin: null,
      seedNumber: null,
      metadata: {},
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-01T00:00:00.000Z'),
    });
    expect(dto.oddsToWin).toBeNull();
  });
});
