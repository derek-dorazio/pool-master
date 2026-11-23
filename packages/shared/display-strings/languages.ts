import type { DisplayStringsModule } from './display-strings-module';
import { enUS } from './en-US';

/** The source language: every other module has exactly its keys, and every lookup falls back to it. */
export const SOURCE_LOCALE = 'en-US';

/**
 * Every language's module, by locale tag. A new language is one more entry here, typed
 * `DisplayStringsModule`, and `rules:check:display-strings` holds it to the `en-US` keys.
 */
export const DISPLAY_STRING_MODULES: Readonly<Record<string, DisplayStringsModule>> = {
  [SOURCE_LOCALE]: enUS,
};
