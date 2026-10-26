import fs from 'fs/promises';
import path from 'path';
import { loadAppModule } from './load-app-module.mjs';

/**
 * #1010: writes `dist/play/<sport>/<slug>/index.html` for each event page, the built app with
 * that page's link preview tags. The deploy puts them at `/play/` and CloudFront serves one to a
 * link-preview crawler; people get the app's own `index.html` as before. Without an app URL the
 * tags would have no absolute address, so a build without one (local, pull request) writes none.
 */
const appRoot = path.resolve(import.meta.dirname, '..');
const distPath = path.join(appRoot, 'dist');
const appUrl = process.env.POOLMASTER_WEBAPP_URL;
const assetBase = process.env.APP_ASSET_BASE ?? '/';

if (!appUrl) {
  console.log('POOLMASTER_WEBAPP_URL is not set: no event page link preview shells written');
} else {
  const { eventPageLinkPreviews, withLinkPreview, LINK_PREVIEW_IMAGE_DIR } = await loadAppModule('/src/features/event-pages/link-preview.ts');
  const indexHtml = await fs.readFile(path.join(distPath, 'index.html'), 'utf8');
  for (const preview of eventPageLinkPreviews()) {
    const imagePath = path.join(distPath, LINK_PREVIEW_IMAGE_DIR, preview.imageFile);
    await fs.access(imagePath).catch(() => {
      throw new Error(`${preview.path} has no preview image at public/${LINK_PREVIEW_IMAGE_DIR}/${preview.imageFile}: run scripts/render-link-preview-images.mjs`);
    });
    const shellPath = path.join(distPath, preview.path, 'index.html');
    await fs.mkdir(path.dirname(shellPath), { recursive: true });
    await fs.writeFile(shellPath, withLinkPreview(indexHtml, preview, appUrl, assetBase), 'utf8');
    console.log(`Wrote ${path.relative(appRoot, shellPath)}`);
  }
}
