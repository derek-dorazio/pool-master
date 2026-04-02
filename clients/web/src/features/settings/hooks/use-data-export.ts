import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { clientPath, API_ROUTES } from '@poolmaster/shared/api-routes';
import { client } from '@/lib/api-client-generated';
import { settingsKeys } from './query-keys';
import { toast } from '@/hooks/use-toast';

export interface DataExportStatus {
  status: 'none' | 'pending' | 'ready';
  requestedAt: string | null;
  downloadUrl: string | null;
  expiresAt: string | null;
  nextAllowedAt: string | null;
}

export function useDataExportStatus() {
  return useQuery({
    queryKey: settingsKeys.dataExport(),
    queryFn: async (): Promise<DataExportStatus> => {
      // TODO: migrate to generated client when backend adds GET /api/v1/account/data-export to OpenAPI spec
      return await api.get<DataExportStatus>(clientPath(API_ROUTES.account.dataExport));
    },
  });
}

export function useRequestDataExport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const result: any = await client.POST('/api/v1/account/data-export');
      if (result.error) throw result.error;
      if (!result.response.ok) throw new Error(`Request failed: ${result.response.status}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.dataExport() });
      toast({ title: 'Data export requested', description: 'We\'ll email you a download link within 48 hours.' });
    },
    onError: () => {
      toast({ title: 'Failed to request data export', description: 'Please try again.' });
    },
  });
}
