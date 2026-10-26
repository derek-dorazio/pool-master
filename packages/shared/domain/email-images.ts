/**
 * The pictures in system email (`plans/email-redesign.md`), served from the web app's public
 * folder. Gmail and Outlook show no SVG, so each one is a JPG or PNG file, and email links to it
 * by absolute URL on the web host. One copy of each path, so the web app's render script and the
 * email renderers cannot disagree.
 */
import type { SelectionType, Sport } from './enums';
import { sportPathSegment } from './sports/registry';

/**
 * A sport's picture at the top of an email about one of its events, 1200 by 480: a generic
 * licensed photo where the sport has one (its source note sits beside it), otherwise its How to
 * Play scene rendered to JPG, so no email goes out without a header.
 */
export function emailSportImagePath(sport: Sport): string {
  return `/email/sports/${sportPathSegment(sport)}.jpg`;
}

/** A way to play's How to Play picture, rendered to PNG at twice its 160 by 100 size. */
export function emailFormatImagePath(selectionType: SelectionType): string {
  return `/email/formats/${selectionType.toLowerCase().replace(/_/g, '-')}.png`;
}
