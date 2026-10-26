import { Sport } from '@poolmaster/shared/domain';
import { EVENT_PAGE_COPY, type EventPageCopy } from './event-page-copy';
import { buildEventPagePath } from './event-page-paths';

/**
 * The name a shared link's card shows under its title: the marketing name, which may differ
 * from the app's own until that is decided.
 */
export const LINK_PREVIEW_SITE_NAME = 'Primetime Commissioner';

/** Where the preview images sit in `public/`, and so in each release. */
export const LINK_PREVIEW_IMAGE_DIR = 'og';

/** What a chat app or social site draws when an event page's link is pasted (#1010). */
export interface LinkPreview {
  /** The page's path, `/play/american-football/championship-weekend`. */
  path: string;
  title: string;
  description: string;
  /** The image's file name in `public/og/`. */
  imageFile: string;
  /** Over the name on the image, as on the page: "NFL conference championships". */
  eyebrow: string;
  /** The image's row of ways to play, in the page's order: "Clutch Card", "Bracket", "Squares". */
  contestTypes: readonly string[];
}

/**
 * `american-football-championship-weekend.jpg`: one 1200 by 630 JPEG per event page, kept small
 * because WhatsApp drops a preview image over about 300 KB.
 */
export function linkPreviewImageFile(path: string): string {
  return `${path.replace(/^\/play\//, '').replaceAll('/', '-')}.jpg`;
}

function linkPreview(sport: Sport, slug: string, copy: EventPageCopy): LinkPreview {
  const path = buildEventPagePath(sport, slug);
  return {
    path,
    title: copy.name,
    description: copy.hook,
    imageFile: linkPreviewImageFile(path),
    eyebrow: copy.eyebrow,
    contestTypes: Object.values(copy.offers).map((offer) => offer.contestType),
  };
}

/**
 * Every event page with its own copy gets a preview. A page without copy shares as the app does:
 * its link still opens, with no card.
 */
export function eventPageLinkPreviews(): LinkPreview[] {
  return Object.values(Sport).flatMap((sport) =>
    Object.entries(EVENT_PAGE_COPY[sport] ?? {}).map(([slug, copy]) => linkPreview(sport, slug, copy)));
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/**
 * The app's built `index.html` with the page's Open Graph and Twitter tags: what a link-preview
 * crawler reads, since it runs no script. `appUrl` is the site's origin and `assetBase` the
 * release's path, as the build was given them; both make the tags' addresses absolute.
 */
export function withLinkPreview(indexHtml: string, preview: LinkPreview, appUrl: string, assetBase: string): string {
  const origin = appUrl.replace(/\/+$/, '');
  const base = assetBase.endsWith('/') ? assetBase : `${assetBase}/`;
  const title = `${preview.title} | ${LINK_PREVIEW_SITE_NAME}`;
  const tags: [string, string, string][] = [
    ['name', 'description', preview.description],
    ['property', 'og:type', 'website'],
    ['property', 'og:site_name', LINK_PREVIEW_SITE_NAME],
    ['property', 'og:title', preview.title],
    ['property', 'og:description', preview.description],
    ['property', 'og:url', `${origin}${preview.path}`],
    ['property', 'og:image', `${origin}${base}${LINK_PREVIEW_IMAGE_DIR}/${preview.imageFile}`],
    ['property', 'og:image:width', '1200'],
    ['property', 'og:image:height', '630'],
    ['property', 'og:image:alt', `${preview.title}: ${preview.description}`],
    ['name', 'twitter:card', 'summary_large_image'],
  ];
  const meta = tags.map(([key, name, value]) => `    <meta ${key}="${name}" content="${escapeHtml(value)}" />`).join('\n');
  if (!/<title>[^<]*<\/title>/.test(indexHtml) || !indexHtml.includes('</head>')) {
    throw new Error('index.html has no <title> or </head> to add link preview tags to');
  }
  return indexHtml
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace('</head>', `${meta}\n  </head>`);
}
