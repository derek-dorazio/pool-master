#!/usr/bin/env node
/* global console, process */
/**
 * Wait for a one-off ECS task to stop, print its container's CloudWatch logs,
 * and exit with the container's exit code.
 *
 * Used by CI for tasks whose output is the only record of what they did (the
 * QA migrate task). The log location is read from the task's own registered
 * task definition rather than hardcoded, and every AWS error is printed rather
 * than swallowed — a silent lookup failure is what hid the real migrate error
 * for weeks (#191).
 *
 * Usage:
 *   node scripts/ecs-task-wait-and-print-logs.mjs \
 *     --cluster <cluster> --task-arn <arn> --container <name> \
 *     [--timeout-seconds 600] [--poll-seconds 15]
 */

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function taskIdFromArn(taskArn) {
  const taskId = String(taskArn ?? '').split('/').pop();
  if (!taskId) {
    throw new Error(`Cannot derive a task id from task ARN "${taskArn}".`);
  }
  return taskId;
}

/**
 * Where the awslogs driver writes a container's output. The awslogs driver
 * names streams `<prefix>/<container-name>/<task-id>`, so the stream is known
 * without listing streams.
 */
export function resolveLogLocation(taskDefinition, containerName, taskId) {
  const container = (taskDefinition?.containerDefinitions ?? [])
    .find((definition) => definition.name === containerName);
  if (!container) {
    return { error: `Task definition has no container named "${containerName}".` };
  }

  const { logDriver, options = {} } = container.logConfiguration ?? {};
  if (logDriver !== 'awslogs') {
    return { error: `Container "${containerName}" uses log driver "${logDriver ?? 'none'}", not awslogs.` };
  }

  const group = options['awslogs-group'];
  const prefix = options['awslogs-stream-prefix'];
  if (!group || !prefix) {
    return {
      error: `Container "${containerName}" awslogs options are missing awslogs-group or awslogs-stream-prefix: ${JSON.stringify(options)}`,
    };
  }

  return {
    group,
    region: options['awslogs-region'],
    stream: `${prefix}/${containerName}/${taskId}`,
  };
}

export function summarizeStoppedTask(task, containerName) {
  const container = (task?.containers ?? []).find((entry) => entry.name === containerName);
  const exitCode = typeof container?.exitCode === 'number' ? container.exitCode : null;
  const lines = [];

  if (!container) {
    lines.push(`Container "${containerName}" was not found on the stopped task.`);
  } else if (exitCode === null) {
    lines.push(`Container "${containerName}" reported no exit code (it may never have started).`);
  } else {
    lines.push(`Container "${containerName}" exit code: ${exitCode}`);
  }
  if (container?.reason) lines.push(`Container reason: ${container.reason}`);
  if (task?.stopCode) lines.push(`Stop code: ${task.stopCode}`);
  if (task?.stoppedReason) lines.push(`Stopped reason: ${task.stoppedReason}`);

  return { exitCode, succeeded: exitCode === 0, lines };
}

/** Delays before each retry of the log read: CloudWatch can lag the task stopping. */
export function backoffDelaysMs(attempts, baseMs) {
  return Array.from({ length: attempts }, (_, index) => baseMs * 2 ** index);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function aws(args) {
  const result = spawnSync('aws', [...args, '--output', 'json', '--no-cli-pager'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    return { ok: false, error: result.error.message };
  }
  if (result.status !== 0) {
    return { ok: false, error: (result.stderr || `aws exited ${result.status}`).trim() };
  }
  return { ok: true, value: JSON.parse(result.stdout || 'null') };
}

function parseArgs(argv) {
  const options = { timeoutSeconds: 600, pollSeconds: 15 };
  for (let index = 0; index < argv.length; index += 2) {
    const [flag, value] = [argv[index], argv[index + 1]];
    if (flag === '--cluster') options.cluster = value;
    else if (flag === '--task-arn') options.taskArn = value;
    else if (flag === '--container') options.container = value;
    else if (flag === '--timeout-seconds') options.timeoutSeconds = Number(value);
    else if (flag === '--poll-seconds') options.pollSeconds = Number(value);
    else throw new Error(`Unknown argument: ${flag}`);
  }
  for (const required of ['cluster', 'taskArn', 'container']) {
    if (!options[required]) throw new Error(`Missing required argument for ${required}.`);
  }
  return options;
}

async function waitForStop({ cluster, taskArn, timeoutSeconds, pollSeconds }) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  for (let attempt = 1; Date.now() < deadline; attempt += 1) {
    const described = aws(['ecs', 'describe-tasks', '--cluster', cluster, '--tasks', taskArn]);
    if (!described.ok) {
      console.log(`  describe-tasks failed (attempt ${attempt}): ${described.error}`);
    } else {
      const task = described.value?.tasks?.[0];
      console.log(`  Status: ${task?.lastStatus ?? 'unknown'} (attempt ${attempt})`);
      if (task?.lastStatus === 'STOPPED') return task;
    }
    await sleep(pollSeconds * 1000);
  }
  return null;
}

async function printLogs(task, containerName) {
  const taskId = taskIdFromArn(task.taskArn);
  const described = aws(['ecs', 'describe-task-definition', '--task-definition', task.taskDefinitionArn]);
  if (!described.ok) {
    console.log(`(could not read task definition ${task.taskDefinitionArn}: ${described.error})`);
    return;
  }

  const location = resolveLogLocation(described.value?.taskDefinition, containerName, taskId);
  if (location.error) {
    console.log(`(${location.error})`);
    return;
  }
  console.log(`Log group: ${location.group}`);
  console.log(`Log stream: ${location.stream}`);

  const regionArgs = location.region ? ['--region', location.region] : [];
  let lastError = '';
  for (const delayMs of [0, ...backoffDelaysMs(5, 2000)]) {
    if (delayMs) await sleep(delayMs);

    const messages = [];
    let token;
    let failed = false;
    for (;;) {
      const page = aws([
        'logs', 'get-log-events',
        '--log-group-name', location.group,
        '--log-stream-name', location.stream,
        '--start-from-head',
        ...(token ? ['--next-token', token] : []),
        ...regionArgs,
      ]);
      if (!page.ok) {
        lastError = page.error;
        failed = true;
        break;
      }
      messages.push(...(page.value?.events ?? []).map((event) => event.message));
      if (!page.value?.nextForwardToken || page.value.nextForwardToken === token) break;
      token = page.value.nextForwardToken;
    }

    if (!failed && messages.length > 0) {
      console.log('--- Task logs ---');
      for (const message of messages) console.log(message);
      console.log('--- End task logs ---');
      return;
    }
    if (!failed) lastError = 'the log stream has no events yet';
  }
  console.log(`(task logs unavailable after retries: ${lastError})`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  console.log(`Waiting for ECS task ${options.taskArn} to stop...`);

  const task = await waitForStop(options);
  if (!task) {
    console.log(`::error::ECS task did not stop within ${options.timeoutSeconds} seconds.`);
    process.exit(1);
  }

  const summary = summarizeStoppedTask(task, options.container);
  for (const line of summary.lines) console.log(line);
  console.log(`Task definition: ${task.taskDefinitionArn}`);
  await printLogs(task, options.container);

  if (!summary.succeeded) {
    console.log(`::error::ECS task container "${options.container}" failed (exit code ${summary.exitCode ?? 'none'}). See the task logs above.`);
    process.exit(1);
  }
  console.log(`ECS task container "${options.container}" completed successfully.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
