import type { ContestConfigTemplateDto } from '@/lib/api';

export type TemplateValues = { active: 'on' | 'off'; isDefault: 'yes' | 'no' };

/** The dialog's form values for a template as it is now. */
export function contestTemplateValuesOf(template: Pick<ContestConfigTemplateDto, 'active' | 'isDefault'>): TemplateValues {
  return { active: template.active ? 'on' : 'off', isDefault: template.isDefault ? 'yes' : 'no' };
}

/** Only what changed of Status and Default, the two things this dialog edits. */
export function contestTemplateUpdateBody(current: TemplateValues, values: TemplateValues): { active?: boolean; isDefault?: boolean } {
  return {
    ...(values.active !== current.active && { active: values.active === 'on' }),
    ...(values.isDefault !== current.isDefault && { isDefault: values.isDefault === 'yes' }),
  };
}
