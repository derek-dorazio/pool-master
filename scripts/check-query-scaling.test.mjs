import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateQueryScaling, findTestedRoutes, holdsArray, readListRoutes } from './check-query-scaling.mjs';

const json = (schema) => ({ responses: { 200: { content: { 'application/json': { schema } } } } });
const spec = {
  components: {
    schemas: {
      ContestList: { type: 'object', properties: { contests: { type: 'array', items: { $ref: '#/components/schemas/Contest' } } } },
      Contest: { type: 'object', properties: { id: { type: 'string' }, parent: { $ref: '#/components/schemas/Contest' } } },
      ContestDetail: { type: 'object', properties: { contest: { allOf: [{ $ref: '#/components/schemas/WithEvents' }] } } },
      WithEvents: { type: 'object', properties: { events: { type: 'array', items: { type: 'string' } } } },
      Plain: { type: 'object', properties: { contest: { $ref: '#/components/schemas/Contest' } } },
    },
  },
  paths: {
    '/api/v1/leagues/{id}/contests/': { get: json({ $ref: '#/components/schemas/ContestList' }) },
    '/api/v1/contests/{contestId}': { get: json({ $ref: '#/components/schemas/ContestDetail' }), delete: json({ type: 'array' }) },
    '/api/v1/contests/{contestId}/name': { get: json({ $ref: '#/components/schemas/Plain' }) },
    '/api/v1/contests/{contestId}/entries': { post: json({ type: 'array' }) },
  },
};

describe('check-query-scaling', () => {
  it('lists a GET whose response is or holds an array at any depth, and not a plain object, a self-reference or another method', () => {
    assert.deepEqual(readListRoutes(spec), ['GET /api/v1/leagues/{id}/contests/', 'GET /api/v1/contests/{contestId}']);
    assert.equal(holdsArray({ $ref: '#/components/schemas/Contest' }, spec.components.schemas), false);
  });

  it('counts a route named in a file that calls expectConstantQueries, and not one named in a file that does not', () => {
    const scaling = "await expectConstantQueries({\n  route: 'GET /api/v1/leagues/{id}/contests/',\n  seed,";
    const other = "const route: 'GET /api/v1/contests/{contestId}' = 'GET /api/v1/contests/{contestId}';";
    assert.deepEqual([...findTestedRoutes([scaling, other])], ['GET /api/v1/leagues/{id}/contests/']);
  });

  it('counts a route named in a file that calls expectFixedQueries, for a list whose length code fixes', () => {
    const fixed = "await expectFixedQueries({\n  route: 'GET /api/v1/plans/',\n  fixedBy: 'the four plans',";
    assert.deepEqual([...findTestedRoutes([fixed])], ['GET /api/v1/plans/']);
  });

  it('fails a list route that has no test, and passes once every list route has one', () => {
    const routes = readListRoutes(spec);
    const findings = evaluateQueryScaling({ routes, tested: new Set(['GET /api/v1/leagues/{id}/contests/']) });
    assert.equal(findings.length, 1);
    assert.match(findings[0].message, /GET \/api\/v1\/contests\/\{contestId\} answers with a list and has no query-scaling test/);
    assert.deepEqual(evaluateQueryScaling({ routes, tested: new Set(routes) }), []);
  });
});
