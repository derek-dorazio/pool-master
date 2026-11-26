import type { ReactNode } from 'react';
import type { DefaultValues, FieldValues, UseFormReturn } from 'react-hook-form';
import type { ApiErrorCode } from '@poolmaster/shared/dto';
import { hasErrorCode } from '@/lib/errors';
import { DetailEditModal, type MutationActionWorkflowResult } from '@/features/shared/ui';
import type { ProfileEditorProps } from './profile-dialog';
import { ProfileIdentityFields, type ProfileIdentityFieldsProps } from './profile-identity-fields';

/**
 * A tier or pricing profile's one dialog (#1849) on the shared `DetailEditModal`: the view with
 * Close and Edit, then the form with Cancel and Save, a failed save's reason inside it, and the
 * dialog kept open on a refusal. Edit starts the form from the profile as it is now, and leaving
 * the form forgets a failed attempt, so the next Edit starts clean. The form opens with the code,
 * name and sources every profile has, then the profile's own fields.
 */
export function ProfileFormModal<TValues extends FieldValues, TSaved, TProfile extends { name: string }>({
  children,
  dialog,
  errorFallback,
  fieldRefusal,
  form,
  formValues,
  identity,
  kind,
  save,
  newTitle,
}: {
  children: ReactNode;
  dialog: ProfileEditorProps<TProfile>;
  errorFallback: string;
  /** A refusal the form shows under the field it is about, so the dialog does not repeat it above the form. */
  fieldRefusal?: ApiErrorCode;
  form: UseFormReturn<TValues>;
  /** The form's values for the profile as it is now, which Edit starts from. */
  formValues: DefaultValues<TValues>;
  /** The code, name and sources fields, wired to the form. */
  identity: Omit<ProfileIdentityFieldsProps, 'kind'>;
  /** Which profile, which names the dialog's test ids and its fields'. */
  kind: ProfileIdentityFieldsProps['kind'];
  save: MutationActionWorkflowResult<TSaved, TValues>;
  /** The title of a new profile's form; an existing one's dialog is titled by its name. */
  newTitle: string;
}) {
  const cancelEdit = () => {
    save.reset();
    dialog.onCancelEdit();
  };
  const startEdit = () => {
    save.reset();
    form.reset(formValues);
    dialog.onEdit();
  };
  const dismiss = dialog.mode === 'edit' ? cancelEdit : dialog.onClose;
  const name = dialog.profile === null ? null : dialog.profile.name;
  const title = name === null ? newTitle : dialog.mode === 'edit' ? `${name} · Edit` : name;
  return (
    <DetailEditModal
      error={fieldRefusal !== undefined && hasErrorCode(save.error, fieldRefusal) ? null : save.error}
      errorFallback={errorFallback}
      facts={dialog.facts}
      isPending={save.isPending}
      mode={dialog.mode}
      onCancel={dismiss}
      onCancelEdit={cancelEdit}
      onEdit={startEdit}
      onOpenChange={(isOpen) => {
        if (!isOpen) dismiss();
      }}
      // A failed save shows its reason in the dialog, so the rejection is already handled.
      onSave={() => void form.handleSubmit((values) => save.run(values).catch(() => undefined))()}
      open
      pendingLabel="Saving..."
      saveLabel="Save"
      saveTestId={`root-admin-${kind}-profile-editor-save`}
      testId={`root-admin-${kind}-profile-dialog`}
      title={title}
      viewContent={dialog.viewContent}
    >
      <div className="space-y-4">
        <ProfileIdentityFields {...identity} kind={kind} />
        {children}
      </div>
    </DetailEditModal>
  );
}
