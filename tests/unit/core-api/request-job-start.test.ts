import Fastify, { type FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { BackgroundJobType, JobTrigger, LeagueRole } from '@poolmaster/shared/domain';
import { FASTIFY_AJV_OPTIONS } from '../../../packages/core-api/src/plugins/string-transforms';
import { requireRootAdmin } from '../../../packages/core-api/src/core/root-admin-guard';
import { globalErrorHandler } from '../../../packages/core-api/src/core/error-handler';
import { currentJobStart, JobStartMissingError } from '../../../packages/core-api/src/core/job-start';
import { authGuard } from '../../../packages/core-api/src/plugins/auth-guard';
import { actsAs, requestJobStart } from '../../../packages/core-api/src/plugins/request-job-start';
import { leagueFromPath, requireCommissioner, requireMemberOfLeague } from '../../../packages/core-api/src/modules/leagues/permissions';
import { BackgroundJobQueue } from '../../../packages/core-api/src/modules/background-jobs';
import { buildMembership } from '../../factories';
import { fakeLeagueMembershipRepo } from '../../support/repo-fakes';
import { inMemoryBackgroundJobs } from '../../support/in-memory-background-jobs';

const JWT_SECRET = 'poolmaster-dev-secret-change-in-production';
process.env.JWT_SECRET = JWT_SECRET;

// What a job queued inside a request records (#1861): the role its route requires, as its
// permission gates set it, with the signed-in person, read through the production queue with
// the production `currentJobStart`. A route behind no role gate records SYSTEM: a member's own
// request queues no job of its own, only upkeep.

const LEAGUE_ID = '00000000-0000-4000-8000-000000000010';

function bearer(userId: string, isRootAdmin: boolean): Record<string, string> {
  const token = jwt.sign({ sub: userId, email: `${userId}@example.test`, isRootAdmin }, JWT_SECRET, { expiresIn: '15m' });
  return { authorization: `Bearer ${token}` };
}

async function buildApp(role: LeagueRole = LeagueRole.COMMISSIONER) {
  const jobs = inMemoryBackgroundJobs();
  const queue = new BackgroundJobQueue({ jobs, currentStart: currentJobStart });
  const memberships = fakeLeagueMembershipRepo({
    findByLeagueAndUser: jest.fn((leagueId: string, userId: string) => Promise.resolve(buildMembership({ leagueId, userId, role }))),
  });
  const queueOne = async () => {
    await queue.enqueue(BackgroundJobType.SYNC_EVENT_FIELD, { sportEventId: '00000000-0000-4000-8000-000000000001' });
    return { queued: true };
  };
  const app = Fastify({ logger: false, ajv: FASTIFY_AJV_OPTIONS });
  app.setErrorHandler(globalErrorHandler);
  // What a request's handler threw, so a test can tell which failure answered it.
  const errors: Error[] = [];
  app.addHook('onError', async (_request, _reply, error) => { errors.push(error); });
  await app.register(requestJobStart);
  await app.register(authGuard);
  app.post('/admin/things', { onRequest: requireRootAdmin }, queueOne);
  app.post('/leagues/:id/tools', { preHandler: requireCommissioner(memberships) }, queueOne);
  app.post('/leagues/:id/admin-tools', { onRequest: requireRootAdmin, preHandler: requireCommissioner(memberships) }, queueOne);
  app.post('/leagues/:id/picks', { preHandler: requireMemberOfLeague(memberships, leagueFromPath) }, queueOne);
  // A public route (no one signed in), here only to show what queueing a job from one does.
  app.get('/api/v1/contest-config-templates', queueOne);
  await app.ready();
  return { app, jobs, errors };
}

async function startOf(url: string, headers: Record<string, string>, role?: LeagueRole) {
  const { app, jobs } = await buildApp(role);
  try {
    const response = await app.inject({ method: 'POST', url, headers });
    expect(response.statusCode).toBe(200);
    expect(jobs.rows).toHaveLength(1);
    return { trigger: jobs.rows[0].trigger, startedByUserId: jobs.rows[0].startedByUserId };
  } finally {
    await app.close();
  }
}

describe('request job start', () => {
  it('records ADMIN and the admin for a job a root admin route queues', async () => {
    await expect(startOf('/admin/things', bearer('admin-1', true))).resolves.toEqual({ trigger: JobTrigger.ADMIN, startedByUserId: 'admin-1' });
  });

  it('records COMMISSIONER and the commissioner for a job a league\'s commissioner tools queue', async () => {
    await expect(startOf(`/leagues/${LEAGUE_ID}/tools`, bearer('commish-1', false)))
      .resolves.toEqual({ trigger: JobTrigger.COMMISSIONER, startedByUserId: 'commish-1' });
  });

  it('records COMMISSIONER, not ADMIN, when a root admin uses a league\'s commissioner tools, since the route sets the role', async () => {
    await expect(startOf(`/leagues/${LEAGUE_ID}/tools`, bearer('admin-1', true)))
      .resolves.toEqual({ trigger: JobTrigger.COMMISSIONER, startedByUserId: 'admin-1' });
  });

  it('records ADMIN for a route behind both the root admin guard and a commissioner gate, the stronger role', async () => {
    await expect(startOf(`/leagues/${LEAGUE_ID}/admin-tools`, bearer('admin-1', true)))
      .resolves.toEqual({ trigger: JobTrigger.ADMIN, startedByUserId: 'admin-1' });
  });

  it('records SYSTEM with no person for upkeep a member\'s own request queues', async () => {
    await expect(startOf(`/leagues/${LEAGUE_ID}/picks`, bearer('member-1', false), LeagueRole.MEMBER))
      .resolves.toEqual({ trigger: JobTrigger.SYSTEM, startedByUserId: undefined });
  });

  it('refuses to queue a job from a request with no one signed in, since nothing says what started it, and writes no job', async () => {
    const { app, jobs, errors } = await buildApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/contest-config-templates' });

      expect(response.statusCode).toBe(500);
      expect(errors).toEqual([expect.any(JobStartMissingError)]);
      expect(jobs.rows).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('keeps the stronger role whichever gate says so first', () => {
    const request = {} as FastifyRequest;
    actsAs(request, JobTrigger.COMMISSIONER);
    actsAs(request, JobTrigger.ADMIN);
    actsAs(request, JobTrigger.COMMISSIONER);
    expect(request.jobTrigger).toBe(JobTrigger.ADMIN);
  });
});
