import { describe, expect, it } from 'vitest';
import { eventPageLinkPreviews, withLinkPreview } from './link-preview';

// The images committed in `public/og/`, by file name.
const committedImages = Object.keys(import.meta.glob('../../../public/og/*.png')).map((file) => file.split('/').pop());

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Prime Time Commissioner</title>
    <script type="module" crossorigin src="/releases/abc/assets/index-1.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>`;

const championshipWeekend = () => {
  const preview = eventPageLinkPreviews().find((candidate) => candidate.path === '/play/american-football/championship-weekend');
  if (!preview) throw new Error('Championship Weekend has no link preview');
  return preview;
};

describe('Event page link previews', () => {
  it('gives every event page with copy its own preview, named for its address', () => {
    expect(championshipWeekend()).toMatchObject({
      title: 'Championship Weekend',
      imageFile: 'american-football-championship-weekend.png',
      eyebrow: 'NFL conference championships',
      contestTypes: ['Clutch Card', 'Bracket', 'Squares'],
    });
  });

  it('has a committed preview image for every event page, so the build can link one', () => {
    const missing = eventPageLinkPreviews()
      .map((preview) => preview.imageFile)
      .filter((file) => !committedImages.includes(file));
    expect(missing).toEqual([]);
  });

  it('writes the page\'s title and absolute Open Graph addresses into the app\'s shell, keeping its scripts', () => {
    const shell = withLinkPreview(INDEX_HTML, championshipWeekend(), 'https://qa.example.com/', '/releases/abc/');

    expect(shell).toContain('<title>Championship Weekend | Primetime Commissioner</title>');
    expect(shell).toContain('<meta property="og:title" content="Championship Weekend" />');
    expect(shell).toContain('<meta property="og:url" content="https://qa.example.com/play/american-football/championship-weekend" />');
    expect(shell).toContain('<meta property="og:image" content="https://qa.example.com/releases/abc/og/american-football-championship-weekend.png" />');
    expect(shell).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(shell).toContain('src="/releases/abc/assets/index-1.js"');
  });

  it('escapes copy that holds quotes or markup, so a tag cannot break out of its attribute', () => {
    const shell = withLinkPreview(INDEX_HTML, { ...championshipWeekend(), description: 'Say "go" <b>now</b> & win' }, 'https://qa.example.com', '/');

    expect(shell).toContain('<meta property="og:description" content="Say &quot;go&quot; &lt;b&gt;now&lt;/b&gt; &amp; win" />');
  });

  it('refuses a shell with no title or head to add tags to, rather than writing one without them', () => {
    expect(() => withLinkPreview('<html><body></body></html>', championshipWeekend(), 'https://qa.example.com', '/')).toThrow(/no <title>/);
  });
});
