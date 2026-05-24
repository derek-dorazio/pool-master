export type PoolMasterRuntimeMode = ImportMetaEnv['MODE'];

export const poolMasterConfig = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL?.trim() ?? '',
  assetBaseUrl: import.meta.env.BASE_URL,
  logLevel: import.meta.env.VITE_LOG_LEVEL,
  mode: import.meta.env.MODE,
};

export function isLocalRuntimeMode(mode: PoolMasterRuntimeMode = poolMasterConfig.mode) {
  return mode === 'development' || mode === 'test';
}
