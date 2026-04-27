import type { ServiceVersionResponse } from '@poolmaster/shared/dto/version.dto';
import type { ServiceVersionRecord } from '../modules/version/service';

export function toServiceVersionResponse(record: ServiceVersionRecord): ServiceVersionResponse {
  return {
    schemaVersion: 1,
    environment: record.environment,
    buildTimeUtc: record.buildTimeUtc,
    gitRef: record.gitRef,
    service: {
      name: record.service.name,
      version: record.service.version,
      gitSha: record.service.gitSha,
      buildNumber: record.service.buildNumber,
    },
    runtime: {
      nodeVersion: record.runtime.nodeVersion,
    },
  };
}
