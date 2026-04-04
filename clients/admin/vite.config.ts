import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(() => {
  const assetBase = process.env.APP_ASSET_BASE ?? '/';

  return {
    base: assetBase,
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
      port: 5174,
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ''),
        },
      },
    },
  };
});
