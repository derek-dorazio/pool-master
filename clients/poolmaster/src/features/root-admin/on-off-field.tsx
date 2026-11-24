import type { UseFormRegisterReturn } from 'react-hook-form';
import { FormField, Select } from '@/features/shared/ui';

/** A provider form's On/Off switch, held as `on` or `off` until it is saved. */
export function OnOffField({ label, registration, testId }: { label: string; registration: UseFormRegisterReturn; testId: string }) {
  return (
    <FormField label={label}>
      <Select data-testid={testId} {...registration}>
        <option value="on">On</option>
        <option value="off">Off</option>
      </Select>
    </FormField>
  );
}
