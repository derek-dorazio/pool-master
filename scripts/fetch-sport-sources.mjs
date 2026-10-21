/**
 * Fetches public sources for the load-sport-data skill and saves them, so a cloud session
 * that cannot reach those sites can read and cross-check them from the branch.
 *
 * Run by the "Fetch sport sources" workflow, which commits the output folder to the branch it
 * ran on. Each URL becomes `<NN>-<host>.txt`. A JSON feed (ESPN's public API) is saved as it
 * is, and a PDF as `<NN>-<host>.pdf`. A page is saved as its visible text, then any JSON it embeds in script tags. A page
 * that fills itself in with scripts (tour field pages) goes in `--render`: it is loaded in
 * headless Chromium and saved once its scripts have run. `index.json` lists every URL with
 * its status and file. The skill deletes the folder before its data file is merged.
 *
 * Usage: node scripts/fetch-sport-sources.mjs <output folder> [--fetch "<urls>"] [--render "<urls>"]
 * URLs are separated by spaces or newlines.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const MAX_URLS = 20;
const MAX_FILE_CHARS = 1_500_000;
const TIMEOUT_MS = 30_000;
/** How long a rendered page may keep loading after its first paint before it is saved. */
const RENDER_SETTLE_MS = 15_000;
const USER_AGENT = 'PoolMaster sport data loader (+https://github.com/derek-dorazio/pool-master)';

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '\u2013', mdash: '\u2014', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
};

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** The page's visible text: scripts, styles and tags dropped, one block per line. */
export function htmlToText(html) {
  const text = html
    .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article|\/table)\b[^>]*>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(text)
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/** JSON a page embeds for its own scripts: JSON-LD, Next.js data and other JSON script tags. */
export function embeddedJson(html) {
  const blocks = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const [, attributes, body] = match;
    if (/type\s*=\s*["']application\/(ld\+)?json["']/i.test(attributes) || /id\s*=\s*["']__NEXT_DATA__["']/i.test(attributes)) {
      const trimmed = body.trim();
      if (trimmed.length > 0) blocks.push(trimmed);
    }
  }
  return blocks;
}

/** Only public https pages; anything else is refused before a request is made. */
export function checkUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'not a URL' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'only https pages are fetched' };
  if (url.username || url.password) return { ok: false, reason: 'credentials in the URL' };
  return { ok: true, url };
}

export function fileNameFor(index, url, extension = 'txt') {
  return `${String(index + 1).padStart(2, '0')}-${url.hostname.replace(/^www\./, '').replace(/[^a-z0-9.-]/gi, '-')}.${extension}`;
}

function pageParts(html) {
  return [htmlToText(html), ...embeddedJson(html).map((block) => `--- embedded JSON ---\n${block}`)];
}

function save(outputDir, index, url, finalUrl, status, parts) {
  const header = `Source: ${url.href}\nFinal URL: ${finalUrl}\nHTTP ${status}\nFetched: ${new Date().toISOString()}\n\n`;
  const file = fileNameFor(index, url);
  writeFileSync(join(outputDir, file), `${header}${parts.join('\n\n')}`.slice(0, MAX_FILE_CHARS));
  return file;
}

async function fetchOne(index, url, outputDir) {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json,text/html;q=0.9,*/*;q=0.5' }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
  const contentType = response.headers.get('content-type') ?? '';
  // A PDF (a printed bracket) is saved as it is, for the skill to read with pdftotext.
  if (contentType.includes('application/pdf')) {
    const file = fileNameFor(index, url, 'pdf');
    writeFileSync(join(outputDir, file), Buffer.from(await response.arrayBuffer()));
    return { status: response.ok ? 'OK' : 'HTTP_ERROR', httpStatus: response.status, file };
  }
  const body = await response.text();
  const isJson = contentType.includes('json');
  const file = save(outputDir, index, url, response.url, response.status, isJson ? [body] : pageParts(body));
  return { status: response.ok ? 'OK' : 'HTTP_ERROR', httpStatus: response.status, file };
}

async function renderOne(index, url, outputDir, browser) {
  const page = await browser.newPage({ userAgent: USER_AGENT });
  try {
    const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
    // Script-filled pages keep fetching after first paint; wait for that, but save what is there if it never settles.
    await page.waitForLoadState('networkidle', { timeout: RENDER_SETTLE_MS }).catch(() => {});
    const status = response?.status() ?? 0;
    const file = save(outputDir, index, url, page.url(), status, pageParts(await page.content()));
    return { status: response?.ok() ? 'OK' : 'HTTP_ERROR', httpStatus: status, file };
  } finally {
    await page.close();
  }
}

/** Fetches `fetchUrls` directly and loads `renderUrls` in headless Chromium, in that order. */
export async function fetchSportSources(outputDir, { fetchUrls = [], renderUrls = [], log = () => {} }) {
  const total = fetchUrls.length + renderUrls.length;
  if (total === 0) throw new Error('No URLs given.');
  if (total > MAX_URLS) throw new Error(`${total} URLs given; at most ${MAX_URLS} per run.`);
  mkdirSync(outputDir, { recursive: true });
  const jobs = [...fetchUrls.map((raw) => ({ raw, render: false })), ...renderUrls.map((raw) => ({ raw, render: true }))];
  // Only loaded when a page needs rendering, so a feeds-only run needs no browser.
  if (renderUrls.length > 0) log('Starting headless Chromium...');
  const browser = renderUrls.length > 0 ? await (await import('@playwright/test')).chromium.launch() : null;
  const results = [];
  try {
    for (const [index, { raw, render }] of jobs.entries()) {
      const checked = checkUrl(raw);
      if (!checked.ok) {
        results.push({ url: raw, rendered: render, status: 'REFUSED', reason: checked.reason, file: null });
        log(`[${index + 1}/${total}] REFUSED ${raw} (${checked.reason})`);
        continue;
      }
      log(`[${index + 1}/${total}] ${render ? 'Rendering' : 'Fetching'} ${checked.url.href}`);
      const started = Date.now();
      try {
        const saved = render ? await renderOne(index, checked.url, outputDir, browser) : await fetchOne(index, checked.url, outputDir);
        results.push({ url: checked.url.href, rendered: render, ...saved });
        log(`[${index + 1}/${total}] ${saved.status} HTTP ${saved.httpStatus} in ${Math.round((Date.now() - started) / 1000)}s -> ${saved.file}`);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        results.push({ url: checked.url.href, rendered: render, status: 'FAILED', reason, file: null });
        log(`[${index + 1}/${total}] FAILED after ${Math.round((Date.now() - started) / 1000)}s (${reason})`);
      }
    }
  } finally {
    await browser?.close();
  }
  writeFileSync(join(outputDir, 'index.json'), `${JSON.stringify({ fetchedAt: new Date().toISOString(), results }, null, 2)}\n`);
  return results;
}

function splitUrls(value) {
  return (value ?? '').split(/\s+/).filter(Boolean);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { fetch: { type: 'string' }, render: { type: 'string' } } });
  try {
    const results = await fetchSportSources(positionals[0], { fetchUrls: splitUrls(values.fetch), renderUrls: splitUrls(values.render), log: (line) => console.log(line) });
    console.log('\nSummary:');
    for (const result of results) console.log(`${result.status} ${result.url}${result.file ? ` -> ${result.file}` : ''}${result.reason ? ` (${result.reason})` : ''}`);
    if (results.every((result) => result.status !== 'OK')) process.exit(1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
