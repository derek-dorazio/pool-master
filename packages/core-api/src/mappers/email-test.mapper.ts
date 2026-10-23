/**
 * Maps the root admin's test email (#910) to the EmailTestResponse the Email settings show.
 */
import type { EmailTestResponse } from '@poolmaster/shared/dto';
import type { EmailMessage } from '@poolmaster/shared/domain';

export function toEmailTestResponseDto(message: EmailMessage): EmailTestResponse {
  return {
    status: message.status,
    skipReason: message.skipReason ?? null,
    error: message.lastError ?? null,
  };
}
