import type { ReactNode, SubmitEventHandler } from "react";
import { Notice } from "./notice";
import { Button, LinkButton } from "./button";
import { Tile } from "./tile";
import { Heading } from "./heading";
import { HelpTip } from "./help-tip";
import { Text } from "./text";

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
  title: ReactNode;
};

/**
 * A full-page edit: a heading, the fields, and one Cancel/Save footer. Every property the
 * entity lets you edit sits on the one form with one Save, rather than a dialog per property.
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
      <div>
        <div className="flex items-center">
          <Heading level={2} variant="subtitle">{title}</Heading>
          {help ? (
            <HelpTip className="-my-2" label="How this form works" testId={testId ? `${testId}-help` : "form-page-help"}>
              {help}
            </HelpTip>
          ) : null}
        </div>
        {meta ? <Text as="p" variant="meta">{meta}</Text> : null}
      </div>
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
