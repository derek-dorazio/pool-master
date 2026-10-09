import type { FormEventHandler, ReactNode } from "react";
import { Alert } from "./alert";
import { Button, LinkButton } from "./button";

type FormPageProps = {
  /** Shown above the footer when the save fails. */
  errorMessage?: string | null;
  cancelTo: string;
  children: ReactNode;
  description?: ReactNode;
  isPending: boolean;
  isSubmitDisabled?: boolean;
  onSubmit: FormEventHandler<HTMLFormElement>;
  pendingLabel: string;
  submitLabel: string;
  submitTestId?: string;
  testId?: string;
  title: ReactNode;
};

/**
 * A full-page edit: a heading, the fields, and one Cancel/Save footer. Every property the
 * entity lets you edit sits on the one form with one Save, rather than a dialog per property.
 */
export function FormPage({
  cancelTo,
  children,
  description,
  errorMessage,
  isPending,
  isSubmitDisabled = false,
  onSubmit,
  pendingLabel,
  submitLabel,
  submitTestId,
  testId,
  title,
}: FormPageProps) {
  return (
    <form className="space-y-5" data-testid={testId} noValidate onSubmit={onSubmit}>
      <div>
        <h2 className="font-display text-lg font-extrabold text-foreground">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="space-y-5 rounded-2xl border border-border bg-card p-5">{children}</div>
      {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}
      <div className="flex flex-wrap justify-end gap-3">
        <LinkButton isDisabled={isPending} to={cancelTo} variant="secondary">
          Cancel
        </LinkButton>
        <Button
          data-testid={submitTestId}
          disabled={isSubmitDisabled}
          isLoading={isPending}
          type="submit"
        >
          {isPending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
