import type { AccountResponse } from '@poolmaster/shared/dto';
import type { User } from '@poolmaster/shared/domain';
import { toUserDto } from './users.mapper';

/**
 * #202 step 3.4 — this held the THIRD copy of the User projection AND the third copy of the
 * row→domain enum mapping. Enum mapping belongs at the row boundary, which is the adapter;
 * the projection belongs in one place, which is `users.mapper.ts`. What is left is the
 * envelope.
 */
export function mapAccountResponse(user: User): AccountResponse {
  return {
    user: toUserDto(user),
  };
}
