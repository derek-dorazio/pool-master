import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as enums from '@poolmaster/shared/domain/enums';
import {
  alphabeticalOrder,
  compareByEnumOrder,
  explicitOrder,
  explicitOrderValues,
  sortByEnumOrder,
  type EnumOrder,
} from '@poolmaster/shared/domain/enum-order';
import {
  ContestStatus,
  ContestStatusOrder,
  LEAGUE_PLANS,
  LeaguePlan,
  Sport,
  SPORTS_BY_POPULARITY,
  SportEventStatus,
  SportEventStatusOrder,
  Severity,
  SeverityOrder,
} from '@poolmaster/shared/domain';

const Tone = { LOUD: 'LOUD', QUIET: 'QUIET', MIDDLE: 'MIDDLE' } as const;
type Tone = (typeof Tone)[keyof typeof Tone];
const ToneOrder = explicitOrder<Tone>({ [Tone.QUIET]: 0, [Tone.MIDDLE]: 1, [Tone.LOUD]: 2 });

describe('enum orders', () => {
  it('sorts an explicit order by each value\'s place, whatever the values are called', () => {
    expect(sortByEnumOrder([Tone.LOUD, Tone.QUIET, Tone.MIDDLE], ToneOrder)).toEqual(['QUIET', 'MIDDLE', 'LOUD']);
  });

  it('sorts an alphabetical order by the on-screen label, ignoring case, and by the value when no label is given', () => {
    const labels: Record<Tone, string> = { LOUD: 'brash', QUIET: 'Calm', MIDDLE: 'average' };
    const order: EnumOrder<Tone> = alphabeticalOrder();

    expect(sortByEnumOrder(Object.values(Tone), order, (tone) => labels[tone])).toEqual(['MIDDLE', 'LOUD', 'QUIET']);
    expect(sortByEnumOrder(Object.values(Tone), order)).toEqual(['LOUD', 'MIDDLE', 'QUIET']);
  });

  it('leaves the given array as it was', () => {
    const values: Tone[] = [Tone.LOUD, Tone.QUIET];

    sortByEnumOrder(values, ToneOrder);

    expect(values).toEqual(['LOUD', 'QUIET']);
  });

  it('compares two values as a sort callback would: negative, zero or positive', () => {
    const compare = compareByEnumOrder(ToneOrder);

    expect(compare(Tone.QUIET, Tone.LOUD)).toBeLessThan(0);
    expect(compare(Tone.LOUD, Tone.LOUD)).toBe(0);
    expect(compare(Tone.LOUD, Tone.QUIET)).toBeGreaterThan(0);
  });

  it('lists an explicit order\'s values first to last', () => {
    expect(explicitOrderValues(ToneOrder)).toEqual(['QUIET', 'MIDDLE', 'LOUD']);
  });

  it('refuses at compile time an explicit order that leaves a value without a place', () => {
    // @ts-expect-error LOUD has no place, so the order is not exhaustive over Tone.
    const partial = explicitOrder<Tone>({ [Tone.QUIET]: 0, [Tone.MIDDLE]: 1 });

    expect(partial.kind).toBe('explicit');
  });
});

/** An order's export name: `<Name>Order`, or a named priority order such as `ContestStatusOrderForHomeCurrent`. */
const ORDER_NAME = /Order(?:For[A-Z]\w*)?$/;

/**
 * Every `as const` enum object in enums.ts: string values, each equal to its own key. The orders
 * beside them are told apart by name, not by shape, so no enum is skipped for holding a member
 * an order also has.
 */
function sharedEnums(): [string, Record<string, string>][] {
  return Object.entries(enums as Record<string, unknown>).filter((entry): entry is [string, Record<string, string>] => {
    const [name, value] = entry;
    return !ORDER_NAME.test(name)
      && typeof value === 'object' && value !== null && !Array.isArray(value)
      && Object.entries(value).every(([key, member]) => key === member);
  });
}

describe('every shared enum declares its order', () => {
  const declared = enums as unknown as Record<string, unknown>;

  it.each(sharedEnums())('%s has an order beside it: a place for every value, or the alphabetical marker', (name, values) => {
    const order = declared[`${name}Order`] as EnumOrder<string> | undefined;

    expect(order).toBeDefined();
    if (order?.kind === 'explicit') {
      expect(Object.keys(order.orderIndex).sort()).toEqual(Object.values(values).sort());
      expect(new Set(Object.values(order.orderIndex)).size).toBe(Object.keys(values).length);
    } else {
      expect(order).toEqual({ kind: 'alphabetical' });
    }
  });

  it('finds the enums to check', () => {
    expect(sharedEnums().length).toBeGreaterThan(80);
  });
});

