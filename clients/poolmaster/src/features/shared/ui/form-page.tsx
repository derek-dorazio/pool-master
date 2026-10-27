import type { ReactNode, SubmitEventHandler } from "react";
import { Alert } from "./alert";
import { Button, LinkButton } from "./button";
import { Tile } from "./tile";

type FormPageProps = {
  /** Shown above the footer when the save fails. */
  errorMessage?: string | null;
  cancelTo: string;
  children: ReactNode;
  description?: ReactNode;
  isPending: boolean;
  isSubmitDisabled?: boolean;
  onSubmit: SubmitEventHandler<HTMLFormElement>;
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
        <h2 className="title-card text-lg text-foreground">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <Tile className="space-y-5 p-5" padding="none" radius="md">{children}</Tile>
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
