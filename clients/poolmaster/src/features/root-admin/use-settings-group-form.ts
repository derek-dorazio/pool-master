import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm, type DefaultValues, type FieldValues, type Resolver } from 'react-hook-form';
import { updateSettingsGroup, type SettingsGroup } from '@/lib/api';
import { hasErrorCode, throwApiError } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';

/**
 * The form for one settings group (#450): the draft is taken from the group once, when the form
 * mounts, so a background refetch never overwrites an admin's edits. A save sends the
 * `updatedAt` the draft was taken from; when someone else saved first the server answers 409,
 * `conflicted` is set, and `loadLatest` fetches the newer version and starts the draft from it.
 * `onTaken` hears each version the form takes up, after a save or a load, for state kept beside
 * the form.
 */
export function useSettingsGroupForm<G extends SettingsGroup, V extends FieldValues>({
  group,
  onTaken,
  resolver,
  subject,
  toForm,
  toValue,
}: {
  group: G;
  onTaken?: (group: G) => void;
  resolver: Resolver<V>;
  /** What the settings are called in the missing-data error, such as `Email settings`. */
  subject: string;
  toForm: (value: G['value']) => DefaultValues<V>;
  toValue: (values: V) => G['value'];
}) {
  const queryClient = useQueryClient();
  const { key } = group;
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(group.updatedAt);
  const form = useForm<V>({ resolver, defaultValues: toForm(group.value) });

  const take = (taken: G) => {
    setBaseUpdatedAt(taken.updatedAt);
    onTaken?.(taken);
    form.reset(toForm(taken.value));
  };
  const isThisGroup = (candidate: SettingsGroup): candidate is G => candidate.key === key;

  const saveMutation = useInvalidatingMutation({
    mutationFn: async (values: V) => {
      const body = { key, value: toValue(values), expectedUpdatedAt: baseUpdatedAt } as Parameters<typeof updateSettingsGroup>[0]['body'];
      const response = await updateSettingsGroup({ path: { key }, body });
      if (!response.data || !isThisGroup(response.data)) {
        throwApiError(response.error, `${subject} response is missing data.`);
      }
      return response.data;
    },
    onSuccess: take,
    invalidates: [QueryKeys.rootAdmin.settings],
  });

  // A 409 refetches nothing (invalidation runs on success only), so `group` is still the version
  // that conflicted. The screen read it either alone or in the list of every group: read again
  // whichever it holds and start the draft from that.
  async function loadLatest() {
    const groupKey = QueryKeys.rootAdmin.settingsGroup(key);
    await queryClient.refetchQueries({ queryKey: groupKey, exact: true });
    await queryClient.refetchQueries({ queryKey: QueryKeys.rootAdmin.settings, exact: true });
    const latest = queryClient.getQueryData<G>(groupKey)
      ?? queryClient.getQueryData<SettingsGroup[]>(QueryKeys.rootAdmin.settings)?.find(isThisGroup);
    if (!latest) {
      return;
    }
    take(latest);
    saveMutation.reset();
  }

  return {
    conflicted: hasErrorCode(saveMutation.error, 'SETTINGS_CONFLICT'),
    form,
    loadLatest,
    saveMutation,
    submit: form.handleSubmit((values) => saveMutation.mutate(values)),
  };
}
