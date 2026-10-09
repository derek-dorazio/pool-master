import { readAppEnv, type AppEnvironment } from '../../core/config';
import { readVersionInfo, type VersionInfo } from '../../core/version-info';

export interface ServiceVersionRecord {
  readonly environment: AppEnvironment;
  readonly buildTimeUtc: string;
  readonly gitRef: string | null;
  readonly service: VersionInfo['service'];
  readonly runtime: {
    readonly nodeVersion: string;
  };
}

/**
 * What `/version` reports: the build identity from version-info.json (#180), the environment
 * this process runs in, and the Node runtime. No value is defaulted here; every reader throws
 * when its source is missing.
 */
export class VersionService {
  constructor(
    private readonly build: VersionInfo = readVersionInfo(),
    private readonly environment: AppEnvironment = readAppEnv(),
    private readonly nodeVersion: string = process.version,
  ) {}

  getVersion(): ServiceVersionRecord {
    return {
      environment: this.environment,
      buildTimeUtc: this.build.buildTimeUtc,
      gitRef: this.build.gitRef,
      service: this.build.service,
      runtime: {
        nodeVersion: this.nodeVersion,
      },
    };
  }
}
