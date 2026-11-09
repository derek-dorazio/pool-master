export interface PoolMasterVersionInfo {
  schemaVersion: number;
  environment: string;
  buildTimeUtc: string;
  releasePrefix: string | null;
  assetBase: string;
  gitRef: string | null;
  webapp: {
    name: string;
    version: string;
    gitSha: string;
    buildNumber: string | null;
  };
  clientSdk: {
    name: string;
    packageName: string;
    packageVersion: string;
    clientFetchVersion: string | null;
    generator: string;
    generatorVersion: string | null;
  };
  service: {
    name: string;
    version: string;
    gitSha: string;
    buildNumber: string | null;
  };
}

declare const __POOLMASTER_VERSION_INFO_FALLBACK__: PoolMasterVersionInfo;

/**
 * The build's own version info, compiled in by Vite. The deployed `version-info.json` holds the
 * same record; nothing in the app fetches it.
 */
export function getEmbeddedVersionInfo(): PoolMasterVersionInfo {
  return __POOLMASTER_VERSION_INFO_FALLBACK__;
}
