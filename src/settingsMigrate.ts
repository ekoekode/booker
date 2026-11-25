import { DEFAULT_SETTINGS, BookerSettings, PersistedData, SETTINGS_VERSION } from "./types";

/** Merge saved settings with the defaults and apply one-time changes of default for older saves. */
export function migrateSettings(raw: Partial<PersistedData> | null | undefined): { settings: BookerSettings; version: number; changed: boolean } {
  const settings = { ...DEFAULT_SETTINGS, ...(raw?.settings ?? {}) };
  const stored = typeof raw?.settingsVersion === "number" ? raw.settingsVersion : 0;
  let changed = stored < SETTINGS_VERSION;
  // 0.8: properties are hidden by default
  if (stored < 3) settings.hideProperties = true;
  // 0.11: writing opens in the left pane by default
  if (stored < 4 && settings.openChaptersIn === ("auto" as string)) settings.openChaptersIn = "first";
  // 0.11: new projects go in a folder called Booker (books already in StoryLine are still found)
  if (stored < 5 && settings.projectRoot === "StoryLine") settings.projectRoot = "Booker";
  // 0.2 settings that no longer exist
  for (const k of ["codexFolderName", "openFolderNoteOnClick", "hideFolderNotes", "aiMode", "hubLayout", "aiShortcutName", "aiSummaryPrompt", "aiCharacterPrompt"]) {
    if (k in settings) {
      delete (settings as Record<string, unknown>)[k];
      changed = true;
    }
  }
  // the projects folder setting used to be called storylineRoot
  const old = (raw?.settings as unknown as Record<string, unknown> | undefined)?.storylineRoot;
  if (typeof old === "string") {
    if (!(raw?.settings as unknown as Record<string, unknown>).projectRoot) settings.projectRoot = old;
    delete (settings as Record<string, unknown>).storylineRoot;
    changed = true;
  }
  return { settings, version: SETTINGS_VERSION, changed };
}
