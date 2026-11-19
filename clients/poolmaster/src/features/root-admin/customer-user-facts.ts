import type { CustomerUserDto } from '@/lib/api';
import { formatUserName } from '@/features/account/user-name';

/** A user's role as Customers shows it. */
export function customerUserRole(user: Pick<CustomerUserDto, 'isRootAdmin'>): 'Root admin' | 'Member' {
  return user.isRootAdmin ? 'Root admin' : 'Member';
}

/** A user's account status as Customers shows it. */
export function customerUserStatus(user: Pick<CustomerUserDto, 'isActive'>): 'Active' | 'Inactive' {
  return user.isActive ? 'Active' : 'Inactive';
}

export function customerUserName(user: Pick<CustomerUserDto, 'firstName' | 'lastName'>): string {
  return formatUserName(user.firstName, user.lastName);
}
