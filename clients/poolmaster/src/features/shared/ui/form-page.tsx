import type { ReactNode, SubmitEventHandler } from "react";
import { Alert } from "./alert";
import { Button, LinkButton } from "./button";
import { Tile } from "./tile";
import { PageHeader } from "./page-header";

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
  title: string;
};

/**
 * A full-page edit: the page's `PageHeader`, the fields, and one Cancel/Save footer. Every
 * property the entity lets you edit sits on the one form with one Save. A root admin page that
 * uses it claims the heading, so the Manage header shows only its breadcrumbs.
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
      <PageHeader description={description} title={title} />
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
