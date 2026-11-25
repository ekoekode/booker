import type BookerPlugin from "../main";
import type { Project } from "../project/vaultOps";

/**
 * Opens the Maps settings. They are a panel that slides over the Map tab (see mapsPanel.ts), so this opens the Map tab with the panel
 * showing. Kept as a small class so every place that opened the old window (the command, the Location box, Settings) still works.
 */
export class MapsSettingsModal {
  constructor(private plugin: BookerPlugin, private proj: Project, private start?: string) {}

  open() {
    void this.plugin.openView("booker-world-map", { project: this.proj.file.path, settings: this.start ?? "" });
  }
}
