import { enumLabel, slotLabel } from '@poolmaster/shared/display-strings';
import type { ContestConfigTemplateDto } from '@/lib/api';

/** What a template covers (#2010): its coverage mode, then its slots in play order as the API sends them. */
export function templateCoversLabel(template: Pick<ContestConfigTemplateDto, 'coverageMode' | 'slots'>): string {
  if (template.slots.length === 0) return 'No slots';
  return `${enumLabel('TemplateCoverageMode', template.coverageMode)}: ${template.slots.map(slotLabel).join(', ')}`;
}
