import fs from 'node:fs';
import path from 'node:path';

export interface FunctionalServerState {
  pid: number;
  port: number;
  baseUrl: string;
  runId: string;
}

export function getFunctionalStateFilePath(): string {
  const configuredPath = process.env.FUNCTIONAL_SERVER_STATE_FILE;
  if (configuredPath) {
    return configuredPath;
  }

  const invocationId = process.env.FUNCTIONAL_INVOCATION_ID;
  if (invocationId) {
    return path.join(
      process.cwd(),
      'coverage',
      'service-functional-api',
      'runs',
      invocationId,
      'server-state.json',
    );
  }

  return path.join(
    process.cwd(),
    'coverage',
    'service-functional-api',
    'server-state.json',
  );
}

export function readFunctionalServerState(): FunctionalServerState {
  const functionalStateFilePath = getFunctionalStateFilePath();
  if (!fs.existsSync(functionalStateFilePath)) {
    throw new Error(
      `Functional server state file not found at ${functionalStateFilePath}. ` +
        'The shared functional server was not started.',
    );
  }

  const raw = fs.readFileSync(functionalStateFilePath, 'utf8');
  const parsed = JSON.parse(raw) as Partial<FunctionalServerState>;

  if (
    typeof parsed.pid !== 'number' ||
    typeof parsed.port !== 'number' ||
    typeof parsed.baseUrl !== 'string' ||
    typeof parsed.runId !== 'string'
  ) {
    throw new Error(`Functional server state file is invalid: ${raw}`);
  }

  return parsed as FunctionalServerState;
}

export function getFunctionalRunId(): string {
  return readFunctionalServerState().runId;
}

export function getFunctionalEmailPrefix(): string {
  return `functional-${getFunctionalRunId()}-`;
}
