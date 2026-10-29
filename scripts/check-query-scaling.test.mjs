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

  it('fails a list route that has neither a test nor a gap entry', () => {
    const findings = evaluateQueryScaling({ routes: readListRoutes(spec), tested: new Set(['GET /api/v1/leagues/{id}/contests/']), gaps: [] });
    assert.equal(findings.length, 1);
    assert.match(findings[0].message, /GET \/api\/v1\/contests\/\{contestId\} answers with a list and has no query-scaling test/);
  });

  it('passes a list route on the gap list, and fails the entry once the route has a test', () => {
    const routes = readListRoutes(spec);
    const gaps = [{ route: 'GET /api/v1/contests/{contestId}', ticket: 1248 }];
    assert.deepEqual(evaluateQueryScaling({ routes, tested: new Set(['GET /api/v1/leagues/{id}/contests/']), gaps }), []);
    const fixed = evaluateQueryScaling({ routes, tested: new Set(routes), gaps });
    assert.equal(fixed.length, 1);
    assert.match(fixed[0].message, /has a scaling test now; delete its entry/);
  });

  it('fails an entry that names no list route, and a list longer than the ceiling', () => {
    const routes = readListRoutes(spec);
    const gaps = [
      { route: 'GET /api/v1/contests/{contestId}', ticket: 1248 },
      { route: 'GET /api/v1/contests/{contestId}/name', ticket: 1248 },
    ];
    const findings = evaluateQueryScaling({ routes, tested: new Set(['GET /api/v1/leagues/{id}/contests/']), gaps, ceiling: 1 });
    assert.deepEqual(findings.map((finding) => finding.message.split('.')[0]), [
      '2 gaps are listed, over the ceiling of 1',
      'GET /api/v1/contests/{contestId}/name is listed but is not a GET route that answers with a list; delete its entry',
    ]);
  });
});