describe('the orders Derek settled (#1841)', () => {
  it('lists sports most popular first, everywhere', () => {
    expect(SPORTS_BY_POPULARITY).toEqual([
      Sport.AMERICAN_FOOTBALL, Sport.BASKETBALL, Sport.BASEBALL, Sport.HOCKEY, Sport.SOCCER, Sport.GOLF,
      Sport.AUTO_RACING, Sport.TENNIS, Sport.HORSE_RACING, Sport.CYCLING, Sport.RUNNING,
    ]);
  });

  it('puts a postponed event beside the scheduled ones and a cancelled one last', () => {
    expect(explicitOrderValues(SportEventStatusOrder)).toEqual([
      SportEventStatus.DRAFT, SportEventStatus.SCHEDULED, SportEventStatus.POSTPONED,
      SportEventStatus.IN_PROGRESS, SportEventStatus.COMPLETED, SportEventStatus.CANCELLED,
    ]);
  });

  it('orders severity from least to most severe', () => {
    expect(explicitOrderValues(SeverityOrder)).toEqual([Severity.INFO, Severity.WARNING, Severity.ERROR, Severity.CRITICAL]);
  });

  it('keeps the plans lowest first and the contest lifecycle in its order, as before', () => {
    expect(LEAGUE_PLANS).toEqual([LeaguePlan.FREE, LeaguePlan.PRO, LeaguePlan.PREMIUM, LeaguePlan.PLATINUM]);
    expect(explicitOrderValues(ContestStatusOrder)).toEqual([
      ContestStatus.DRAFT, ContestStatus.OPEN, ContestStatus.ACTIVE, ContestStatus.COMPLETED,
    ]);
  });
});

/**
 * Where a database enum's declaration order (what an SQL ORDER BY uses) differs from the shared
 * enum's order, no read sorts by it in SQL: the read sorts in code with `compareByEnumOrder`.
 */
const SORTED_IN_CODE: Readonly<Partial<Record<string, string>>> = {
  Sport: 'Sport lists and event pages sort in code (prisma-sport-catalog-repositories, prisma-event-page-repository)',
  ParticipantStatus: 'no read orders by participant status',
  MatchStatus: 'no read orders by match status',
  SportEventStatus: 'no read orders by event status',
  ValuationSource: 'no read orders by valuation source',
  EmailMessageStatus: 'no read orders by email status',
};

/** A shared enum's name in schema.prisma, where it differs from both `X` and `PrismaX`. */
const PRISMA_NAME: Readonly<Record<string, string>> = {
  FormTrend: 'PrismaParticipantFormTrend',
  MappingConfidence: 'PrismaParticipantMappingConfidence',
  InvitationStatus: 'PrismaLeagueInvitationStatus',
  InviteType: 'PrismaLeagueInviteType',
  TeamIconKey: 'PrismaSquadIconKey',
  AuthProvider: 'UserAuthProvider',
  ColorScheme: 'UserColorScheme',
  TimeFormat: 'UserTimeFormat',
};

function prismaEnums(): Map<string, string[]> {
  const schema = readFileSync(join(__dirname, '../../../packages/core-api/prisma/schema.prisma'), 'utf8');
  const found = new Map<string, string[]>();
  for (const match of schema.matchAll(/^enum (\w+) \{([^}]*)\}/gm)) {
    const values = match[2]
      .split('\n')
      .map((line) => line.trim().split(/\s/)[0])
      .filter((value) => /^[A-Z][A-Z0-9_]*$/.test(value));
    found.set(match[1], values);
  }
  return found;
}

describe('database enums declare their values in the shared order', () => {
  const declared = enums as unknown as Record<string, unknown>;
  const database = prismaEnums();
  const pairs = sharedEnums().flatMap(([name]) => {
    const order = declared[`${name}Order`] as EnumOrder<string>;
    const prismaName = [PRISMA_NAME[name], `Prisma${name}`, name].find((candidate) => candidate && database.has(candidate));
    return order.kind === 'explicit' && prismaName ? [{ name, prismaName, order }] : [];
  });

  it.each(pairs)('$prismaName matches $name\'s order, or its reads sort in code', ({ name, prismaName, order }) => {
    const inShared = explicitOrderValues(order);
    const inDatabase = database.get(prismaName) ?? [];

    expect([...inDatabase].sort()).toEqual([...inShared].sort());
    if (SORTED_IN_CODE[name] === undefined) {
      expect(inDatabase).toEqual(inShared);
    } else {
      expect(inDatabase).not.toEqual(inShared);
    }
  });

  it('pairs most explicit enums with their database enum', () => {
    expect(pairs.length).toBeGreaterThan(25);
  });
});
