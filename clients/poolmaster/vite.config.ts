import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig(() => {
  const assetBase = process.env.APP_ASSET_BASE ?? '/';
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, './package.json'), 'utf8'),
  ) as { name: string; version: string };
  const versionInfoFallback = {
    schemaVersion: 1,
    environment: process.env.POOLMASTER_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    buildTimeUtc: process.env.POOLMASTER_BUILD_TIME_UTC ?? 'unknown',
    releasePrefix: process.env.POOLMASTER_RELEASE_PREFIX ?? null,
    assetBase,
    gitRef: process.env.POOLMASTER_GIT_REF ?? null,
    webapp: {
      name: packageJson.name,
      version: process.env.POOLMASTER_WEBAPP_VERSION ?? packageJson.version,
      gitSha: process.env.POOLMASTER_WEBAPP_GIT_SHA ?? process.env.GITHUB_SHA ?? 'local',
    },
    service: {
      name: '@poolmaster/core-api',
      version:
        process.env.POOLMASTER_SERVICE_VERSION
        ?? process.env.POOLMASTER_SERVICE_GIT_SHA
        ?? process.env.GITHUB_SHA
        ?? 'local',
      gitSha:
        process.env.POOLMASTER_SERVICE_GIT_SHA
        ?? process.env.POOLMASTER_SERVICE_VERSION
        ?? process.env.GITHUB_SHA
        ?? 'local',
    },
  };

  return {
    base: assetBase,
    define: {
      __POOLMASTER_VERSION_INFO_FALLBACK__: JSON.stringify(versionInfoFallback),
    },
    plugins: [react()],
    resolve: {
      alias: [
        {
          find: '@',
          replacement: path.resolve(__dirname, './src'),
        },
        {
          find: '@poolmaster/shared/generated/hey-api',
          replacement: path.resolve(__dirname, '../../packages/shared/generated/hey-api'),
        },
        {
          find: '@poolmaster/shared/generated',
          replacement: path.resolve(__dirname, '../../packages/shared/generated/api-types.ts'),
        },
        {
          find: '@poolmaster/shared/dto',
          replacement: path.resolve(__dirname, '../../packages/shared/dto/index.ts'),
        },
        {
          find: '@poolmaster/shared/api-routes',
          replacement: path.resolve(__dirname, '../../packages/shared/api-routes.ts'),
        },
        {
          find: '@poolmaster/shared/domain',
          replacement: path.resolve(__dirname, '../../packages/shared/domain/index.ts'),
        },
        {
          find: '@poolmaster/shared',
          replacement: path.resolve(__dirname, '../../packages/shared'),
        },
      ],
    },
    server: {
      port: 5175,
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
    test: {
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    },
  };
});
