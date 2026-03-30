/**
 * Integration: Draft templates — list and get
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

describe('Draft Templates Integration', () => {
  let headers: Record<string, string>;

  beforeAll(async () => {
    const user = await createTestUser();
    headers = user.headers;
  });

  describe('GET /api/v1/drafts/templates', () => {
    it('returns selection templates', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/drafts/templates',
        headers,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Route returns array directly
      const templates = Array.isArray(body) ? body : body.templates;
      expect(templates).toBeDefined();
      expect(templates.length).toBeGreaterThan(0);
      expect(templates[0].id).toBeDefined();
    });
  });

  describe('GET /api/v1/drafts/templates/:templateId', () => {
    it('returns a specific template', async () => {
      const listRes = await getApp().inject({
        method: 'GET',
        url: '/api/v1/drafts/templates',
        headers,
      });
      const listBody = listRes.json();
      const templates = Array.isArray(listBody) ? listBody : listBody.templates;
      const first = templates[0];

      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/drafts/templates/${first.id}`,
        headers,
      });
      expect(res.statusCode).toBe(200);
      const t = res.json();
      const template = t.template ?? t;
      expect(template.id).toBe(first.id);
    });
  });
});
