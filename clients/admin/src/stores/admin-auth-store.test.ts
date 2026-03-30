import { useAdminAuthStore } from './admin-auth-store';
import type { AdminUser } from './admin-auth-store';

const mockAdmin: AdminUser = {
  id: 'admin-1',
  email: 'derek@poolmaster.dev',
  name: 'Derek Dorazio',
  role: 'SUPER_ADMIN',
  permissions: ['manage_tenants', 'manage_users', 'manage_flags'],
};

describe('admin-auth-store', () => {
  beforeEach(() => {
    useAdminAuthStore.setState({ adminUser: null, isAuthenticated: false, isLoading: true });
    localStorage.clear();
  });

  it('starts with no user and isLoading true', () => {
    const state = useAdminAuthStore.getState();
    expect(state.adminUser).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.isLoading).toBe(true);
  });

  it('setAdminUser sets user with role and permissions', () => {
    useAdminAuthStore.getState().setAdminUser(mockAdmin);
    const state = useAdminAuthStore.getState();
    expect(state.adminUser?.email).toBe('derek@poolmaster.dev');
    expect(state.adminUser?.role).toBe('SUPER_ADMIN');
    expect(state.adminUser?.permissions).toContain('manage_tenants');
    expect(state.isAuthenticated).toBe(true);
    expect(state.isLoading).toBe(false);
  });

  it('clearAdminUser removes user and clears token', () => {
    localStorage.setItem('admin_token', 'tok456');
    useAdminAuthStore.getState().setAdminUser(mockAdmin);
    useAdminAuthStore.getState().clearAdminUser();
    const state = useAdminAuthStore.getState();
    expect(state.adminUser).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(localStorage.getItem('admin_token')).toBeNull();
  });

  it('setLoading updates isLoading', () => {
    useAdminAuthStore.getState().setLoading(false);
    expect(useAdminAuthStore.getState().isLoading).toBe(false);
  });
});
