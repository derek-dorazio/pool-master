import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useProfile } from './use-profile';

describe('useProfile', () => {
  it('returns profile data', async () => {
    const { result } = renderHook(() => useProfile());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const profile = result.current.data!;
    expect(profile).toHaveProperty('id');
    expect(profile).toHaveProperty('email');
    expect(profile).toHaveProperty('displayName');
  });

  it('returns profile with full shape', async () => {
    const { result } = renderHook(() => useProfile());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const profile = result.current.data!;
    expect(profile).toHaveProperty('bio');
    expect(profile).toHaveProperty('avatarUrl');
    expect(profile).toHaveProperty('authProvider');
    expect(typeof profile.id).toBe('string');
    expect(typeof profile.email).toBe('string');
    expect(typeof profile.displayName).toBe('string');
  });
});
