import { enumLabel } from '@poolmaster/shared/display-strings';
import { DateDisplay, QueryState, ReadOnlyDetailModal } from '@/features/shared/ui';
import type { SystemEmailDto } from '@/lib/api';
import { extractErrorMessage } from '@/lib/errors';
import { useSystemEmailLatestSendQuery } from './use-system-emails';

/**
 * An email's latest send as it went (#1872): its subject, who it went to (masked) and its HTML at
 * email width in a sandboxed frame, which runs no script and reaches nothing of the page. The
 * server has already made the links that act for the recipient dead. Only Close: what the email
 * can do is in the email's own dialog.
 */
export function SystemEmailPreviewDialog({ email, onClose }: { email: SystemEmailDto; onClose: () => void }) {
  const latestQuery = useSystemEmailLatestSendQuery(email.templateKey);
  const name = enumLabel('EmailTemplateKey', email.templateKey);
  const latest = latestQuery.data;

  return (
    <ReadOnlyDetailModal
      detailContent={(
        <QueryState
          error={extractErrorMessage(latestQuery.error, { fallback: 'We could not load this email right now.' })}
          loading="Loading the email..."
          query={latestQuery}
          testId="root-admin-system-email-preview-state"
        >
          {(sent) => (
            <iframe
              className="mx-auto block h-[70vh] w-full max-w-[640px] rounded-lg border border-border bg-white"
              data-testid="root-admin-system-email-preview-frame"
              sandbox=""
              srcDoc={sent.htmlBody}
              title={`${name} as sent`}
            />
          )}
        </QueryState>
      )}
      details={latest
        ? [
          { id: 'subject', label: 'Subject', value: <span data-testid="root-admin-system-email-preview-subject">{latest.subject}</span> },
          { id: 'to', label: 'To', value: <span data-testid="root-admin-system-email-preview-recipient">{latest.recipient}</span> },
        ]
        : undefined}
      onCancel={onClose}
      // Opened from outside, so the one change the dialog reports is a close.
      onOpenChange={onClose}
      open
      size="xl"
      testId="root-admin-system-email-preview"
      title={(
        <>
          {name} · Preview · sent <DateDisplay value={latest?.sentAt ?? email.previewSentAt} />
        </>
      )}
    />
  );
}
