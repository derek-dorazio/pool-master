import {
  ALL_COMMISSIONER_PERMISSIONS,
  DEFAULT_COMMISSIONER_PERMISSIONS,
  hasPermission,
  hasAnyPermission,
  isCommissioner,
  canManageMembers,
} from '../../../packages/core-api/src/core/permissions';
import { CommissionerPermission, LeagueRole } from '@poolmaster/shared/domain';
import { buildMembership } from '../../factories';

describe('Commissioner Permissions', () => {
  describe('ALL_COMMISSIONER_PERMISSIONS', () => {
    it('contains all 23 permission values', () => {
      expect(ALL_COMMISSIONER_PERMISSIONS).toHaveLength(23);
    });

    it('includes league.settings.edit', () => {
      expect(ALL_COMMISSIONER_PERMISSIONS).toContain('league.settings.edit');
    });

    it('includes scoring.override', () => {
      expect(ALL_COMMISSIONER_PERMISSIONS).toContain('scoring.override');
    });
  });

  describe('DEFAULT_COMMISSIONER_PERMISSIONS', () => {
    it('includes invite and contest create', () => {
      expect(DEFAULT_COMMISSIONER_PERMISSIONS).toContain(
        CommissionerPermission.LEAGUE_MEMBERS_INVITE,
      );
      expect(DEFAULT_COMMISSIONER_PERMISSIONS).toContain(CommissionerPermission.CONTEST_CREATE);
    });
  });

  describe('hasPermission', () => {
    it('returns true for COMMISSIONER with the permission', () => {
      const commissioner = buildMembership({
        role: LeagueRole.COMMISSIONER,
        permissions: [CommissionerPermission.LEAGUE_SETTINGS_EDIT],
      });
      expect(hasPermission(commissioner, CommissionerPermission.LEAGUE_SETTINGS_EDIT)).toBe(true);
    });

    it('returns false for COMMISSIONER without the permission', () => {
      const commissioner = buildMembership({
        role: LeagueRole.COMMISSIONER,
        permissions: [CommissionerPermission.LEAGUE_SETTINGS_EDIT],
      });
      expect(hasPermission(commissioner, CommissionerPermission.SCORING_OVERRIDE)).toBe(false);
    });

    it('returns false for MEMBER', () => {
      const member = buildMembership({ role: LeagueRole.MEMBER });
      expect(hasPermission(member, CommissionerPermission.LEAGUE_SETTINGS_EDIT)).toBe(false);
    });
  });

  describe('hasAnyPermission', () => {
    it('returns true if at least one permission matches', () => {
      const commissioner = buildMembership({
        role: LeagueRole.COMMISSIONER,
        permissions: [CommissionerPermission.CONTEST_CREATE],
      });
      expect(
        hasAnyPermission(commissioner, [
          CommissionerPermission.LEAGUE_SETTINGS_EDIT,
          CommissionerPermission.CONTEST_CREATE,
        ]),
      ).toBe(true);
    });

    it('returns false if no permissions match', () => {
      const commissioner = buildMembership({
        role: LeagueRole.COMMISSIONER,
        permissions: [CommissionerPermission.CONTEST_CREATE],
      });
      expect(
        hasAnyPermission(commissioner, [CommissionerPermission.SCORING_OVERRIDE]),
      ).toBe(false);
    });
  });

  describe('isCommissioner', () => {
    it('returns true for COMMISSIONER', () => {
      expect(isCommissioner(buildMembership({ role: LeagueRole.COMMISSIONER }))).toBe(true);
    });

    it('returns false for MEMBER', () => {
      expect(isCommissioner(buildMembership({ role: LeagueRole.MEMBER }))).toBe(false);
    });
  });

  describe('canManageMembers', () => {
    it('returns true for COMMISSIONER with invite permission', () => {
      const commissioner = buildMembership({
        role: LeagueRole.COMMISSIONER,
        permissions: [CommissionerPermission.LEAGUE_MEMBERS_INVITE],
      });
      expect(canManageMembers(commissioner)).toBe(true);
    });

    it('returns false for COMMISSIONER without member permissions', () => {
      const commissioner = buildMembership({
        role: LeagueRole.COMMISSIONER,
        permissions: [CommissionerPermission.CONTEST_CREATE],
      });
      expect(canManageMembers(commissioner)).toBe(false);
    });
  });
});
