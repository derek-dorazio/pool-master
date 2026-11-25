import { enumLabel } from '@poolmaster/shared/display-strings';
import { explicitOrderValues, FieldOrderBasisOrder, type FieldOrderBasis } from '@poolmaster/shared/domain';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { Button, FormField, Select } from '@/features/shared/ui';

/**
 * A profile's sources (#2160): the values a field is put in order by, first deciding, each later
 * one breaking ties. Each row moves up or down or comes off; Add puts a source not yet listed at
 * the end. The server checks the list (one to three, none twice) and that a league's two
 * profiles start with the same source.
 */
export function ProfileSourcesField({
  error,
  id,
  onChange,
  testId,
  value,
}: {
  error?: string;
  id: string;
  onChange: (sources: FieldOrderBasis[]) => void;
  testId: string;
  value: readonly FieldOrderBasis[];
}) {
  const unlisted = explicitOrderValues(FieldOrderBasisOrder).filter((source) => !value.includes(source));
  const move = (from: number, to: number) => {
    const next = [...value];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  return (
    <FormField error={error} helperText="The first source with a value for everyone orders the field; later ones break ties." id={id} label="Order by">
      <div className="space-y-2">
      <ol className="space-y-2" data-testid={testId}>
        {value.map((source, index) => (
          <li className="flex flex-wrap items-center gap-2" data-testid={`${testId}-${source}`} key={source}>
            <span className="min-w-20 text-sm text-foreground">{index + 1}. {enumLabel('FieldOrderBasis', source)}</span>
            <Button aria-label={`Move ${enumLabel('FieldOrderBasis', source)} up`} data-testid={`${testId}-${source}-up`} disabled={index === 0} onClick={() => move(index, index - 1)} size="xs" type="button" variant="icon"><ArrowUp aria-hidden size={14} /></Button>
            <Button aria-label={`Move ${enumLabel('FieldOrderBasis', source)} down`} data-testid={`${testId}-${source}-down`} disabled={index === value.length - 1} onClick={() => move(index, index + 1)} size="xs" type="button" variant="icon"><ArrowDown aria-hidden size={14} /></Button>
            <Button aria-label={`Remove ${enumLabel('FieldOrderBasis', source)}`} data-testid={`${testId}-${source}-remove`} disabled={value.length === 1} onClick={() => onChange(value.filter((other) => other !== source))} size="xs" type="button" variant="icon"><X aria-hidden size={14} /></Button>
          </li>
        ))}
      </ol>
      {unlisted.length === 0 ? null : (
        <Select
          aria-label="Add a source"
          data-testid={`${testId}-add`}
          id={id}
          onChange={(event) => {
            const added = unlisted.find((source) => source === event.target.value);
            if (added !== undefined) onChange([...value, added]);
          }}
          value=""
        >
          <option value="">Add a source…</option>
          {unlisted.map((source) => (
            <option key={source} value={source}>{enumLabel('FieldOrderBasis', source)}</option>
          ))}
        </Select>
      )}
      </div>
    </FormField>
  );
}
