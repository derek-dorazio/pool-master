import { shouldDeliver, getEventCategory, getDefaultPreferences } from '../../../packages/core-api/src/modules/notifications/core/preference-service';
import type { UserPreferences } from '../../../packages/core-api/src/modules/notifications/core/preference-service';

describe('PreferenceService', () => {
  describe('getEventCategory', () => {
    it('maps draft events to DRAFT category', () => {
      expect(getEventCategory('draft.on_the_clock')).toBe('DRAFT');
    });

    it('maps scoring events to SCORING category', () => {
      expect(getEventCategory('scoring.taken_the_lead')).toBe('SCORING');
    });

    it('maps contest events to CONTEST category', () => {
      expect(getEventCategory('contest.you_won')).toBe('CONTEST');
    });

    it('defaults to ACCOUNT for unknown prefixes', () => {
      expect(getEventCategory('unknown.event')).toBe('ACCOUNT');
    });
  });

  describe('shouldDeliver', () => {
    it('always delivers IN_APP regardless of preferences', () => {
      const prefs: UserPreferences = {
        doNotDisturb: true,
        categories: { DRAFT: { enabled: false, channels: { push: false, email: false, in_app: false, sms: false } } },
      };
      expect(shouldDeliver('draft.on_the_clock', 'IN_APP', prefs)).toBe(true);
    });

    it('blocks PUSH when DND is on', () => {
      const prefs: UserPreferences = { doNotDisturb: true, categories: {} };
      expect(shouldDeliver('draft.on_the_clock', 'PUSH', prefs)).toBe(false);
    });

    it('blocks when category is disabled', () => {
      const prefs: UserPreferences = {
        doNotDisturb: false,
        categories: { SCORING: { enabled: false, channels: { push: true, email: true, in_app: true, sms: false } } },
      };
      expect(shouldDeliver('scoring.taken_the_lead', 'PUSH', prefs)).toBe(false);
    });

    it('blocks when channel is disabled in category', () => {
      const prefs: UserPreferences = {
        doNotDisturb: false,
        categories: { DRAFT: { enabled: true, channels: { push: false, email: true, in_app: true, sms: false } } },
      };
      expect(shouldDeliver('draft.on_the_clock', 'PUSH', prefs)).toBe(false);
      expect(shouldDeliver('draft.on_the_clock', 'EMAIL', prefs)).toBe(true);
    });

    it('uses defaults when no preferences set', () => {
      // Draft defaults: push=true, email=true
      expect(shouldDeliver('draft.on_the_clock', 'PUSH', undefined)).toBe(true);
      expect(shouldDeliver('draft.on_the_clock', 'EMAIL', undefined)).toBe(true);

      // League defaults: push=false, email=false
      expect(shouldDeliver('league.member_joined', 'PUSH', undefined)).toBe(false);
      expect(shouldDeliver('league.member_joined', 'EMAIL', undefined)).toBe(false);
    });
  });

  describe('getDefaultPreferences', () => {
    it('returns all 6 categories', () => {
      const defaults = getDefaultPreferences();
      expect(Object.keys(defaults)).toHaveLength(6);
      expect(defaults.DRAFT).toBeDefined();
      expect(defaults.SCORING).toBeDefined();
      expect(defaults.CONTEST).toBeDefined();
      expect(defaults.LEAGUE).toBeDefined();
      expect(defaults.SOCIAL).toBeDefined();
      expect(defaults.ACCOUNT).toBeDefined();
    });

    it('has all categories enabled by default', () => {
      const defaults = getDefaultPreferences();
      for (const cat of Object.values(defaults)) {
        expect(cat.enabled).toBe(true);
      }
    });
  });
});
