import { SUPPORTED_SPORTS, SelectionType, emailFormatImagePath, sportHeaderImagePath } from '@poolmaster/shared/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import themeCss from '@/styles/globals.css?raw';
import { FormatIllustration, SportIllustration } from './illustrations';

/**
 * The How to Play pictures as system email shows them (`rules/ux-rules.md` §14 *System Email*): email can't
 * show SVG, so `scripts/render-email-images.mjs` draws each one to the file email links to, and a
 * test fails when a picture changed and its file was not drawn again. Not part of the app's
 * bundle: only that script and its test load it.
 */
export interface EmailIllustration {
  /** Where it is served, from `sportHeaderImagePath` or `emailFormatImagePath`. */
  path: string;
  width: number;
  height: number;
  /** What the file is drawn from, as HTML: the light theme's illustration colours, then the svg. */
  source: string;
}

/** The light theme's `--illustration-*` colours, the first value of each in the theme layer. */
function illustrationColours(): string {
  const colours = new Map<string, string>();
  for (const [, name, value] of themeCss.matchAll(/(--illustration-[a-z-]+):\s*([^;]+);/g)) {
    if (!colours.has(name)) colours.set(name, value.trim());
  }
  return `:root{${[...colours].map(([name, value]) => `${name}:${value}`).join(';')}}`;
}

/**
 * Every picture email can link to: each sport's scene at an event header's 1200 by 480, which
 * stands in until the sport has a photo, and each way to play's sheet at twice its size.
 */
export function emailIllustrations(): EmailIllustration[] {
  const colours = illustrationColours();
  const draw = (path: string, width: number, height: number, svg: string): EmailIllustration => ({
    path,
    width,
    height,
    source: `<style>${colours}</style>${svg}`,
  });
  return [
    ...SUPPORTED_SPORTS.map((sport) => draw(sportHeaderImagePath(sport), 1200, 480, renderToStaticMarkup(<SportIllustration decorative sport={sport} />))),
    ...Object.values(SelectionType).map((selectionType) => draw(emailFormatImagePath(selectionType), 320, 200, renderToStaticMarkup(<FormatIllustration selectionType={selectionType} />))),
  ];
}
