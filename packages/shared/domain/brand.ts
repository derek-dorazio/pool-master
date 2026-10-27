/**
 * The product's name as members see it, in the app, its emails and its link previews. Code,
 * packages, infrastructure and the repository keep the internal name `poolmaster`; only what a
 * person reads comes from here, so a rename is one edit.
 */

/** The name a member sees: the browser tab, the app bar, every email and link preview. */
export const PRODUCT_NAME = 'Primetime Commissioner';

/** The line under the name in the app bar, on the sign-in page and in the email header. */
export const PRODUCT_TAGLINE = 'The ultimate office pool manager and other game-day contests';

/**
 * The brand colours that live outside the web app's theme file: system email, link preview
 * images and the browser's tab colour read them from here. The theme file
 * (`clients/poolmaster/src/styles/globals.css`) holds the same values for the app, and a test
 * fails when the two disagree, so a palette change is made in both or neither.
 */
export const BRAND_COLORS = {
  /** `--color-navy-600`: headers, bands, headings. */
  navy: '#0b1e3f',
  /** `--color-navy-800`: the footer and the deepest backdrops. */
  navyDeep: '#05122a',
  /** `--color-navy-100`: secondary text on navy. */
  navyMist: '#c9d3e6',
  /** `--color-navy-200`: quiet text on navy. */
  navyHaze: '#8ea3c4',
  /** `--color-gold-400`: the accent. */
  gold: '#f5b800',
  /** `--color-gold-200`: a light gold edge. */
  goldLight: '#ffd86b',
  /** `--color-red-400`: errors and losses. */
  red: '#a8202d',
  /** `--color-paper`: the page behind everything. */
  paper: '#f5f5f2',
  /** `--surface-raised`: cards. */
  raised: '#ffffff',
  /** `--text-on-inverse`: text on navy. */
  onInverse: '#ffffff',
  /** `--color-ink`: body text on paper. */
  ink: '#0b0b0b',
  /** `--text-muted`: quiet text on paper. */
  muted: '#6b6b64',
} as const;

/** A `#rrggbb` colour at `alpha`, as `rgba(...)`: email clients do not read color-mix. */
export function colorWithAlpha(hex: string, alpha: number): string {
  const [red, green, blue] = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
  return `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(2)})`;
}
