import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkUrl, embeddedJson, fileNameFor, htmlToText } from './fetch-sport-sources.mjs';

describe('fetch-sport-sources', () => {
  it('keeps a page\'s visible text, one block per line, without scripts, styles or entities', () => {
    const html = '<html><head><style>p{}</style><script>var x = 1;</script></head><body>'
      + '<h1>2027 Schedule</h1><table><tr><td>Apr 15&ndash;18</td><td>RBC Heritage &amp; more</td></tr></table>'
      + '<p>Harbour&nbsp;Town</p><!-- note --></body></html>';

    assert.equal(htmlToText(html), '2027 Schedule\nApr 15\u201318 RBC Heritage & more\nHarbour Town');
  });

  it('collects the JSON a script-rendered page embeds, and no other script', () => {
    const html = '<script>track()</script><script type="application/ld+json">{"@type":"SportsEvent"}</script>'
      + '<script id="__NEXT_DATA__" type="application/json">{"props":{}}</script>';

    assert.deepEqual(embeddedJson(html), ['{"@type":"SportsEvent"}', '{"props":{}}']);
  });

  it('refuses anything but a plain https URL before fetching it', () => {
    assert.equal(checkUrl('https://www.pgatour.com/schedule').ok, true);
    assert.deepEqual(checkUrl('http://www.pgatour.com/schedule'), { ok: false, reason: 'only https pages are fetched' });
    assert.deepEqual(checkUrl('file:///etc/passwd'), { ok: false, reason: 'only https pages are fetched' });
    assert.deepEqual(checkUrl('https://user:pw@example.com/'), { ok: false, reason: 'credentials in the URL' });
    assert.deepEqual(checkUrl('pgatour schedule'), { ok: false, reason: 'not a URL' });
  });

  it('names each saved page by its order and host', () => {
    assert.equal(fileNameFor(0, new URL('https://www.pgatour.com/schedule')), '01-pgatour.com.txt');
    assert.equal(fileNameFor(11, new URL('https://en.wikipedia.org/wiki/2027_PGA_Tour')), '12-en.wikipedia.org.txt');
  });

  it('names a saved PDF, such as a printed bracket, with its own extension so it can be read as a PDF', () => {
    assert.equal(fileNameFor(2, new URL('https://www.ncaa.com/files/singles.pdf'), 'pdf'), '03-ncaa.com.pdf');
  });
});
