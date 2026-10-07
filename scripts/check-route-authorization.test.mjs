import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import {
  API_ENTRY,
  collectParameterizedRoutes,
  evaluateRoutes,
  hasPathParameter,
  joinPath,
  readModuleRoutes,
  readMounts,
} from './check-route-authorization.mjs';

// #193: the contest by-id module as main had it — three routes with no hook beside four gated
// lifecycle routes and an entry route that authorizes in its service.
const contestsModuleOnMain = `
export function contestsByIdModule(fastify: FastifyInstance): void {
  const requireContestCommissioner = requireCommissionerForContest(contestRepo, membershipRepo);
  fastify.get('/:contestId', { schema: {}, handler: handlers.getContest });
  fastify.patch('/:contestId/entries/:entryId', { schema: {}, handler: handlers.updateEntry });
  fastify.put('/:contestId', { schema: {}, handler: handlers.updateContest });
  fastify.delete('/:contestId', { schema: {}, handler: handlers.deleteContest });
  fastify.post('/:contestId/close', {
    schema: {},
    preHandler: requireContestCommissioner,
    handler: overrides.closeContest,
  });
}
`;

const entryOptOut = {
  route: 'PATCH /api/v1/contests/:contestId/entries/:entryId',
  reason: 'Needs the entry id: ContestService.updateEntry scopes the lookup to the caller\'s squad.',
};

function byIdRoutes(moduleText, exportName = 'contestsByIdModule', prefix = '/api/v1/contests') {
  return readModuleRoutes(moduleText, exportName).routes
    .filter((route) => hasPathParameter(route.path))
    .map((route) => ({
      method: route.method,
      fullPath: joinPath(prefix, route.path),
      gated: route.gated,
      location: `routes.ts:${route.line}`,
    }));
}

function messages(findings) {
  return findings.map((finding) => finding.message);
}

