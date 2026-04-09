import { useAuthStore } from './auth-store';

describe('auth-store', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: true });
    localStorage.clear();
  });

  it('starts with no user and isLoading true', () => {
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.isLoading).toBe(true);
  });

  it('setUser sets user and marks authenticated', () => {
    useAuthStore.getState().setUser({ id: '1', email: 'a@b.com', displayName: 'Test' });
    const state = useAuthStore.getState();
    expect(state.user?.email).toBe('a@b.com');
    expect(state.isAuthenticated).toBe(true);
    expect(state.isLoading).toBe(false);
  });

  it('setUser persists auth_user to localStorage', () => {
    useAuthStore.getState().setUser({ id: '1', email: 'a@b.com', displayName: 'Test' });
    const stored = JSON.parse(localStorage.getItem('auth_user')!);
    expect(stored.email).toBe('a@b.com');
  });

  it('clearUser removes user, clears token and auth_user, marks unauthenticated', () => {
    localStorage.setItem('access_token', 'tok123');
    useAuthStore.getState().setUser({ id: '1', email: 'a@b.com', displayName: 'Test' });
    useAuthStore.getState().clearUser();
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('auth_user')).toBeNull();
  });

  it('setLoading updates isLoading', () => {
    useAuthStore.getState().setLoading(false);
    expect(useAuthStore.getState().isLoading).toBe(false);
    useAuthStore.getState().setLoading(true);
    expect(useAuthStore.getState().isLoading).toBe(true);
  });
});
