import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readdirSync } from 'fs';
import path from 'path';

/**
 * Per-folder coverage floors (#1478): every feature folder and every `src/lib` folder must keep
 * 90% of its lines and 85% of its branches covered on its own, so a weak feature cannot hide
 * behind strong ones in the whole-suite number. The folders are read from disk, so a new feature
 * folder gets the floor the day it is created. Never lower a floor to let a change through.
 */
const FOLDER_FLOOR = { lines: 90, branches: 85 } as const;

function subfolders(relativeDir: string): string[] {
  return readdirSync(path.resolve(import.meta.dirname, relativeDir), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${relativeDir}/${entry.name}`);
}

const flooredGlobs = [
  ...subfolders('src/features').map((folder) => `${folder}/**`),
  'src/lib/*.{ts,tsx}',
  ...subfolders('src/lib').map((folder) => `${folder}/**`),
];

const folderFloors: Record<string, typeof FOLDER_FLOOR> = Object.fromEntries(
  flooredGlobs.map((glob) => [glob, FOLDER_FLOOR]),
);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: '@',
        replacement: path.resolve(import.meta.dirname, './src'),
      },
      {
        find: '@poolmaster/shared/generated/hey-api',
        replacement: path.resolve(import.meta.dirname, '../../packages/shared/generated/hey-api'),
      },
      {
        find: '@poolmaster/shared/generated',
        replacement: path.resolve(import.meta.dirname, '../../packages/shared/generated/api-types.ts'),
      },
      {
        find: '@poolmaster/shared/dto',
        replacement: path.resolve(import.meta.dirname, '../../packages/shared/dto/index.ts'),
      },
      {
        find: '@poolmaster/shared/api-routes',
        replacement: path.resolve(import.meta.dirname, '../../packages/shared/api-routes.ts'),
      },
      {
        find: '@poolmaster/shared/domain',
        replacement: path.resolve(import.meta.dirname, '../../packages/shared/domain/index.ts'),
      },
      {
        find: '@poolmaster/shared',
        replacement: path.resolve(import.meta.dirname, '../../packages/shared'),
      },
    ],
  },
  test: {
    environment: 'jsdom',
    // Vitest hands every stylesheet import back empty unless included here. The theme file is,
    // so a test can read real token values through `?raw` (jsdom resolves no CSS variables).
    css: { include: [/globals\.css/] },
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      // Every app source file counts, loaded by a test or not: without `include`, Vitest reports
      // only files some test imports, so an untested file or folder would pass every floor.
      include: ['src/**/*.{ts,tsx}'],
      // The Playwright suite's helpers, the unit tests' own MSW harness and the gallery's stories
      // (#1615) are test and dev code, not app code.
      exclude: ['e2e/**', 'src/test/**', 'src/**/*.stories.tsx'],
      // The whole-suite floor sits about 1 point under its measurement on 2026-11-09 (#1478):
      // 94.97 / 88.77 / 95.55 / 94.94 (statements / branches / functions / lines). Raise it as
      // coverage grows; never lower it to pass.
      thresholds: {
        statements: 94,
        branches: 87.5,
        functions: 94.5,
        lines: 94,
        ...folderFloors,
      },
    },
  },
});
