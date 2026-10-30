import type { SubmitEventHandler } from 'react';
import type { FieldValues, UseFormReturn } from 'react-hook-form';
import { extractErrorMessage } from './errors';

/**
 * What a `FormPage` takes from its form and the mutation that saves it: a submit that checks the
 * form and then saves its values, whether the save is running, and its failure in words.
 */
export function formPageSave<Fields extends FieldValues, Context, Values extends FieldValues>(
  form: Pick<UseFormReturn<Fields, Context, Values>, 'handleSubmit'>,
  mutation: { error: Error | null; isError: boolean; isPending: boolean; mutate: (values: Values) => void },
  errorFallback: string,
): { errorMessage: string | null; isPending: boolean; onSubmit: SubmitEventHandler<HTMLFormElement> } {
  return {
    errorMessage: mutation.isError ? extractErrorMessage(mutation.error, { fallback: errorFallback }) : null,
    isPending: mutation.isPending,
    onSubmit: (event) => void form.handleSubmit((values) => mutation.mutate(values))(event),
  };
}
