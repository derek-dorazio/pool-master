import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { CupPointsScale, championshipYear } from '@poolmaster/shared/domain';
import { updateLeagueCupSettings, type LeagueDto } from '@/lib/api';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { syncLeagueCaches } from '@/features/leagues/league-cache';
import { buildLeagueAdminPath } from '@/features/leagues/league-routing';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { ChoiceCard, FormField, FormPage, Input } from '@/features/shared/ui';
import {
  CUP_POINTS_SCALES,
  CUP_POINTS_SCALE_COPY,
  POINTS_PREVIEW_FIELD,
  formatCustomPoints,
  parseCustomPoints,
  previewPoints,
} from './cup-settings-view';

const championshipSettingsFormSchema = z.object({
  cupName: z.string().trim().min(1, 'Championship name is required').max(100, 'Championship name must be 100 characters or fewer'),
  cupPointsScale: z.nativeEnum(CupPointsScale),
  customPoints: z.string(),
}).superRefine((values, context) => {
  if (values.cupPointsScale !== CupPointsScale.CUSTOM) {
    return;
  }
  const parsed = parseCustomPoints(values.customPoints);
  if (parsed.error !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: parsed.error, path: ['customPoints'] });
  }
});

type ChampionshipSettingsFormValues = z.infer<typeof championshipSettingsFormSchema>;

/** Edit championships: the league championship's name and the points table every cup scores on. */
export function EditChampionshipSettingsPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const { league } = useLeagueContext(leagueCode);

  // The guard above this page has already loaded the league context.
  if (!league) {
    return null;
  }
  // An inactive league is read-only; its settings page says why Edit is unavailable.
  if (!league.isActive) {
    return <Navigate replace to={buildLeagueAdminPath(league.leagueCode)} />;
  }

  // Keyed by the league so a background refetch never overwrites the draft
  // (rules/react-ui-rules.md §5 Server Data Form-State Hazard).
  return <ChampionshipSettingsForm key={league.id} league={league} />;
}

/** The first places' points on the table being chosen, so the commissioner sees what it pays. */
function PointsPreview({ scale, customPoints }: { scale: CupPointsScale; customPoints: string }) {
  const custom = scale === CupPointsScale.CUSTOM ? parseCustomPoints(customPoints) : null;
  if (custom?.error) {
    return <p className="text-sm text-muted-foreground" data-testid="championship-points-preview-empty">Enter the custom points to see what each place earns.</p>;
  }
  const rows = previewPoints({ scale, customPoints: custom?.points ?? [] });
  return (
    <div className="space-y-2" data-testid="championship-points-preview">
      <ol className="grid grid-cols-5 gap-2 text-center text-sm">
        {rows.map((row) => (
          <li className="rounded-xl bg-muted/40 px-2 py-2" data-testid={`championship-points-preview-${row.place}`} key={row.place}>
            <span className="block text-xs text-muted-foreground">{row.place}</span>
            <span className="font-semibold tabular-nums text-foreground">{row.points}</span>
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">
        {scale === CupPointsScale.FIELD_BEATEN ? `In a contest of ${POINTS_PREVIEW_FIELD} entries. ` : ''}
        Bonus contests earn x1.5 and double contests x2. Squads tied on a place share its points.
      </p>
    </div>
  );
}

function ChampionshipSettingsForm({ league }: { league: LeagueDto }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const settingsPath = buildLeagueAdminPath(league.leagueCode);
  const form = useForm<ChampionshipSettingsFormValues>({
    resolver: zodResolver(championshipSettingsFormSchema),
    defaultValues: {
      cupName: league.cupName,
      cupPointsScale: league.cupPointsScale,
      customPoints: formatCustomPoints(league.cupCustomPoints),
    },
  });
  const scale = form.watch('cupPointsScale');
  const customPoints = form.watch('customPoints');
  const cupName = form.watch('cupName').trim();

  const saveMutation = useInvalidatingMutation({
    mutationFn: async (values: ChampionshipSettingsFormValues) => {
      const isCustom = values.cupPointsScale === CupPointsScale.CUSTOM;
      const response = await updateLeagueCupSettings({
        path: { id: league.id },
        body: {
          cupName: values.cupName,
          cupPointsScale: values.cupPointsScale,
          // The resolver has checked the custom points; every other table sends none.
          cupCustomPoints: isCustom ? parseCustomPoints(values.customPoints).points ?? [] : [],
        },
      });
      if (!response.data?.league) {
        throwApiError(response.error, 'Championship settings response is missing data.');
      }
      return response.data.league;
    },
    onSuccess: (updated) => {
      syncLeagueCaches(queryClient, updated);
      navigate(settingsPath);
    },
    // Open cups score on the table as it stands, and the championship is named by the cup name.
    invalidates: [QueryKeys.cups.all, QueryKeys.championship.all],
  });

  return (
    <FormPage
      cancelTo={settingsPath}
      description="The championship every contest counts toward, and what each finishing place earns in it and in every sports league cup."
      errorMessage={saveMutation.isError
        ? extractErrorMessage(saveMutation.error, { fallback: 'We could not save the championship settings.' })
        : null}
      isPending={saveMutation.isPending}
      onSubmit={(event) => void form.handleSubmit((values) => saveMutation.mutate(values))(event)}
      pendingLabel="Saving..."
      submitLabel="Save settings"
      submitTestId="edit-championships-save"
      testId="edit-championships-page"
      title="Edit championships"
    >
      <FormField
        error={form.formState.errors.cupName?.message}
        helperText={cupName ? `Members see it with the year in front: ${championshipYear(new Date())} ${cupName}.` : undefined}
        id="edit-championships-name"
        label="Championship name"
      >
        <Input
          data-testid="edit-championships-name"
          disabled={saveMutation.isPending}
          id="edit-championships-name"
          type="text"
          {...form.register('cupName')}
        />
      </FormField>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground">Points table</legend>
        <div aria-label="Points table" className="grid gap-2" role="radiogroup">
          {CUP_POINTS_SCALES.map((option) => (
            <ChoiceCard
              isDisabled={saveMutation.isPending}
              isSelected={option === scale}
              key={option}
              onSelect={() => form.setValue('cupPointsScale', option, { shouldDirty: true })}
              testId={`edit-championships-scale-${option}`}
            >
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{CUP_POINTS_SCALE_COPY[option].label}</span>
                <span className="block text-xs text-muted-foreground">{CUP_POINTS_SCALE_COPY[option].description}</span>
              </span>
            </ChoiceCard>
          ))}
        </div>
      </fieldset>

      {scale === CupPointsScale.CUSTOM ? (
        <FormField
          error={form.formState.errors.customPoints?.message}
          helperText="1st place first, separated by commas: 10, 6, 4, 3, 2, 1."
          id="edit-championships-custom-points"
          label="Custom points"
        >
          <Input
            data-testid="edit-championships-custom-points"
            disabled={saveMutation.isPending}
            id="edit-championships-custom-points"
            inputMode="numeric"
            type="text"
            {...form.register('customPoints')}
          />
        </FormField>
      ) : null}

      <div className="space-y-2">
        <div className="text-sm font-medium text-foreground">What each place earns</div>
        <PointsPreview customPoints={customPoints} scale={scale} />
      </div>

      <p className="text-xs text-muted-foreground" data-testid="championship-points-change-note">
        A new table rescores open cups at once, every contest in them included. The championship and
        crowned cups keep the points their contests earned when they went final, so after a change an
        open cup and this year&apos;s championship can show different totals for the same contests.
      </p>
    </FormPage>
  );
}
