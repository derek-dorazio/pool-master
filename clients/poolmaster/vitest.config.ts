import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
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
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
    },
  },
});
