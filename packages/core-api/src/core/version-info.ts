/**
 * Which build of core-api is running (#180).
 *
 * `scripts/write-version-info.mjs` writes `version-info.json` next to `package.json` at build
 * time: `packages/core-api/` in the repo, `/app` in the image. This module is its only
 * reader, and `/version` and the `version` field on log lines both come from here, so there
 * is one source of truth. It throws when the file is missing or malformed: a build that
 * cannot say what it is does not start.
 *
 * Which environment the build runs in is not in the file, since one image runs in many. That
 * is `readAppEnv()` in `./config`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { DateTimeSchema } from '@poolmaster/shared/dto/common.dto';
import { VersionComponentSchema } from '@poolmaster/shared/dto/version.dto';

const VersionInfoSchema = z.object({
  schemaVersion: z.literal(1),
  buildTimeUtc: DateTimeSchema,
  gitRef: z.string().nullable(),
  service: VersionComponentSchema,
}).strict();
export type VersionInfo = z.infer<typeof VersionInfoSchema>;

/** `src/core` and `dist/core` are both two levels below the package root. */
export const VERSION_INFO_PATH = path.resolve(__dirname, '..', '..', 'version-info.json');

export class VersionInfoUnavailableError extends Error {
  constructor(file: string, reason: string) {
    super(
      `${file} ${reason}. It is written at build time by `
      + '`node packages/core-api/scripts/write-version-info.mjs` with POOLMASTER_SERVICE_VERSION '
      + 'set; the service has no other source for its version and will not start without it.',
    );
    this.name = 'VersionInfoUnavailableError';
  }
}

/** Read and validate a version-info file. Exported for tests; the app uses `readVersionInfo()`. */
export function readVersionInfoFile(file: string): VersionInfo {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    throw new VersionInfoUnavailableError(file, 'could not be read');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new VersionInfoUnavailableError(file, 'is not a valid version-info file (not JSON)');
  }
  const result = VersionInfoSchema.safeParse(parsed);
  if (!result.success) {
    throw new VersionInfoUnavailableError(
      file,
      `is not a valid version-info file (${result.error.issues.map((issue) => issue.path.join('.')).join(', ')})`,
    );
  }
  return result.data;
}

let cached: VersionInfo | undefined;

/** This build's identity, read once per process: the file cannot change while the build runs. */
export function readVersionInfo(): VersionInfo {
  cached ??= readVersionInfoFile(VERSION_INFO_PATH);
  return cached;
}