describe('check-route-authorization (#193)', () => {
  it('flags every by-id route with neither a hook nor an opt-out — the three #193 found on main', () => {
    const findings = evaluateRoutes({ routes: byIdRoutes(contestsModuleOnMain), optOuts: [entryOptOut] });
    assert.deepEqual(
      findings.map((finding) => finding.message.split(' authorizes nowhere')[0]),
      [
        '`GET /api/v1/contests/:contestId`',
        '`PUT /api/v1/contests/:contestId`',
        '`DELETE /api/v1/contests/:contestId`',
      ],
    );
    assert.equal(findings[0].location, 'routes.ts:4');
  });

  it('flags a route that authorizes in its service when nothing declares it', () => {
    const findings = evaluateRoutes({ routes: byIdRoutes(contestsModuleOnMain), optOuts: [] });
    assert.ok(messages(findings).some((message) => message.startsWith('`PATCH /api/v1/contests/:contestId/entries/:entryId`')));
  });

  it('stays clean on a route that declares a preHandler', () => {
    const routes = byIdRoutes(`
      export function contestsByIdModule(fastify) {
        fastify.put('/:contestId', { preHandler: requireContestCommissioner, handler: h });
      }
    `);
    assert.equal(routes[0].gated, true);
    assert.deepEqual(evaluateRoutes({ routes, optOuts: [] }), []);
  });

  it('stays clean on a route with a reasoned opt-out entry', () => {
    const routes = byIdRoutes(`
      export function contestsByIdModule(fastify) {
        fastify.patch('/:contestId/entries/:entryId', { handler: h });
      }
    `);
    assert.equal(routes[0].gated, false);
    assert.deepEqual(evaluateRoutes({ routes, optOuts: [entryOptOut] }), []);
  });

  it('is clean on the fixed contest module: hooks on the three, the entry route opted out', () => {
    const fixed = contestsModuleOnMain
      .replace("handler: handlers.getContest", 'preHandler: requireContestLeagueMember, handler: handlers.getContest')
      .replace("handler: handlers.updateContest", 'preHandler: requireContestCommissioner, handler: handlers.updateContest')
      .replace("handler: handlers.deleteContest", 'preHandler: requireContestCommissioner, handler: handlers.deleteContest');
    assert.deepEqual(evaluateRoutes({ routes: byIdRoutes(fixed), optOuts: [entryOptOut] }), []);
  });

  it('counts an onRequest hook, a shorthand property, a spread options object and a module-wide addHook as gates', () => {
    const routes = byIdRoutes(`
      export function seasonsModule(fastify) {
        const write = { onRequest: requireRootAdmin };
        fastify.patch('/:seasonId', { ...write, handler: h });
        fastify.post('/:seasonId/clone', { onRequest: requireRootAdmin, handler: h });
        fastify.post('/:seasonId/set-current', { preHandler, handler: h });
        fastify.get('/:seasonId', { handler: h });
      }
    `, 'seasonsModule', '/api/v1/seasons');
    assert.deepEqual(routes.map((route) => [route.method, route.gated]), [
      ['PATCH', true],
      ['POST', true],
      ['POST', true],
      ['GET', false],
    ]);

    const moduleWide = byIdRoutes(`
      export function platformModule(fastify) {
        fastify.addHook('onRequest', requireRootAdmin);
        fastify.put('/ingestion-schedule/:sport', { handler: h });
      }
    `, 'platformModule', '/api/v1/platform');
    assert.equal(moduleWide[0].gated, true);
  });

  it('does not count a hook declared on another route, or a non-gate hook, as a gate', () => {
    const routes = byIdRoutes(`
      export function contestsByIdModule(fastify) {
        fastify.addHook('onSend', addEtag);
        fastify.put('/:contestId', { preHandler: requireContestCommissioner, handler: h });
        fastify.delete('/:contestId', { onResponse: log, handler: h });
      }
    `);
    assert.deepEqual(routes.map((route) => route.gated), [true, false]);
  });

  it('only reads routes in the named module function', () => {
    const text = `
      export function contestsModule(fastify) { fastify.get('/:contestId', { handler: h }); }
      export function contestsByIdModule(fastify) { fastify.put('/:contestId', { preHandler: g, handler: h }); }
    `;
    assert.deepEqual(byIdRoutes(text).map((route) => route.method), ['PUT']);
    assert.equal(readModuleRoutes(text, 'missingModule'), null);
  });

  it('reports a route registration it cannot read instead of skipping it', () => {
    const { unreadable } = readModuleRoutes(`
      export function contestsByIdModule(fastify) {
        fastify.get(PATH, { handler: h });
        fastify.route({ method: 'GET', url: '/:contestId', handler: h });
      }
    `, 'contestsByIdModule');
    assert.deepEqual(unreadable.map((entry) => entry.reason), [
      'non-literal route path',
      'fastify.route() is not read; use the method form',
    ]);
  });

  it('fails an opt-out with no reason, a stale opt-out, a duplicate, and an opt-out on a route that declares a hook', () => {
    const routes = byIdRoutes(`
      export function contestsByIdModule(fastify) {
        fastify.put('/:contestId', { preHandler: requireContestCommissioner, handler: h });
        fastify.get('/:contestId', { handler: h });
      }
    `);
    const findings = messages(evaluateRoutes({
      routes,
      optOuts: [
        { route: 'GET /api/v1/contests/:contestId', reason: ' ' },
        { route: 'PUT /api/v1/contests/:contestId', reason: 'Gated in the service.' },
        { route: 'GET /api/v1/contests/:contestId/audit-log', reason: 'Deleted in #257.' },
        { route: 'GET /api/v1/contests/:contestId', reason: 'Twice.' },
      ],
    }));
    assert.deepEqual(findings, [
      '`GET /api/v1/contests/:contestId` needs a one-line reason saying where the route authorizes.',
      '`GET /api/v1/contests/:contestId` is listed twice.',
      '`PUT /api/v1/contests/:contestId` declares a hook and is also on the opt-out list; remove the opt-out.',
      '`GET /api/v1/contests/:contestId/audit-log` matches no route with a path parameter; remove it.',
    ]);
  });

  it('reads both by-id and nested mounts, and reports a non-literal prefix', () => {
    const { mounts, unreadable } = readMounts(`
      import { contestsModule, contestsByIdModule } from './modules/contests/routes';
      app.register(contestsModule, { prefix: '/api/v1/leagues/:id/contests' });
      app.register(contestsByIdModule, { prefix: '/api/v1/contests' });
      app.register(swaggerPlugin);
      app.register(contestsByIdModule, { prefix: CONTEST_PREFIX });
    `);
    assert.deepEqual(mounts.map((mount) => [mount.exportName, mount.prefix]), [
      ['contestsModule', '/api/v1/leagues/:id/contests'],
      ['contestsByIdModule', '/api/v1/contests'],
    ]);
    assert.deepEqual(unreadable.map((entry) => entry.reason), ['non-literal prefix']);
  });

  describe('against a tree on disk', () => {
    const root = mkdtempSync(join(tmpdir(), 'route-authorization-'));
    after(() => rmSync(root, { recursive: true, force: true }));

    it('finds a new by-id module from its mount alone, with no list to update', () => {
      mkdirSync(join(root, 'packages/core-api/src/modules/contests'), { recursive: true });
      mkdirSync(join(root, 'packages/core-api/src/modules/squads'), { recursive: true });
      writeFileSync(join(root, API_ENTRY), `
        import { contestsByIdModule } from './modules/contests/routes';
        import { squadsByIdModule } from './modules/squads/routes';
        app.register(contestsByIdModule, { prefix: '/api/v1/contests' });
        app.register(squadsByIdModule, { prefix: '/api/v1/squads' });
      `);
      writeFileSync(join(root, 'packages/core-api/src/modules/contests/routes.ts'), contestsModuleOnMain);
      writeFileSync(join(root, 'packages/core-api/src/modules/squads/routes.ts'), `
        export function squadsByIdModule(fastify) {
          fastify.get('/', { handler: h });
          fastify.patch('/:squadId', { handler: h });
        }
      `);
      const { routes, findings } = collectParameterizedRoutes(root);
      assert.deepEqual(findings, []);
      const ungated = evaluateRoutes({ routes, optOuts: [entryOptOut] })
        .map((finding) => finding.message.split(' authorizes nowhere')[0]);
      assert.deepEqual(ungated, [
        '`GET /api/v1/contests/:contestId`',
        '`PUT /api/v1/contests/:contestId`',
        '`DELETE /api/v1/contests/:contestId`',
        '`PATCH /api/v1/squads/:squadId`',
      ]);
    });

    it('checks every route under a nested mount, its root route included, because carrying the league id is not checking it (#292)', () => {
      const nestedRoot = join(root, 'nested');
      mkdirSync(join(nestedRoot, 'packages/core-api/src/modules/squads'), { recursive: true });
      writeFileSync(join(nestedRoot, API_ENTRY), `
        import { squadsModule } from './modules/squads/routes';
        app.register(squadsModule, { prefix: '/api/v1/leagues/:id/squads' });
      `);
      writeFileSync(join(nestedRoot, 'packages/core-api/src/modules/squads/routes.ts'), `
        const squadMember = { preHandler: requireMemberOfSquad(squadRepo, squadMembershipRepo, membershipRepo) };
        export function squadsModule(fastify) {
          fastify.get('/', { handler: h });
          fastify.patch('/:squadId', { ...squadMember, handler: h });
          fastify.delete('/:squadId', { onRequest: requireRootAdmin, handler: h });
          fastify.post('/:squadId/members', { handler: h });
        }
      `);
      const { routes, findings } = collectParameterizedRoutes(nestedRoot);
      assert.deepEqual(findings, []);
      assert.equal(routes.length, 4);
      const ungated = evaluateRoutes({ routes, optOuts: [] })
        .map((finding) => finding.message.split(' authorizes nowhere')[0]);
      assert.deepEqual(ungated, [
        '`GET /api/v1/leagues/:id/squads`',
        '`POST /api/v1/leagues/:id/squads/:squadId/members`',
      ]);
    });
  });
});
