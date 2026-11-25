import { z } from 'zod';
import type { CustomerUserDto } from '@/lib/api';

export const CUSTOMER_USER_ROLES = ['MEMBER', 'ROOT_ADMIN'] as const;

export const customerUserFormSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter a first name.').max(100, 'Keep it to 100 characters.'),
  lastName: z.string().trim().min(1, 'Enter a last name.').max(100, 'Keep it to 100 characters.'),
  role: z.enum(CUSTOMER_USER_ROLES),
});
export type CustomerUserFormValues = z.infer<typeof customerUserFormSchema>;

export function customerUserFormValues(user: CustomerUserDto): CustomerUserFormValues {
  return { firstName: user.firstName, lastName: user.lastName, role: user.isRootAdmin ? 'ROOT_ADMIN' : 'MEMBER' };
}

/** What a Save changes: the name when either part moved, and the role when it moved. */
export type CustomerUserChange = {
  name: { firstName: string; lastName: string } | null;
  isRootAdmin: boolean | null;
};

export function customerUserChange(user: CustomerUserDto, values: CustomerUserFormValues): CustomerUserChange {
  const firstName = values.firstName.trim();
  const lastName = values.lastName.trim();
  // poolmaster-allow-enum-literal: the Role field's own encoding of isRootAdmin; LeagueRole and EmailCategory only share the words
  const isRootAdmin = values.role === 'ROOT_ADMIN';
  return {
    name: firstName === user.firstName && lastName === user.lastName ? null : { firstName, lastName },
    isRootAdmin: isRootAdmin === user.isRootAdmin ? null : isRootAdmin,
  };
}
