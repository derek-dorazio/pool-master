/**
 * A settings group (#450): one named, validated JSON payload in `platform_runtime_configs`,
 * declared once and owned by `AppSettingsService`.
 *
 * Where a setting belongs is `rules/architecture-rules.md` §6 *Runtime settings live in the
 * database*: a group holds how the app behaves, never a secret or how the deployment is wired.
 */

import type { z } from 'zod';
import type { PublicReadPath } from '../../core/public-cache';

/** The process environment a group's code defaults may depend on (e.g. which environment this is). */
export type SettingsEnvironment = Readonly<NodeJS.ProcessEnv>;

export interface SettingsGroup<T> {
  /** The `config_key` the payload is stored under. Never renamed once deployed. */
  readonly key: string;
  readonly title: string;
  readonly description: string;
  /** Validates a whole payload. Unknown keys are dropped, so a field can be retired freely. */
  readonly schema: z.ZodType<T>;
  /** The value in use while nothing is stored. Must pass `schema`. */
  readonly defaults: (env: SettingsEnvironment) => T;
  /**
   * Runs on every core-api task when the value it uses changes after boot: on the task that
   * saved it at once, on the others at their next refresh. Not called for the first load.
   * Method syntax on purpose: it keeps a `SettingsGroup<Email>` assignable to the registry's
   * `SettingsGroup<unknown>[]`.
   */
  onChange?(next: T, previous: T): void;
  /** The public reads built from this group, which a save or reset clears at the CDN (#1181). */
  readonly publicReads?: readonly PublicReadPath[];
}

export function defineSettingsGroup<T>(group: SettingsGroup<T>): SettingsGroup<T> {
  return Object.freeze({ ...group });
}
