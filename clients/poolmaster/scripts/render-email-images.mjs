import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { writeFile } from 'fs/promises';
import path from 'path';
import { chromium } from 'playwright';
import { loadAppModule } from './load-app-module.mjs';

/**
 * Draws the How to Play pictures system email links to (`plans/email-redesign.md`) into
 * `public/email/`, and records what each was drawn from in `public/email/drawn.json`. Run it by
 * hand when an illustration or its colours change, and commit the files:
 * `node scripts/render-email-images.mjs` from `clients/poolmaster`.
 * A sport with a photo (a `<sport>.source.md` note beside its JPG) keeps the photo.
 */
const appRoot = path.resolve(import.meta.dirname, '..');
const publicDir = path.join(appRoot, 'public');
const { emailIllustrations } = await loadAppModule('/src/features/contest-types/email-illustrations.tsx');

/** @param {string} imagePath */
const hasPhoto = (imagePath) => imagePath.endsWith('.jpg') && existsSync(path.join(publicDir, imagePath.replace(/\.jpg$/, '.source.md')));

/** @param {import('../src/features/contest-types/email-illustrations').EmailIllustration} illustration */
function pageHtml(illustration) {
  return `<!doctype html>
<html><head><meta charset="utf-8" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@700;900&family=Inter:wght@400;600;700&display=swap" />
<style>
  * { margin: 0; }
  body { width: ${illustration.width}px; height: ${illustration.height}px; font-family: Inter, sans-serif; }
  svg { display: block; width: 100%; height: 100%; }
  .font-display { font-family: Archivo, sans-serif; }
</style></head>
<body>${illustration.source}</body></html>`;
}

const drawn = {};
const browser = await chromium.launch();
try {
  for (const illustration of emailIllustrations()) {
    if (hasPhoto(illustration.path)) continue;
    const page = await browser.newPage({ viewport: { width: illustration.width, height: illustration.height } });
    await page.setContent(pageHtml(illustration), { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const imagePath = path.join(publicDir, illustration.path);
    const jpeg = imagePath.endsWith('.jpg');
    await page.screenshot({ path: imagePath, type: jpeg ? 'jpeg' : 'png', ...(jpeg ? { quality: 85 } : {}) });
    await page.close();
    drawn[illustration.path] = createHash('sha256').update(illustration.source).digest('hex');
    console.log(`Wrote public${illustration.path}`);
  }
} finally {
  await browser.close();
}
await writeFile(path.join(publicDir, 'email', 'drawn.json'), `${JSON.stringify(drawn, null, 2)}\n`);
