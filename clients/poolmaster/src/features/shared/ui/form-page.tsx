import type { ReactNode, SubmitEventHandler } from "react";
import { Notice } from "./notice";
import { Button, LinkButton } from "./button";
import { Tile } from "./tile";
import { HelpTip } from "./help-tip";
import { PageHeader } from "./page-header";

type FormPageProps = {
  /** Shown above the footer when the save fails. */
  errorMessage?: string | null;
  cancelTo: string;
  children: ReactNode;
  /** How the form works, behind a (?) after the title, never a sentence on the page. */
  help?: ReactNode;
  isPending: boolean;
  /** One fact line under the title: the facts the form acts on, never how it works. */
  meta?: ReactNode;
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
  errorMessage,
  help,
  isPending,
  isSubmitDisabled = false,
  meta,
  onSubmit,
  pendingLabel,
  submitLabel,
  submitTestId,
  testId,
  title,
}: FormPageProps) {
  return (
    <form className="space-y-5" data-testid={testId} noValidate onSubmit={onSubmit}>
      <PageHeader
        meta={meta}
        title={title}
        titleAside={help ? (
          <HelpTip className="-my-2" label="How this form works" testId={testId ? `${testId}-help` : "form-page-help"}>
            {help}
          </HelpTip>
        ) : null}
      />
      <Tile className="space-y-5 p-5" padding="none" radius="md">{children}</Tile>
      {errorMessage ? <Notice tone="danger">{errorMessage}</Notice> : null}
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
