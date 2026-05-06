/**
 * Unit tests for `mapLeagueAuditEntryToDto` (pool-master-rop.14.1).
 *
 * The mapper sits at the route boundary between `AuditLogEntry` (service shape,
 * `Date` createdAt, optional fields as `field?: T`) and `LeagueAuditEntryDto`
 * (wire shape, ISO-string createdAt, optional fields omitted when `undefined`).
 *
 * Each optional field's spread path is exercised independently — Riley flagged
 * the optional-spread branches as 0% covered when the mapper landed without
 * tests.
 */

import type { AuditLogEntry } from '../../../packages/core-api/src/modules/leagues/audit-service';
import { mapLeagueAuditEntryToDto } from '../../../packages/core-api/src/mappers/leagues-audit.mapper';

describe('pool-master-rop.14.1 mapLeagueAuditEntryToDto', () => {
  function baseEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
    return {
      id: 'audit-1',
      leagueId: 'league-1',
      actorId: 'user-1',
      action: 'league.member.role.changed',
      category: 'MEMBER',
      description: 'Promoted member to commissioner',
      createdAt: new Date('2026-05-04T18:30:00.000Z'),
      ...overrides,
    };
  }

  it('pool-master-rop.14.1: maps required fields and converts Date → ISO string', () => {
    const dto = mapLeagueAuditEntryToDto(baseEntry());
    expect(dto.id).toBe('audit-1');
    expect(dto.leagueId).toBe('league-1');
    expect(dto.actorId).toBe('user-1');
    expect(dto.action).toBe('league.member.role.changed');
    expect(dto.category).toBe('MEMBER');
    expect(dto.description).toBe('Promoted member to commissioner');
    expect(dto.createdAt).toBe('2026-05-04T18:30:00.000Z');
  });

  it('pool-master-rop.14.1: omits contestId when service entry has no contest scope', () => {
    const dto = mapLeagueAuditEntryToDto(baseEntry());
    expect(dto).not.toHaveProperty('contestId');
  });

  it('pool-master-rop.14.1: includes contestId when set', () => {
    const dto = mapLeagueAuditEntryToDto(
      baseEntry({ contestId: 'contest-1', category: 'CONTEST' }),
    );
    expect(dto.contestId).toBe('contest-1');
  });

  it('pool-master-rop.14.1: omits beforeState/afterState/reason/ipAddress when undefined', () => {
    const dto = mapLeagueAuditEntryToDto(baseEntry());
    expect(dto).not.toHaveProperty('beforeState');
    expect(dto).not.toHaveProperty('afterState');
    expect(dto).not.toHaveProperty('reason');
    expect(dto).not.toHaveProperty('ipAddress');
  });

  it('pool-master-rop.14.1: passes beforeState and afterState through unchanged (intentionally opaque snapshots)', () => {
    const before = { name: 'Old Team', isActive: true } as Record<string, unknown>;
    const after = { name: 'New Team', isActive: true } as Record<string, unknown>;
    const dto = mapLeagueAuditEntryToDto(
      baseEntry({ beforeState: before, afterState: after }),
    );
    // Same shape, not a deep clone — the mapper passes the reference through.
    expect(dto.beforeState).toBe(before);
    expect(dto.afterState).toBe(after);
  });

  it('pool-master-rop.14.1: includes reason and ipAddress when set', () => {
    const dto = mapLeagueAuditEntryToDto(
      baseEntry({ reason: 'Operational fix', ipAddress: '127.0.0.1' }),
    );
    expect(dto.reason).toBe('Operational fix');
    expect(dto.ipAddress).toBe('127.0.0.1');
  });

  it('pool-master-rop.14.1: covers every AuditCategory value the service emits', () => {
    const categories: AuditLogEntry['category'][] = [
      'LEAGUE',
      'CONTEST',
      'DRAFT',
      'SCORING',
      'PAYOUT',
      'MEMBER',
      'COMMUNICATION',
    ];
    for (const category of categories) {
      const dto = mapLeagueAuditEntryToDto(baseEntry({ category }));
      expect(dto.category).toBe(category);
    }
  });
});
