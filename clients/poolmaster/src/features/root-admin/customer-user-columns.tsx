import { createColumnHelper } from '@tanstack/react-table';
import { Text } from '@/features/shared/ui';
import type { CustomerUserDto } from '@/lib/api';
import { ActiveStatusBadge } from './active-status-badge';
import { customerUserName, customerUserRole, customerUserStatus } from './customer-user-facts';

const columnHelper = createColumnHelper<CustomerUserDto>();

/** The Customers › Users grid's columns (#1883), each explained behind its (i). */
export const customerUserColumns = [
  columnHelper.accessor(customerUserName, {
    id: 'name',
    header: 'Name',
    meta: { info: 'The user\'s first and last name.', type: { kind: 'text' } },
    cell: ({ getValue }) => <Text tone="primary" variant="strong">{getValue()}</Text>,
  }),
  columnHelper.accessor('email', {
    header: 'Email',
    meta: { info: 'The email address the user signs in with.', type: { kind: 'text' } },
  }),
  columnHelper.accessor(customerUserRole, {
    id: 'role',
    header: 'Role',
    meta: { info: 'Root admin: can use these Manage pages. Member: everyone else.', type: { kind: 'enum' } },
  }),
  columnHelper.accessor(customerUserStatus, {
    id: 'status',
    header: 'Status',
    meta: { info: 'Active, or Inactive: signed out and blocked from signing in until reactivated.', type: { kind: 'enum' } },
    cell: ({ getValue }) => <ActiveStatusBadge status={getValue()} />,
  }),
  columnHelper.accessor((user) => user.leagues.length, {
    id: 'leagues',
    header: 'Leagues',
    meta: { info: 'How many leagues the user is an active member of.', type: { kind: 'number' } },
  }),
  columnHelper.accessor('joinedAt', {
    header: 'Joined',
    meta: { info: 'When the user signed up.', type: { kind: 'date', direction: 'past' } },
  }),
];
