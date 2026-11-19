import { useQuery } from '@tanstack/react-query';
import type { EmailTemplateKey } from '@poolmaster/shared/domain';
import {
  getSystemEmailLatestSend,
  listSystemEmails,
  sendSystemEmailLatestSendToMe,
  sendTestEmail,
  type EmailTestResponse,
  type SystemEmailDto,
  type SystemEmailLatestSendResponse,
  type SystemEmailResendResponse,
} from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';

/** Every system email with its sends of the last 30 days (#1870), for the Notifications page. */
export function useSystemEmailsQuery() {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.systemEmails,
    queryFn: async (): Promise<SystemEmailDto[]> => {
      const response = await listSystemEmails();
      if (!response.data) {
        throwApiError(response.error, 'System emails response is missing data.');
      }
      return response.data.emails;
    },
    retry: false,
  });
}

/** The newest send of an email that still keeps its content, read when its preview opens. */
export function useSystemEmailLatestSendQuery(templateKey: EmailTemplateKey) {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.systemEmailLatestSend(templateKey),
    queryFn: async (): Promise<SystemEmailLatestSendResponse> => {
      const response = await getSystemEmailLatestSend({ path: { templateKey } });
      if (!response.data) {
        throwApiError(response.error, 'Latest send response is missing data.');
      }
      return response.data;
    },
    retry: false,
  });
}

/** Queues a copy of an email's latest send to the calling admin; a new email each press. */
export function useSendLatestToMe() {
  return useInvalidatingMutation({
    mutationFn: async (templateKey: EmailTemplateKey): Promise<SystemEmailResendResponse> => {
      const response = await sendSystemEmailLatestSendToMe({ path: { templateKey } });
      if (!response.data) {
        throwApiError(response.error, 'Send me this email response is missing data.');
      }
      return response.data;
    },
    // A copy is never counted as a send (#1877); refreshing the list keeps it current all the same.
    invalidates: [QueryKeys.rootAdmin.systemEmails],
  });
}

/** Sends the fixed test email (#910) to `to` through the saved email settings. */
export function useCheckDelivery() {
  return useInvalidatingMutation({
    mutationFn: async (to: string): Promise<EmailTestResponse> => {
      const response = await sendTestEmail({ body: { to } });
      if (!response.data) {
        throwApiError(response.error, 'Test email response is missing data.');
      }
      return response.data;
    },
    invalidates: [QueryKeys.rootAdmin.systemEmails],
  });
}
