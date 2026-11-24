/**
 * The rate-limit finding (league model 1c): a Provider that turns every call away raises a WARNING
 * on each league it syncs after a quarter of an hour, an ERROR once the streak lasts the league's
 * quiet threshold, and resolves them at its next answer. The finding service is a double; what
 * it writes is proved in provider-sync-finding-service.test.ts.
 */
import { expect } from '@jest/globals';
import { ProviderCode, ProviderSyncFindingSeverity, type ProviderLeagueSettings } from '@poolmaster/shared/domain';
import {
  PROVIDER_RATE_LIMITED_WARNING_AFTER_MS,
  ProviderRateLimitWatch,
} from '../../../packages/core-api/src/modules/ingestion/findings/provider-rate-limit-watch';
import { buildProviderMapping, buildSportLeague } from '../../factories';
import { BALLDONTLIE_TEST_LEAGUES, balldontlieTestProvider } from '../../support/balldontlie-provider-rows';
import { fakeLogger } from '../../support/fake-logger';

const MINUTE = 60_000;
const PROVIDER = balldontlieTestProvider();
const providerLeague = (code: string): ProviderLeagueSettings => {
  const league = BALLDONTLIE_TEST_LEAGUES.find((each) => each.code === code);
  if (league === undefined) throw new Error(`no test league ${code}`);
  return league;
};
const NFL = providerLeague('nfl'); // quiet after 90 minutes
const PGA = providerLeague('pga'); // quiet after 360 minutes

function watch(options: { enabled?: ProviderLeagueSettings[]; hasRow?: boolean } = {}) {
  let clock = 0;
  const raised: { providerId: string; leagues: { sportLeagueId: string; severity: ProviderSyncFindingSeverity }[] }[] = [];
  const resolved: string[] = [];
  let leagueReads = 0;
  let failNextRaise = false;
  const logger = fakeLogger();
  const subject = new ProviderRateLimitWatch({
    findings: {
      raiseProviderRateLimited: async (input) => {
        if (failNextRaise) { failNextRaise = false; throw new Error('database down'); }
        raised.push({ providerId: input.providerId, leagues: [...input.leagues] });
      },
      resolveProviderRateLimited: async (providerId) => { resolved.push(providerId); return 1; },
    },
    providers: {
      byCode: () => (options.hasRow === false ? undefined : PROVIDER),
      enabledLeagues: () => options.enabled ?? [NFL, PGA],
    },
    syncedLeagues: async () => {
      leagueReads += 1;
      return [
        buildSportLeague({ id: 'nfl', selectedProviderMapping: buildProviderMapping({ providerLeagueId: NFL.id }) }),
        buildSportLeague({ id: 'pga', selectedProviderMapping: buildProviderMapping({ providerLeagueId: PGA.id }) }),
        buildSportLeague({ id: 'unsynced', selectedProviderMapping: null }),
      ];
    },
    now: () => clock,
    logger,
  });
  const observer = subject.observerFor(ProviderCode.BALLDONTLIE);
  const refusedAt = async (minutes: number) => { clock = minutes * MINUTE; observer.refused(); await subject.settled(); };
  const answeredAt = async (minutes: number) => { clock = minutes * MINUTE; observer.answered(); await subject.settled(); };
  return {
    raised, resolved, logger, refusedAt, answeredAt,
    leagueReads: () => leagueReads,
    failNextRaise: () => { failNextRaise = true; },
  };
}

