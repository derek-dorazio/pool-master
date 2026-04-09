import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useUpdatePassword } from './hooks/use-profile';
import { cn } from '@/lib/utils';

function getPasswordStrength(password: string): { label: string; score: number } {
  let score = 0;
  if (password.length >= 8) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  if (score <= 1) return { label: 'Weak', score: 1 };
  if (score <= 2) return { label: 'Fair', score: 2 };
  if (score <= 3) return { label: 'Strong', score: 3 };
  return { label: 'Very Strong', score: 4 };
}

const strengthColors: Record<number, string> = {
  1: 'bg-destructive',
  2: 'bg-orange-500',
  3: 'bg-yellow-500',
  4: 'bg-green-500',
};

export function PasswordChangeForm() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const updatePassword = useUpdatePassword();

  const strength = getPasswordStrength(newPassword);

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!currentPassword) errs.currentPassword = 'Required';
    if (newPassword.length < 8) errs.newPassword = 'Must be at least 8 characters';
    else if (!/[A-Z]/.test(newPassword)) errs.newPassword = 'Must include an uppercase letter';
    else if (!/[a-z]/.test(newPassword)) errs.newPassword = 'Must include a lowercase letter';
    else if (!/\d/.test(newPassword)) errs.newPassword = 'Must include a digit';
    if (confirmPassword !== newPassword) errs.confirmPassword = 'Passwords do not match';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    updatePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          setCurrentPassword('');
          setNewPassword('');
          setConfirmPassword('');
          setIsOpen(false);
        },
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Password</CardTitle>
          {!isOpen && (
            <Button variant="outline" size="sm" onClick={() => setIsOpen(true)}>
              Change Password
            </Button>
          )}
        </div>
      </CardHeader>

      {isOpen && (
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Current Password</Label>
              <Input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
              {errors.currentPassword && (
                <p className="text-xs text-destructive">{errors.currentPassword}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              {newPassword && (
                <div className="space-y-1">
                  <div className="flex h-2 gap-1">
                    {[1, 2, 3, 4].map((level) => (
                      <div
                        key={level}
                        className={cn(
                          'h-full flex-1 rounded-full',
                          level <= strength.score
                            ? strengthColors[strength.score]
                            : 'bg-muted',
                        )}
                      />
                    ))}
                  </div>
                  <p
                    className="text-xs text-muted-foreground"
                    aria-label={`Password strength: ${strength.label}`}
                  >
                    Strength: {strength.label}
                  </p>
                </div>
              )}
              {errors.newPassword && (
                <p className="text-xs text-destructive">{errors.newPassword}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm New Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              {errors.confirmPassword && (
                <p className="text-xs text-destructive">{errors.confirmPassword}</p>
              )}
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={updatePassword.isPending}>
                {updatePassword.isPending ? 'Updating...' : 'Update Password'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      )}
    </Card>
  );
}
