export interface VersionEnvironment {
  readonly NODE_ENV?: string;
  readonly POOLMASTER_ENVIRONMENT?: string;
  readonly POOLMASTER_SERVICE_VERSION?: string;
  readonly POOLMASTER_SERVICE_GIT_SHA?: string;
  readonly POOLMASTER_BUILD_NUMBER?: string;
  readonly POOLMASTER_BUILD_TIME_UTC?: string;
  readonly POOLMASTER_GIT_REF?: string;
  readonly GITHUB_SHA?: string;
  readonly GITHUB_RUN_NUMBER?: string;
  readonly GITHUB_REF_NAME?: string;
}

export interface ServiceVersionRecord {
  readonly environment: string;
  readonly buildTimeUtc: string | null;
  readonly gitRef: string | null;
  readonly service: {
    readonly name: string;
    readonly version: string;
    readonly gitSha: string | null;
    readonly buildNumber: string | null;
  };
  readonly runtime: {
    readonly nodeVersion: string;
  };
}

export class VersionService {
  constructor(
    private readonly env: VersionEnvironment = process.env,
    private readonly nodeVersion: string = process.version,
  ) {}

  getVersion(): ServiceVersionRecord {
    const gitSha = this.env.POOLMASTER_SERVICE_GIT_SHA
      ?? this.env.GITHUB_SHA
      ?? null;
    const version = this.env.POOLMASTER_SERVICE_VERSION
      ?? gitSha
      ?? '0.1.0';

    return {
      environment: this.env.POOLMASTER_ENVIRONMENT ?? this.env.NODE_ENV ?? 'development',
      buildTimeUtc: this.env.POOLMASTER_BUILD_TIME_UTC ?? null,
      gitRef: this.env.POOLMASTER_GIT_REF ?? this.env.GITHUB_REF_NAME ?? null,
      service: {
        name: '@poolmaster/core-api',
        version,
        gitSha,
        buildNumber: this.env.POOLMASTER_BUILD_NUMBER ?? this.env.GITHUB_RUN_NUMBER ?? null,
      },
      runtime: {
        nodeVersion: this.nodeVersion,
      },
    };
  }
}
