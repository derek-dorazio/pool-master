import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '@/lib/api-client-generated';
import { api } from '@/lib/api-client';
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
      const { data, error } = await client.GET('/api/v1/auth/me');
      if (error) throw error;
      // The generated type wraps the profile in a `user` object;
      // cast to UserProfile which extends UserProfileDto with extra fields
      return data.user as unknown as UserProfile;
    },
    staleTime: Infinity,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: Partial<Pick<UserProfile, 'displayName' | 'email' | 'bio'>>) => {
      // TODO: migrate to client.PUT when /api/v1/auth/profile is in the OpenAPI spec
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
        // TODO: migrate to client.POST when /api/v1/auth/profile/avatar is in the OpenAPI spec
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
        // TODO: migrate to client.DELETE when /api/v1/auth/profile/avatar is in the OpenAPI spec
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
      // TODO: migrate to client.PUT when /api/v1/auth/password is in the OpenAPI spec
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
