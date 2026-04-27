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

function buildVersionInfoUrl(): string {
  if (typeof window === 'undefined') {
    return 'version-info.json';
  }

  return new URL('version-info.json', `${window.location.origin}${import.meta.env.BASE_URL}`).toString();
}

export async function getVersionInfo(
  fetchImpl: typeof fetch = fetch,
): Promise<PoolMasterVersionInfo> {
  try {
    const response = await fetchImpl(buildVersionInfoUrl(), {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Failed to load version info: ${response.status}`);
    }

    return (await response.json()) as PoolMasterVersionInfo;
  } catch {
    return __POOLMASTER_VERSION_INFO_FALLBACK__;
  }
}

export function getEmbeddedVersionInfo(): PoolMasterVersionInfo {
  return __POOLMASTER_VERSION_INFO_FALLBACK__;
}
