import fs from 'node:fs';
import path from 'node:path';

export interface FunctionalServerState {
  pid: number;
  port: number;
  baseUrl: string;
  runId: string;
}

const DAEMON_STATE_FILE_PATH = path.join(
  process.cwd(),
  'coverage',
  'service-functional-api',
  'daemon',
  'server-state.json',
);

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
  const parsed = readStateFile(functionalStateFilePath)
    ?? (() => {
      const daemonState = readStateFile(DAEMON_STATE_FILE_PATH);
      if (!daemonState) {
        return null;
      }

      const runId = process.env.FUNCTIONAL_RUN_ID;
      return {
        ...daemonState,
        runId: typeof runId === 'string' && runId.length > 0
          ? runId
          : daemonState.runId,
      } satisfies Partial<FunctionalServerState>;
    })();

  if (
    !parsed ||
    typeof parsed.pid !== 'number' ||
    typeof parsed.port !== 'number' ||
    typeof parsed.baseUrl !== 'string' ||
    typeof parsed.runId !== 'string'
  ) {
    throw new Error(
      `Functional server state file not found at ${functionalStateFilePath}. ` +
        'The shared functional server was not started.',
    );
  }

  return parsed as FunctionalServerState;
}

function readStateFile(filePath: string): Partial<FunctionalServerState> | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<FunctionalServerState>;
  } catch {
    return null;
  }
}

export function getFunctionalRunId(): string {
  return readFunctionalServerState().runId;
}

export function getFunctionalEmailPrefix(): string {
  return `functional-${getFunctionalRunId()}-`;
}
