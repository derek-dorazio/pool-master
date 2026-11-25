import { afterEach, describe, expect, it } from 'vitest';
import { forgetSignedInUserId, getLastSignedInUserId, rememberSignedInUserId } from './signed-in-user';

describe('the signed-in account cookie', () => {
  afterEach(() => forgetSignedInUserId());

  it('remembers which account last signed in, across reads', () => {
    rememberSignedInUserId('user 1');

    expect(getLastSignedInUserId()).toBe('user 1');
  });

  it('forgets the account on an explicit sign-out', () => {
    rememberSignedInUserId('user-1');

    forgetSignedInUserId();

    expect(getLastSignedInUserId()).toBeNull();
  });
});
