import path from 'path';
import { chromium } from 'playwright';
import { loadAppModule } from './load-app-module.mjs';

/**
 * #1010: draws each event page's link preview image, 1200 by 630, into `public/og/`. Run it by
 * hand when a page's copy is added or changes, and commit the images:
 * `node scripts/render-link-preview-images.mjs` from `clients/poolmaster`.
 * The layout is the tile's (board 9): eyebrow, name, hook line, the ways to play.
 */
const appRoot = path.resolve(import.meta.dirname, '..');
const { eventPageLinkPreviews, LINK_PREVIEW_IMAGE_DIR } = await loadAppModule('/src/features/event-pages/link-preview.ts');
const { PRODUCT_NAME } = await loadAppModule('@poolmaster/shared/domain');

function escapeHtml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** @param {import('../src/features/event-pages/link-preview').LinkPreview} preview */
function tileHtml(preview) {
  const chips = preview.contestTypes.map((type) => `<span class="chip">${escapeHtml(type)}</span>`).join('');
  return `<!doctype html>
<html><head><meta charset="utf-8" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@700;900&family=Inter:wght@500;600&display=swap" />
<style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; background: #0b1e3f; color: #fff; font-family: Inter, sans-serif; }
  .tile { position: relative; height: 100%; padding: 64px 72px; display: flex; flex-direction: column; overflow: hidden;
    background: radial-gradient(circle at 92% 8%, rgba(245, 184, 0, 0.22), transparent 42%), linear-gradient(160deg, #0b1e3f 55%, #05122a); }
  .stripe { position: absolute; left: 0; top: 0; bottom: 0; width: 14px; background: #f5b800; }
  .eyebrow { font-weight: 600; font-size: 26px; letter-spacing: 0.08em; text-transform: uppercase; color: #f5b800; }
  h1 { margin-top: 18px; font-family: Archivo, sans-serif; font-weight: 900; font-size: 92px; line-height: 1; letter-spacing: -0.01em; }
  .hook { margin-top: 26px; max-width: 980px; font-size: 32px; line-height: 1.35; color: #c9d3e6; }
  .foot { margin-top: auto; display: flex; align-items: center; justify-content: space-between; }
  .chips { display: flex; gap: 14px; }
  .chip { padding: 10px 22px; border: 2px solid rgba(245, 184, 0, 0.7); border-radius: 999px; font-weight: 600; font-size: 24px; }
  .brand { font-family: Archivo, sans-serif; font-weight: 700; font-size: 26px; color: #8ea3c4; }
</style></head>
<body><div class="tile"><div class="stripe"></div>
  <p class="eyebrow">${escapeHtml(preview.eyebrow)}</p>
  <h1>${escapeHtml(preview.title)}</h1>
  <p class="hook">${escapeHtml(preview.description)}</p>
  <div class="foot"><div class="chips">${chips}</div><p class="brand">${escapeHtml(PRODUCT_NAME)}</p></div>
</div></body></html>`;
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  for (const preview of eventPageLinkPreviews()) {
    await page.setContent(tileHtml(preview), { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const imagePath = path.join(appRoot, 'public', LINK_PREVIEW_IMAGE_DIR, preview.imageFile);
    await page.screenshot({ path: imagePath, type: 'jpeg', quality: 85 });
    console.log(`Wrote ${path.relative(appRoot, imagePath)}`);
  }
} finally {
  await browser.close();
}
