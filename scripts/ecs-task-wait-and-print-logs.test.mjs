import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  backoffDelaysMs,
  resolveLogLocation,
  summarizeStoppedTask,
  taskIdFromArn,
} from './ecs-task-wait-and-print-logs.mjs';

// Defect #191: the migrate job's log lookup always came back empty, so every
// failed QA migration reported "Log group: unknown" and nothing else.
const migrateTaskDefinition = {
  containerDefinitions: [
    {
      name: 'migrate',
      logConfiguration: {
        logDriver: 'awslogs',
        options: {
          'awslogs-group': '/ecs/poolmaster-qa-migrate',
          'awslogs-region': 'us-east-2',
          'awslogs-stream-prefix': 'ecs',
        },
      },
    },
  ],
};

describe('ecs-task-wait-and-print-logs (defect #191)', () => {
  it('derives the task id from a task ARN', () => {
    assert.equal(
      taskIdFromArn('arn:aws:ecs:us-east-2:123456789012:task/poolmaster-qa-cluster/755a678784374d628b81c289d2d388c6'),
      '755a678784374d628b81c289d2d388c6',
    );
    assert.throws(() => taskIdFromArn(''), /Cannot derive a task id/);
  });

  it('resolves the awslogs group and the exact stream for the named container', () => {
    assert.deepEqual(resolveLogLocation(migrateTaskDefinition, 'migrate', 'abc123'), {
      group: '/ecs/poolmaster-qa-migrate',
      region: 'us-east-2',
      stream: 'ecs/migrate/abc123',
    });
  });

  it('explains why no log location exists instead of returning nothing', () => {
    assert.match(resolveLogLocation(migrateTaskDefinition, 'core-api', 'abc123').error, /no container named "core-api"/);
    assert.match(
      resolveLogLocation({ containerDefinitions: [{ name: 'migrate' }] }, 'migrate', 'abc123').error,
      /log driver "none"/,
    );
    assert.match(
      resolveLogLocation(
        { containerDefinitions: [{ name: 'migrate', logConfiguration: { logDriver: 'awslogs', options: {} } }] },
        'migrate',
        'abc123',
      ).error,
      /missing awslogs-group or awslogs-stream-prefix/,
    );
  });

  it('reads the exit code from the named container, not the first one', () => {
    const summary = summarizeStoppedTask({
      stoppedReason: 'Essential container in task exited',
      containers: [
        { name: 'sidecar', exitCode: 0 },
        { name: 'migrate', exitCode: 1 },
      ],
    }, 'migrate');

    assert.equal(summary.exitCode, 1);
    assert.equal(summary.succeeded, false);
    assert.ok(summary.lines.includes('Stopped reason: Essential container in task exited'));
  });

  it('treats a container that never reported an exit code as a failure', () => {
    const summary = summarizeStoppedTask({
      stopCode: 'TaskFailedToStart',
      containers: [{ name: 'migrate', reason: 'CannotPullContainerError' }],
    }, 'migrate');

    assert.equal(summary.exitCode, null);
    assert.equal(summary.succeeded, false);
    assert.ok(summary.lines.includes('Container reason: CannotPullContainerError'));
    assert.ok(summary.lines.includes('Stop code: TaskFailedToStart'));
  });

  it('backs off exponentially between log read attempts', () => {
    assert.deepEqual(backoffDelaysMs(4, 2000), [2000, 4000, 8000, 16000]);
  });
});
