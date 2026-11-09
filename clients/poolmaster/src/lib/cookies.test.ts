import { afterEach, describe, expect, it } from 'vitest';
import { readCookie } from './cookies';

function clearCookie(name: string) {
  document.cookie = `${name}=; Path=/; Max-Age=0`;
}

describe('readCookie', () => {
  afterEach(() => {
    clearCookie('pm_test_first');
    clearCookie('pm_test_target');
    clearCookie('pm_test_empty');
  });

  it('reads the decoded value of the named cookie among several', () => {
    document.cookie = 'pm_test_first=one; Path=/';
    document.cookie = `pm_test_target=${encodeURIComponent('user 1/a')}; Path=/`;

    expect(readCookie('pm_test_target')).toBe('user 1/a');
  });

  it('answers null when the cookie is missing or set to an empty value', () => {
    document.cookie = 'pm_test_empty=; Path=/';

    expect(readCookie('pm_test_missing')).toBeNull();
    expect(readCookie('pm_test_empty')).toBeNull();
  });

  it('does not match a cookie whose name only starts with the requested name', () => {
    document.cookie = 'pm_test_targetx=wrong; Path=/';

    expect(readCookie('pm_test_target')).toBeNull();
    clearCookie('pm_test_targetx');
  });
});
