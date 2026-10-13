/**
 * Fetches public source pages for the load-sport-data skill and saves their text, so a cloud
 * session that cannot reach those sites can read and cross-check them from the branch.
 *
 * Run by the "Fetch sport sources" workflow, which commits the output folder to the branch it
 * ran on. Each URL becomes `<NN>-<host>.txt`: the page's visible text, then any JSON the page
 * embeds in script tags (where script-rendered sites such as tour schedule pages keep their
 * data). `index.json` lists every URL with its status and file. The skill deletes the folder
 * before its data file is merged.
 *
 * Usage: node scripts/fetch-sport-sources.mjs <output folder> <url> [<url> ...]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_URLS = 20;
const MAX_FILE_CHARS = 1_500_000;
const TIMEOUT_MS = 30_000;
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

export function fileNameFor(index, url) {
  return `${String(index + 1).padStart(2, '0')}-${url.hostname.replace(/^www\./, '').replace(/[^a-z0-9.-]/gi, '-')}.txt`;
}

async function fetchOne(index, raw, outputDir) {
  const checked = checkUrl(raw);
  if (!checked.ok) return { url: raw, status: 'REFUSED', reason: checked.reason, file: null };
  const { url } = checked;
  try {
    const response = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/json;q=0.9,*/*;q=0.5' }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await response.text();
    const isJson = (response.headers.get('content-type') ?? '').includes('json');
    const parts = isJson ? [body] : [htmlToText(body), ...embeddedJson(body).map((block) => `--- embedded JSON ---\n${block}`)];
    const header = `Source: ${url.href}\nFinal URL: ${response.url}\nHTTP ${response.status}\nFetched: ${new Date().toISOString()}\n\n`;
    const file = fileNameFor(index, url);
    writeFileSync(join(outputDir, file), `${header}${parts.join('\n\n')}`.slice(0, MAX_FILE_CHARS));
    return { url: url.href, status: response.ok ? 'OK' : 'HTTP_ERROR', httpStatus: response.status, file };
  } catch (error) {
    return { url: url.href, status: 'FAILED', reason: error instanceof Error ? error.message : String(error), file: null };
  }
}

export async function fetchSportSources(outputDir, urls) {
  if (urls.length === 0) throw new Error('No URLs given.');
  if (urls.length > MAX_URLS) throw new Error(`${urls.length} URLs given; at most ${MAX_URLS} per run.`);
  mkdirSync(outputDir, { recursive: true });
  const results = [];
  for (const [index, raw] of urls.entries()) results.push(await fetchOne(index, raw, outputDir));
  writeFileSync(join(outputDir, 'index.json'), `${JSON.stringify({ fetchedAt: new Date().toISOString(), results }, null, 2)}\n`);
  return results;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [outputDir, ...urls] = process.argv.slice(2);
  try {
    const results = await fetchSportSources(outputDir, urls.flatMap((value) => value.split(/\s+/)).filter(Boolean));
    for (const result of results) console.log(`${result.status} ${result.url}${result.file ? ` -> ${result.file}` : ''}${result.reason ? ` (${result.reason})` : ''}`);
    if (results.every((result) => result.status !== 'OK')) process.exit(1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
