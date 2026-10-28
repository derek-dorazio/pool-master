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
const { BRAND_COLORS, PRODUCT_NAME, colorWithAlpha } = await loadAppModule('@poolmaster/shared/domain');
const { navy, navyDeep, navyMist, navyHaze, gold, onInverse } = BRAND_COLORS;

function escapeHtml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** @param {import('../src/features/event-pages/link-preview').LinkPreview} preview */
function tileHtml(preview) {
  const chips = preview.contestTypes.map((type) => `<span class="chip">${escapeHtml(type)}</span>`).join('');
  return `<!doctype html>
<html><head><meta charset="utf-8" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:ital,wght@0,900;1,800&family=Inter:wght@500;600&display=swap" />
<style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; background: ${navy}; color: ${onInverse}; font-family: Inter, sans-serif; }
  .tile { position: relative; height: 100%; padding: 64px 72px; display: flex; flex-direction: column; overflow: hidden;
    background: radial-gradient(circle at 92% 8%, ${colorWithAlpha(gold, 0.22)}, transparent 42%), linear-gradient(160deg, ${navy} 55%, ${navyDeep}); }
  .stripe { position: absolute; left: 0; top: 0; bottom: 0; width: 14px; background: ${gold}; }
  .eyebrow { font-weight: 600; font-size: 26px; letter-spacing: 0.08em; text-transform: uppercase; color: ${navyHaze}; }
  h1 { margin-top: 18px; font-family: Archivo, sans-serif; font-weight: 900; font-size: 92px; line-height: 1; letter-spacing: -0.01em; }
  .hook { margin-top: 26px; max-width: 980px; font-size: 32px; line-height: 1.35; color: ${navyMist}; }
  .foot { margin-top: auto; display: flex; align-items: center; justify-content: space-between; }
  .chips { display: flex; gap: 14px; }
  .chip { padding: 10px 22px; border: 2px solid ${colorWithAlpha(gold, 0.7)}; border-radius: 999px; font-weight: 600; font-size: 24px; }
  .brand { font-family: Archivo, sans-serif; font-weight: 800; font-style: italic; font-size: 26px; letter-spacing: 0.06em; text-transform: uppercase; color: ${gold}; }
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
