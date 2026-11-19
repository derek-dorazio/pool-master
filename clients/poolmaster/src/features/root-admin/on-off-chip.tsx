import { Chip } from '@/features/shared/ui';

/** A Status of On (green) or Off (faded), as Manage shows a sport league's or a template's. */
export function OnOffChip({ on }: { on: boolean }) {
  return on ? <Chip tone="success">On</Chip> : <Chip tone="inactive">Off</Chip>;
}
