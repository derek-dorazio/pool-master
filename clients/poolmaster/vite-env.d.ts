/// <reference types="vite/client" />

declare const __POOLMASTER_VERSION_INFO_FALLBACK__: import('./src/lib/version-info').PoolMasterVersionInfo;

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_LOG_LEVEL?: string;
}
