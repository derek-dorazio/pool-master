/**
 * Integration: Contest Templates CRUD — create, list, get, update, delete, auth enforcement
 */
import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getApp,
  createTestUser,
  cleanupTestData,
} from '../helpers';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Templates Integration', () => {
  let ownerHeaders: Record<string, string>;
  let leagueId: string;
  let templateId: string;

  beforeAll(async () => {
    const owner = await createTestUser({ displayName: 'Template Owner' });
    ownerHeaders = owner.headers;

    // Create a league to own the templates
    const leagueRes = await getApp().inject({
      method: 'POST',
      url: '/api/v1/leagues',
      headers: ownerHeaders,
      payload: { name: 'Template Test League', visibility: 'PRIVATE' },
    });
    leagueId = leagueRes.json().league.id;
  });

  describe('POST /api/v1/templates', () => {
    it('creates a template', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/templates',
        headers: ownerHeaders,
        payload: {
          leagueId,
          name: 'Masters Pool Template',
          sport: 'GOLF',
          contestType: 'SINGLE_EVENT',
          selectionType: 'TIERED',
          scoringEngine: 'STROKE_PLAY',
          description: 'Template for golf majors',
        },
      });
      expect([200, 201]).toContain(res.statusCode);
      const body = res.json();
      const template = body.template ?? body;
      expect(template.id).toBeDefined();
      expect(template.name).toBe('Masters Pool Template');
      templateId = template.id;
    });
  });

  describe('GET /api/v1/templates', () => {
    it('lists templates', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/templates?leagueId=${leagueId}`,
        headers: ownerHeaders,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const templates = Array.isArray(body) ? body : body.templates;
      expect(templates.length).toBeGreaterThanOrEqual(1);
      const match = templates.find((t: { id: string }) => t.id === templateId);
      expect(match).toBeDefined();
    });
  });

  describe('GET /api/v1/templates/:id', () => {
    it('returns template details', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/templates/${templateId}`,
        headers: ownerHeaders,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const template = body.template ?? body;
      expect(template.id).toBe(templateId);
      expect(template.name).toBe('Masters Pool Template');
      expect(template.sport).toBe('GOLF');
      expect(template.contestType).toBe('SINGLE_EVENT');
    });
  });

  describe('PUT /api/v1/templates/:id', () => {
    it('updates the template name', async () => {
      const res = await getApp().inject({
        method: 'PUT',
        url: `/api/v1/templates/${templateId}`,
        headers: ownerHeaders,
        payload: { name: 'Updated Template' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const template = body.template ?? body;
      expect(template.name).toBe('Updated Template');
    });

    it('persists the update', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/templates/${templateId}`,
        headers: ownerHeaders,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const template = body.template ?? body;
      expect(template.name).toBe('Updated Template');
    });
  });

  describe('DELETE /api/v1/templates/:id', () => {
    it('deletes the template', async () => {
      // Strip content-type for DELETE with no body
      const { 'content-type': _, ...headersNoContentType } = ownerHeaders;
      const res = await getApp().inject({
        method: 'DELETE',
        url: `/api/v1/templates/${templateId}`,
        headers: headersNoContentType,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true });
    });

    it('template is gone after deletion', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/templates/${templateId}`,
        headers: ownerHeaders,
      });
      expect([403, 404]).toContain(res.statusCode);
    });
  });

  describe('Auth enforcement', () => {
    it('rejects template creation without auth', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/templates',
        payload: {
          leagueId,
          name: 'No Auth Template',
          sport: 'GOLF',
          contestType: 'SINGLE_EVENT',
          selectionType: 'TIERED',
          scoringEngine: 'STROKE_PLAY',
        },
      });
      expect([400, 401]).toContain(res.statusCode);
    });
  });
});
