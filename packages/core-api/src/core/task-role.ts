/**
 * What one core-api task does (#1186). Every task runs the same image; `CORE_API_ROLE` says
 * whether it serves requests, runs the background work, or both.
 *
 * - `all` (the default, and what QA and local dev run today): serves requests and runs the
 *   background work, as one process.
 * - `api`: serves requests only. It starts no schedulers, no email sender and no job runner, and
 *   a request that queues an email or a job leaves it for the worker rather than waking anything
 *   on this task.
 * - `worker`: runs the background work: the job runner, the email sender, the event lifecycle
 *   sweep, nightly cleanup and provider ingestion. It still listens on its port for health
 *   checks, but sits behind no load balancer. Work it runs itself still wakes its sender and
 *   runner, but an email or job an API task queued is found only by polling, so its email
 *   sender polls every second, as the job runner already does.
 *
 * The advisory job locks (#1159) stay in every role, so two workers overlapping during a deploy
 * still run each scheduled job once.
 */

export const TaskRole = {
  ALL: 'all',
  API: 'api',
  WORKER: 'worker',
} as const;
export type TaskRole = (typeof TaskRole)[keyof typeof TaskRole];

const TASK_ROLES: readonly string[] = Object.values(TaskRole);

/** The email sender's poll on a worker, which an API task's queued email never wakes. */
export const WORKER_EMAIL_SENDER_TICK_MS = 1000;

export interface TaskRolePlan {
  /**
   * Starts the job runner, email sender, lifecycle sweep, nightly cleanup and ingestion, and lets
   * a queued email or job wake this task's sender or runner.
   */
  runsBackgroundWork: boolean;
  /** How often this task's email sender looks for due email; undefined keeps its default. */
  emailSenderTickMs?: number;
}

/** The role `CORE_API_ROLE` names; unset means `all`, and anything else stops the task starting. */
export function readTaskRole(env: { readonly CORE_API_ROLE?: string } = process.env): TaskRole {
  const raw = env.CORE_API_ROLE?.trim();
  if (!raw) return TaskRole.ALL;
  if (!isTaskRole(raw)) {
    throw new Error(`CORE_API_ROLE "${raw}" must be one of ${TASK_ROLES.join(', ')}.`);
  }
  return raw;
}

function isTaskRole(value: string): value is TaskRole {
  return TASK_ROLES.includes(value);
}

export function taskRolePlan(role: TaskRole): TaskRolePlan {
  switch (role) {
    case TaskRole.ALL:
      return { runsBackgroundWork: true };
    case TaskRole.API:
      return { runsBackgroundWork: false };
    case TaskRole.WORKER:
      return { runsBackgroundWork: true, emailSenderTickMs: WORKER_EMAIL_SENDER_TICK_MS };
  }
}
