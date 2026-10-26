/**
 * The member's date display preferences (#1041), provided once by `AuthProvider` from the
 * signed-in account. A visitor who isn't signed in sees the defaults: US Eastern, en-US.
 */
import { createContext, useContext } from "react";
import { DEFAULT_DISPLAY_PREFERENCES, type DisplayPreferences } from "./date-time-format";

export const DisplayPreferencesContext = createContext<DisplayPreferences>(DEFAULT_DISPLAY_PREFERENCES);

export function useDisplayPreferences(): DisplayPreferences {
  return useContext(DisplayPreferencesContext);
}
