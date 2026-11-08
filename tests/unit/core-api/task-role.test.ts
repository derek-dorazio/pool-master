/**
 * What one core-api task does (#1186): CORE_API_ROLE picks serving requests, the background
 * work, or both, and a task with a role it does not know refuses to start.
 */
import { TaskRole, WORKER_EMAIL_SENDER_TICK_MS, readTaskRole, taskRolePlan } from '../../../packages/core-api/src/core/task-role';

describe('task role', () => {
  it('runs everything in one process when CORE_API_ROLE is unset or blank, as QA and local dev do', () => {
    expect(readTaskRole({})).toBe(TaskRole.ALL);
    expect(readTaskRole({ CORE_API_ROLE: '  ' })).toBe(TaskRole.ALL);
  });

  it('reads each named role, ignoring surrounding spaces', () => {
    expect(readTaskRole({ CORE_API_ROLE: 'all' })).toBe(TaskRole.ALL);
    expect(readTaskRole({ CORE_API_ROLE: ' api ' })).toBe(TaskRole.API);
    expect(readTaskRole({ CORE_API_ROLE: 'worker' })).toBe(TaskRole.WORKER);
  });

  it('refuses a role it does not know, so a mistyped deployment fails at startup instead of running no jobs', () => {
    expect(() => readTaskRole({ CORE_API_ROLE: 'Worker' })).toThrow('CORE_API_ROLE "Worker" must be one of all, api, worker.');
  });

  it('runs the background work on an all-in-one task and a worker, and not on an API-only task', () => {
    expect(taskRolePlan(TaskRole.ALL)).toEqual({ runsBackgroundWork: true });
    expect(taskRolePlan(TaskRole.API)).toEqual({ runsBackgroundWork: false });
    expect(taskRolePlan(TaskRole.WORKER)).toEqual({ runsBackgroundWork: true, emailSenderTickMs: WORKER_EMAIL_SENDER_TICK_MS });
  });
});
