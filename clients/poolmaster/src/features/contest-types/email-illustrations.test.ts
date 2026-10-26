import { describe, expect, it } from 'vitest';
import { emailIllustrations } from './email-illustrations';

// The files committed under `public/email/`, by the path email links to.
const committed = new Set(Object.keys(import.meta.glob('../../../public/email/**/*.{jpg,png,md}')).map((file) => file.replace('../../../public', '')));
const drawn = Object.values(import.meta.glob<Record<string, string>>('../../../public/email/drawn.json', { eager: true, import: 'default' }))[0] ?? {};

const photoNote = (path: string) => path.replace(/\.jpg$/, '.source.md');
/** The script's SHA-256 of a picture's source, in hex. */
async function fingerprint(source: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('Email pictures', () => {
  it('has a committed file for every sport header and every way to play, so no email links to a missing picture', () => {
    const missing = emailIllustrations().map((illustration) => illustration.path).filter((path) => !committed.has(path));
    expect(missing).toEqual([]);
  });

  it('keeps a source note beside every sport photo, and a drawing of the How to Play scene for every sport without one', () => {
    const sportHeaders = emailIllustrations().filter((illustration) => illustration.path.startsWith('/email/sports/'));
    const unaccounted = sportHeaders
      .filter((illustration) => !committed.has(photoNote(illustration.path)) && !(illustration.path in drawn))
      .map((illustration) => illustration.path);
    expect(unaccounted).toEqual([]);
  });

  it('fails when a How to Play picture or its colours changed and its email file was not drawn again with scripts/render-email-images.mjs', async () => {
    const drawings = emailIllustrations().filter((illustration) => !committed.has(photoNote(illustration.path)));
    const fingerprints = await Promise.all(drawings.map((illustration) => fingerprint(illustration.source)));
    const stale = drawings
      .filter((illustration, index) => drawn[illustration.path] !== fingerprints[index])
      .map((illustration) => illustration.path);
    expect(stale).toEqual([]);
  });
});
