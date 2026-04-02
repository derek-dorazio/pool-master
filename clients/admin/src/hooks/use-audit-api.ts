import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { client } from '@/lib/api';

export interface AuditEntry {
  id: string;
  timestamp: string;
  admin: string;
  action: string;
  resourceType: string;
  resourceId: string;
  description: string;
  reason?: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  ipAddress: string;
  userAgent: string;
}

export interface AuditFilters {
  admin: string;
  action: string;
  resourceType: string;
  dateFrom: string;
  dateTo: string;
  search: string;
  page: number;
}

export function useAuditLog(filters: AuditFilters) {
  return useQuery({
    queryKey: ['audit-log', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.admin && filters.admin !== 'All') params.set('admin', filters.admin);
      if (filters.action && filters.action !== 'All') params.set('action', filters.action);
      if (filters.resourceType && filters.resourceType !== 'All') params.set('resourceType', filters.resourceType);
      if (filters.search) params.set('search', filters.search);
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.set('dateTo', filters.dateTo);
      params.set('page', String(filters.page));
      const query = params.toString();
      const { data } = await client.get({
        url: `/api/v1/admin/audit-log${query ? `?${query}` : ''}`,
      });
      return data;
    },
    placeholderData: keepPreviousData,
  });
}