describe('ProviderRateLimitWatch', () => {
  it('raises nothing, and reads no leagues, while the streak is shorter than a quarter of an hour', async () => {
    const w = watch();

    await w.refusedAt(0);
    await w.refusedAt(14);

    expect(PROVIDER_RATE_LIMITED_WARNING_AFTER_MS).toBe(15 * MINUTE);
    expect(w.raised).toEqual([]);
    expect(w.leagueReads()).toBe(0);
  });

  it('raises a WARNING on each league the Provider syncs once every call has been turned away for a quarter of an hour', async () => {
    const w = watch();

    await w.refusedAt(0);
    await w.refusedAt(15);

    expect(w.raised).toEqual([{
      providerId: PROVIDER.id,
      leagues: [{ sportLeagueId: 'nfl', severity: ProviderSyncFindingSeverity.WARNING }, { sportLeagueId: 'pga', severity: ProviderSyncFindingSeverity.WARNING }],
    }]);
  });

  it('raises each league again only when its severity changes, and reads the leagues only past a new threshold', async () => {
    const w = watch();

    await w.refusedAt(0);
    await w.refusedAt(15);
    await w.refusedAt(40);
    await w.refusedAt(89);

    expect(w.raised).toHaveLength(1);
    expect(w.leagueReads()).toBe(1);
  });

  it('escalates a league to ERROR at its own quiet threshold, the NFL at 90 minutes and golf at 360', async () => {
    const w = watch();

    await w.refusedAt(0);
    await w.refusedAt(15);
    await w.refusedAt(90);
    await w.refusedAt(360);

    expect(w.raised.slice(1)).toEqual([
      { providerId: PROVIDER.id, leagues: [{ sportLeagueId: 'nfl', severity: ProviderSyncFindingSeverity.ERROR }] },
      { providerId: PROVIDER.id, leagues: [{ sportLeagueId: 'pga', severity: ProviderSyncFindingSeverity.ERROR }] },
    ]);
  });

  it('raises an ERROR straight away for a league whose quiet threshold is shorter than a quarter of an hour', async () => {
    const w = watch({ enabled: [{ ...NFL, quietAfterMinutes: 10 }] });

    await w.refusedAt(0);
    await w.refusedAt(10);

    expect(w.raised).toEqual([{ providerId: PROVIDER.id, leagues: [{ sportLeagueId: 'nfl', severity: ProviderSyncFindingSeverity.ERROR }] }]);
  });

  it('leaves out a league whose Provider league is switched off', async () => {
    const w = watch({ enabled: [PGA] });

    await w.refusedAt(0);
    await w.refusedAt(15);

    expect(w.raised).toEqual([{ providerId: PROVIDER.id, leagues: [{ sportLeagueId: 'pga', severity: ProviderSyncFindingSeverity.WARNING }] }]);
  });

  it('resolves the Provider\'s findings at its next answer, and the next refusal starts a new streak', async () => {
    const w = watch();

    await w.refusedAt(0);
    await w.refusedAt(15);
    await w.answeredAt(16);
    await w.refusedAt(20);
    await w.refusedAt(34);

    expect(w.resolved).toEqual([PROVIDER.id]);
    expect(w.raised).toHaveLength(1);

    await w.refusedAt(35);
    expect(w.raised).toHaveLength(2);
  });

  it('resolves what an earlier task left open at the first answer after start, and does not read the findings at every answer after', async () => {
    const w = watch();

    await w.answeredAt(0);
    await w.answeredAt(1);
    await w.answeredAt(2);

    expect(w.resolved).toEqual([PROVIDER.id]);
  });

  it('logs a failed raise and tries it again at the next refusal', async () => {
    const w = watch();
    w.failNextRaise();

    await w.refusedAt(0);
    await w.refusedAt(15);
    expect(w.raised).toEqual([]);
    expect(w.logger.error).toHaveBeenCalledWith(expect.objectContaining({ action: 'ingestion.syncFinding.providerRateLimitFailed' }), expect.any(String));

    await w.refusedAt(16);
    expect(w.raised).toHaveLength(1);
  });

  it('raises and resolves nothing for a provider with no Provider row', async () => {
    const w = watch({ hasRow: false });

    await w.refusedAt(0);
    await w.refusedAt(15);
    await w.answeredAt(16);

    expect(w.raised).toEqual([]);
    expect(w.resolved).toEqual([]);
  });
});
