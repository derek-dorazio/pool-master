import { ProfileForm } from './profile-form';
import { PasswordChangeForm } from './password-change-form';
import { LinkedAccounts } from './linked-accounts';
import { useProfile } from './hooks/use-profile';

export function ProfilePage() {
  const { data: profile } = useProfile();
  const showPasswordForm = profile?.authProvider === 'email';

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Profile</h1>
        <p className="mt-1 text-muted-foreground">
          Manage your display name, avatar, bio, and public profile information.
        </p>
      </div>

      <ProfileForm />

      {showPasswordForm && <PasswordChangeForm />}

      <LinkedAccounts />
    </div>
  );
}
