import { describe, it, expect } from 'vitest';
import i18n from '@/lib/i18n';

describe('i18n', () => {
  it('i18next is initialized', () => {
    expect(i18n.isInitialized).toBe(true);
  });

  it('default language is "en"', () => {
    expect(i18n.language).toBe('en');
  });

  it('has "common" and "auth" namespaces loaded', () => {
    const namespaces = i18n.options.ns;
    // namespaces could be an array or derived from resources
    const resourceNs = Object.keys(i18n.options.resources?.en ?? {});
    expect(resourceNs).toContain('common');
    expect(resourceNs).toContain('auth');
  });

  it('translation works: common:appName returns non-empty string', () => {
    const result = i18n.t('common:appName');
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('missing key returns the key itself as fallback', () => {
    const missingKey = 'common:thisKeyDoesNotExist';
    const result = i18n.t(missingKey);
    expect(result).toBe('thisKeyDoesNotExist');
  });

  it('has additional namespaces: dashboard, leagues, contests, settings', () => {
    const resourceNs = Object.keys(i18n.options.resources?.en ?? {});
    expect(resourceNs).toContain('dashboard');
    expect(resourceNs).toContain('leagues');
    expect(resourceNs).toContain('contests');
    expect(resourceNs).toContain('settings');
  });
});
