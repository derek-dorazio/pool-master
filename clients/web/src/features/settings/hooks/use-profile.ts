import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client, getCurrentUser } from '@/lib/api';
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
      const { data, error } = await getCurrentUser({ client });
      if (error) throw error;
      // The generated type wraps the profile in a `user` object;
      // cast to UserProfile which extends UserProfileDto with extra fields
      return (data as unknown as { user: UserProfile }).user;
    },
    staleTime: Infinity,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: Partial<Pick<UserProfile, 'displayName' | 'email' | 'bio'>>) => {
      const { data, error } = await client.put({
        url: '/api/v1/auth/profile',
        body,
        headers: { 'Content-Type': 'application/json' },
      });
      if (error) throw error;
      return data;
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
      const formData = new FormData();
      formData.append('avatar', file);
      const { data, error } = await client.post({
        url: '/api/v1/auth/profile/avatar',
        body: formData,
      });
      if (error) throw error;
      return data;
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
      const { error } = await client.delete({
        url: '/api/v1/auth/profile/avatar',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.profile() });
      toast({ title: 'Avatar removed' });
    },
  });
}

export function useUpdatePassword() {
  return useMutation({
    mutationFn: async (body: { currentPassword: string; newPassword: string }) => {
      const { error } = await client.put({
        url: '/api/v1/auth/password',
        body,
        headers: { 'Content-Type': 'application/json' },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Password changed successfully' });
    },
    onError: () => {
      toast({ title: 'Failed to change password', description: 'Current password may be incorrect.' });
    },
  });
}
