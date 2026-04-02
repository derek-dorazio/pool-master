/**
 * MSW request handlers for admin app tests.
 */
import { http, HttpResponse } from 'msw';

export const handlers = [
  // Health
  http.get('/api/v1/admin/health/services', () => {
    return HttpResponse.json({ services: [] });
  }),

  // Tenants
  http.get('/api/v1/admin/tenants', () => {
    return HttpResponse.json({ tenants: [], total: 0 });
  }),

  // Users
  http.get('/api/v1/admin/users', () => {
    return HttpResponse.json({ users: [], total: 0 });
  }),

  // Flags
  http.get('/api/v1/admin/flags', () => {
    return HttpResponse.json({ flags: [] });
  }),

  // Announcements
  http.get('/api/v1/admin/announcements', () => {
    return HttpResponse.json({ announcements: [] });
  }),

  // Config
  http.get('/api/v1/config', () => {
    return HttpResponse.json({ sports: [], features: {} });
  }),

  // Contests
  http.get('/api/v1/contests', () => {
    return HttpResponse.json({ contests: [] });
  }),

  // Billing
  http.get('/api/v1/billing/plans', () => {
    return HttpResponse.json({ plans: [] });
  }),

  // Auth
  http.post('/api/v1/auth/login', () => {
    return HttpResponse.json({
      user: { id: 'admin-1', email: 'admin@test.com', displayName: 'Admin' },
      tokens: { accessToken: 'test-token', refreshToken: 'test-rt', expiresIn: 900 },
    });
  }),
];
