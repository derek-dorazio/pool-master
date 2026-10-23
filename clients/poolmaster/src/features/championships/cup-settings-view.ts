import {
  CUP_CUSTOM_POINTS_MAX,
  CUP_CUSTOM_POINTS_MAX_PLACES,
} from '@poolmaster/shared/dto';
import { CupPointsScale, CupWeight, cupPlacePoints, type CupPointsTable } from '@poolmaster/shared/domain';
import { formatOrdinalPlace } from './cup-view';

/** How many places the points preview shows. */
export const POINTS_PREVIEW_PLACES = 10;
/** The field the preview scores FIELD_BEATEN on, since its points depend on how many entered. */
export const POINTS_PREVIEW_FIELD = 12;

/** Each points table as the settings name and explain it. A `Record`, so a new scale needs copy. */
export const CUP_POINTS_SCALE_COPY: Record<CupPointsScale, { label: string; description: string }> = {
  [CupPointsScale.STANDARD]: {
    label: 'Standard',
    description: '100 for 1st, 80 for 2nd, 65 for 3rd, down to 7 for 20th, then 5 for every place after.',
  },
  [CupPointsScale.TOP_TEN]: {
    label: 'Top ten',
    description: '25, 18, 15, 12, 10, 8, 6, 4, 2 and 1 for 1st to 10th. Nothing after 10th.',
  },
  [CupPointsScale.FIELD_BEATEN]: {
    label: 'Field beaten',
    description: 'One point for every entry finished behind, plus one for finishing. Bigger fields are worth more.',
  },
  [CupPointsScale.CUSTOM]: {
    label: 'Custom',
    description: 'Your own points for each place. Places past your list score nothing.',
  },
};

/** The scales in the order the settings offer them. */
export const CUP_POINTS_SCALES = [
  CupPointsScale.STANDARD,
  CupPointsScale.TOP_TEN,
  CupPointsScale.FIELD_BEATEN,
  CupPointsScale.CUSTOM,
] as const;

/** Each cup weight as the contest settings name and explain it. */
export const CUP_WEIGHT_COPY: Record<CupWeight, { label: string; description: string }> = {
  [CupWeight.NORMAL]: { label: 'Normal (x1)', description: 'Earns the points table as it stands.' },
  [CupWeight.BONUS]: { label: 'Bonus (x1.5)', description: 'Earns half as much again, for a bigger event.' },
  [CupWeight.DOUBLE]: { label: 'Double (x2)', description: 'Earns twice the points, for a major.' },
  [CupWeight.NOT_COUNTED]: { label: 'Not counted', description: 'Earns nothing toward the cup or the championship.' },
};

/** The weights in the order the contest settings offer them. */
export const CUP_WEIGHTS = [CupWeight.NORMAL, CupWeight.BONUS, CupWeight.DOUBLE, CupWeight.NOT_COUNTED] as const;

/** A league's points table in one line, as its settings row shows it. */
export function describePointsTable(table: CupPointsTable): string {
  if (table.scale === CupPointsScale.CUSTOM) {
    return `Custom: ${table.customPoints.join(', ')}`;
  }
  return CUP_POINTS_SCALE_COPY[table.scale].label;
}

/** The commissioner's custom points as the form shows them: "10, 6, 3". */
export function formatCustomPoints(points: readonly number[]): string {
  return points.join(', ');
}

/**
 * The custom points typed into the form, 1st place first, separated by commas or spaces. Whole
 * numbers from 0 to the cap, at least one place and no more than the server takes.
 */
export function parseCustomPoints(text: string): { points: number[]; error: null } | { points: null; error: string } {
  const parts = text.split(/[\s,]+/).filter(Boolean);
  if (!parts.length) {
    return { points: null, error: 'Enter the points for 1st place at least.' };
  }
  if (parts.length > CUP_CUSTOM_POINTS_MAX_PLACES) {
    return { points: null, error: `Enter points for no more than ${CUP_CUSTOM_POINTS_MAX_PLACES} places.` };
  }
  const points = parts.map(Number);
  if (points.some((value) => !Number.isInteger(value) || value < 0 || value > CUP_CUSTOM_POINTS_MAX)) {
    return { points: null, error: `Each place's points must be a whole number from 0 to ${CUP_CUSTOM_POINTS_MAX}.` };
  }
  return { points, error: null };
}

/** The points each of the first places earns on a table, for the settings preview. */
export function previewPoints(table: CupPointsTable): { place: string; points: number }[] {
  return Array.from({ length: POINTS_PREVIEW_PLACES }, (_, index) => ({
    place: formatOrdinalPlace(index + 1),
    points: cupPlacePoints(table, index + 1, POINTS_PREVIEW_FIELD),
  }));
}
