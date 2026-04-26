import { describe, expect, it } from 'vitest';
// Vite supports `?raw` to import a file as a string. Using it here avoids
// pulling esbuild/Node types into the jsdom test runtime, which the webapp
// tsconfig intentionally excludes.
import viteConfigSource from '../../vite.config.ts?raw';

// pool-master-dxd.11 — Vite dev proxy must preserve the /api prefix.
//
// The generated hey-api SDK calls /api/v1/... (packages/shared/generated/hey-api/sdk.gen.ts)
// and the core-api backend mounts every module at /api/v1/...
// (packages/core-api/src/index.ts:96-218). Any rewrite that strips /api breaks
// the contract end-to-end and surfaces as "nothing loads" in dev because auth
// bootstrap, refresh, and every SDK call 404 against the backend.
describe('pool-master-dxd.11 — dev proxy preserves /api prefix', () => {
  it('does not strip /api from request paths before forwarding to the backend', () => {
    const stripsApiPrefix = /replace\s*\(\s*\/\^\\\/api\//.test(viteConfigSource);
    expect(stripsApiPrefix).toBe(false);
  });

  it('targets the local core-api on port 3000 for /api proxy traffic', () => {
    expect(viteConfigSource).toContain("'/api'");
    expect(viteConfigSource).toMatch(/target:\s*'http:\/\/localhost:3000'/);
  });
});
