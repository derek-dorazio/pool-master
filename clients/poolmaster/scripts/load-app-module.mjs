import path from 'path';
import { createServer } from 'vite';

const appRoot = path.resolve(import.meta.dirname, '..');

/**
 * Loads one of the web app's own modules into a build script, resolved as Vite resolves it: `@/`
 * and the shared package's source, so the script needs no build of `@poolmaster/shared`.
 * `modulePath` is from the app's root, `/src/features/...`.
 */
export async function loadAppModule(modulePath) {
  const server = await createServer({
    configFile: path.join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true },
    ssr: { noExternal: ['@poolmaster/shared'] },
  });
  try {
    return await server.ssrLoadModule(modulePath);
  } finally {
    await server.close();
  }
}
