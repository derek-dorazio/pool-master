import { z } from 'zod';
import {
  ContestEntryStatus,
  Sport,
  contestEntryEventStatus,
  extendRules,
  findSportRow,
  isUrlSegment,
} from '@poolmaster/shared/domain';
import { UpdateContestEntryRequestSchema } from '../../../packages/shared/dto';

// Small shared rules web and API both lean on (#1477): each one's answer for the input it was
// written for and for the input it turns away.

describe('findSportRow', () => {
  it('finds the row carrying the sport, and none when no row carries it', () => {
    const rows = [{ sport: Sport.GOLF, label: 'golf' }, { sport: Sport.BASEBALL, label: 'baseball' }];

    expect(findSportRow(rows, Sport.BASEBALL)?.label).toBe('baseball');
    expect(findSportRow(rows, Sport.TENNIS)).toBeUndefined();
  });
});

describe('isUrlSegment', () => {
  it('accepts lower case words and digits joined by single dashes and refuses capitals, doubled dashes, an end dash and an empty segment', () => {
    expect(isUrlSegment('championship-weekend')).toBe(true);
    expect(isUrlSegment('Championship-Weekend')).toBe(false);
    expect(isUrlSegment('championship--weekend')).toBe(false);
    expect(isUrlSegment('weekend-')).toBe(false);
    expect(isUrlSegment('')).toBe(false);
    expect(isUrlSegment('formula-1')).toBe(true);
  });
});

describe('extendRules', () => {
  it('keeps the rules description on the extended schema, and adds none to rules that had none', () => {
    const described = extendRules(z.object({ a: z.number() }).describe('Rules A.'), { b: z.string() });
    const plain = extendRules(z.object({ a: z.number() }), { b: z.string() });

    expect(described.description).toBe('Rules A.');
    expect(plain.description).toBeUndefined();
    expect(plain.parse({ a: 1, b: 'x' })).toEqual({ a: 1, b: 'x' });
  });
});

describe('contestEntryEventStatus', () => {
  it('reads the entry status for the event, and DRAFT for an event the entry has no row for', () => {
    const entry = { events: [{ sportEventId: 'week-1', status: ContestEntryStatus.SUBMITTED }] };

    expect(contestEntryEventStatus(entry, 'week-1')).toBe(ContestEntryStatus.SUBMITTED);
    expect(contestEntryEventStatus(entry, 'week-2')).toBe(ContestEntryStatus.DRAFT);
  });
});

describe('UpdateContestEntryRequestSchema', () => {
  it('accepts a name alone or a tiebreaker alone, and refuses a body that changes neither', () => {
    expect(UpdateContestEntryRequestSchema.safeParse({ name: 'Eagles' }).success).toBe(true);
    expect(UpdateContestEntryRequestSchema.safeParse({ tiebreakerValue: null }).success).toBe(true);

    const neither = UpdateContestEntryRequestSchema.safeParse({});
    expect(neither.success).toBe(false);
    expect(neither.error?.issues[0]?.message).toBe('At least one contest entry field must be provided.');
  });
});
