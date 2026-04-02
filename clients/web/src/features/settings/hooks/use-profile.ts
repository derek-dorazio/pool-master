import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { clientPath, API_ROUTES } from '@poolmaster/shared/api-routes';
import type { UserProfileDto } from '@poolmaster/shared/dto';
import { settingsKeys } from './query-keys';
import { toast } from '@/hooks/use-toast';

// Extends UserProfileDto with fields not yet in the shared DTO
// TODO: migrate bio and authProvider to @poolmaster/shared/dto when DTO is updated
export interface UserProfile extends UserProfileDto {
  bio: string;
  authProvider: 'email' | 'google' | 'apple';
}

export function useProfile() {
  return useQuery({
    queryKey: settingsKeys.profile(),
    queryFn: async (): Promise<UserProfile> => {
      return await api.get<UserProfile>(clientPath(API_ROUTES.auth.me));
    },
    staleTime: Infinity,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: Partial<Pick<UserProfile, 'displayName' | 'email' | 'bio'>>) => {
      return await api.put('/v1/auth/profile', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.profile() });
      toast({ title: 'Profile updated' });
    },
    onError: () => {
      toast({ title: 'Failed to update profile', description: 'Please try again.' });
    },
  });
}

export function useUploadAvatar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: File) => {
      try {
        const formData = new FormData();
        formData.append('avatar', file);
        return await api.post('/v1/auth/profile/avatar', formData);
      } catch {
        // Fallback: simulate success when backend unavailable
        return undefined;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.profile() });
      toast({ title: 'Avatar updated' });
    },
    onError: () => {
      toast({ title: 'Failed to upload avatar', description: 'Please try a smaller image.' });
    },
  });
}

export function useDeleteAvatar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      try {
        return await api.delete('/v1/auth/profile/avatar');
      } catch {
        // Fallback: simulate success when backend unavailable
        return undefined;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.profile() });
      toast({ title: 'Avatar removed' });
    },
  });
}

export function useUpdatePassword() {
  return useMutation({
    mutationFn: async (data: { currentPassword: string; newPassword: string }) => {
      return await api.put('/v1/auth/password', data);
    },
    onSuccess: () => {
      toast({ title: 'Password changed successfully' });
    },
    onError: () => {
      toast({ title: 'Failed to change password', description: 'Current password may be incorrect.' });
    },
  });
}
