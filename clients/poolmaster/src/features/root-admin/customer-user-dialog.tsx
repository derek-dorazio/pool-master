import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { setUserRootAdmin, updateUserProfile, type CustomerUserDto } from '@/lib/api';
import { useAuth } from '@/features/auth/auth-context';
import { ConfirmDialog, DateDisplay, DetailEditModal, FormField, Input, Select, showToast } from '@/features/shared/ui';
import { throwApiError } from '@/lib/errors';
import { refreshAfterWrite, useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { ActiveStatusBadge } from './active-status-badge';
import { useCustomerUserActions } from './customer-user-actions';
import { TemporaryPasswordNotice } from './temporary-password-notice';
import {
  customerUserChange,
  customerUserFormSchema,
  customerUserFormValues,
  type CustomerUserChange,
  type CustomerUserFormValues,
} from './customer-user-edit';
import { customerUserName, customerUserRole, customerUserStatus } from './customer-user-facts';
import { PartialSaveError, runSaveSteps, type SaveStep } from './save-steps';

const TEST_ID = 'root-admin-customer-user-dialog';

/**
 * One user on Customers › Users (#1883): Details, Actions (each behind its own confirm), and Close
 * and Edit. Edit changes the name and the role; a root admin cannot change their own role here.
 */
export function CustomerUserDialog({ onClose, user }: { onClose: () => void; user: CustomerUserDto }) {
  const auth = useAuth();
  const isSelf = auth.user?.id === user.id;
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  // A save that grants or removes root admin waits here for its own confirm.
  const [roleChange, setRoleChange] = useState<CustomerUserChange | null>(null);
  const name = customerUserName(user);
  const form = useForm<CustomerUserFormValues>({
    resolver: zodResolver(customerUserFormSchema),
    defaultValues: customerUserFormValues(user),
    mode: 'onChange',
  });
  const { actions, dialogs, temporaryPassword } = useCustomerUserActions({ isSelf, onDeleted: onClose, user });

  const saveMutation = useInvalidatingMutation({
    mutationFn: ({ isRootAdmin, name: newName }: CustomerUserChange) => {
      const steps: SaveStep[] = [];
      if (newName !== null) {
        steps.push({ what: 'name', run: async () => {
          // The profile write takes the email too; the account's own is sent unchanged.
          const response = await updateUserProfile({ path: { userId: user.id }, body: { email: user.email, ...newName } });
          if (!response.data?.user) throwApiError(response.error, 'Profile update response is missing the user.');
        } });
      }
      if (isRootAdmin !== null) {
        steps.push({ what: 'role', run: async () => {
          const response = await setUserRootAdmin({ path: { userId: user.id }, body: { isRootAdmin } });
          if (!response.data?.success) throwApiError(response.error, 'Role change response is missing success confirmation.');
        } });
      }
      return runSaveSteps(steps);
    },
    // A half-applied save still changed the user, so the grid reads them again.
    onError: (error) => {
      if (error instanceof PartialSaveError) void refreshAfterWrite(queryClient, [QueryKeys.rootAdmin.users, QueryKeys.users.detail(user.id)]);
    },
    onSuccess: () => {
      showToast({ title: `Saved ${name}`, tone: 'success' });
      setMode('view');
    },
    invalidates: [QueryKeys.rootAdmin.users, QueryKeys.users.detail(user.id)],
  });

  const cancelEdit = () => {
    form.reset(customerUserFormValues(user));
    saveMutation.reset();
    setMode('view');
  };

  return (
    <>
      <DetailEditModal
        actions={actions}
        canSave={form.formState.isValid && form.formState.isDirty}
        error={saveMutation.error}
        errorFallback="We could not save this user."
        facts={[
          { id: 'name', label: 'Name', value: name, testId: `${TEST_ID}-name` },
          { id: 'email', label: 'Email', value: user.email, testId: `${TEST_ID}-email` },
          { id: 'role', label: 'Role', value: customerUserRole(user), testId: `${TEST_ID}-role` },
          { id: 'status', label: 'Status', value: <ActiveStatusBadge status={customerUserStatus(user)} />, testId: `${TEST_ID}-status` },
          {
            id: 'leagues',
            label: 'Leagues',
            value: user.leagues.length === 0 ? 'None' : user.leagues.map((league) => league.name).join(', '),
            testId: `${TEST_ID}-leagues`,
          },
          { id: 'joined', label: 'Joined', value: <DateDisplay timeStyle={null} value={user.joinedAt} />, testId: `${TEST_ID}-joined` },
          {
            id: 'last-sign-in',
            label: 'Last sign-in',
            value: user.lastSignInAt === null ? 'Not recorded yet' : <DateDisplay value={user.lastSignInAt} />,
            testId: `${TEST_ID}-last-sign-in`,
          },
        ]}
        isPending={saveMutation.isPending}
        mode={mode}
        onCancel={onClose}
        onCancelEdit={cancelEdit}
        onEdit={() => {
          form.reset(customerUserFormValues(user));
          setMode('edit');
        }}
        onOpenChange={(open) => (open ? undefined : onClose())}
        onSave={() => void form.handleSubmit((values) => {
          const change = customerUserChange(user, values);
          if (change.isRootAdmin === null) saveMutation.mutate(change);
          else setRoleChange(change);
        })()}
        open
        pendingLabel="Saving..."
        saveLabel="Save"
        testId={TEST_ID}
        title={mode === 'view' ? name : `${name} · Edit`}
        viewContent={temporaryPassword === null ? undefined : <TemporaryPasswordNotice password={temporaryPassword} testId={`${TEST_ID}-temp-password`} />}
      >
        <div className="grid gap-4">
          <FormField error={form.formState.errors.firstName?.message} label="First name">
            <Input data-testid={`${TEST_ID}-first-name-input`} {...form.register('firstName')} />
          </FormField>
          <FormField error={form.formState.errors.lastName?.message} label="Last name">
            <Input data-testid={`${TEST_ID}-last-name-input`} {...form.register('lastName')} />
          </FormField>
          <FormField help={isSelf ? 'You cannot change your own role.' : undefined} label="Role">
            <Select data-testid={`${TEST_ID}-role-input`} disabled={isSelf} {...form.register('role')}>
              <option value="MEMBER">Member</option>
              <option value="ROOT_ADMIN">Root admin</option>
            </Select>
          </FormField>
        </div>
      </DetailEditModal>
      {dialogs}
      <ConfirmDialog
        confirmLabel={roleChange?.isRootAdmin === true ? 'Make root admin' : 'Remove root admin'}
        confirmTestId={`${TEST_ID}-submit-role`}
        description={roleChange?.isRootAdmin === true
          ? 'Root admins can use every Manage page: every league, user and sport.'
          : 'They lose the Manage pages and are signed out everywhere.'}
        onCancel={() => setRoleChange(null)}
        onConfirm={() => {
          if (roleChange !== null) saveMutation.mutate(roleChange);
          setRoleChange(null);
        }}
        onOpenChange={(next) => (next ? undefined : setRoleChange(null))}
        open={roleChange !== null}
        testId={`${TEST_ID}-role-confirm`}
        title={roleChange?.isRootAdmin === true ? `Make ${name} a root admin?` : `Remove root admin from ${name}?`}
        tone={roleChange?.isRootAdmin === true ? 'default' : 'danger'}
      />
    </>
  );
}
