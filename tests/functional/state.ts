import path from 'node:path';
import fs from 'node:fs';

export interface FunctionalServerState {
  pid: number;
  port: number;
  baseUrl: string;
  runId: string;
}

export const functionalStateFilePath = path.join(
  process.cwd(),
  'coverage',
  'service-functional-api',
  'server-state.json',
);

export function readFunctionalServerState(): FunctionalServerState {
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
