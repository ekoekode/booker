import { App, FuzzySuggestModal } from "obsidian";
import { SOURCE_LABELS, Source, SourceKind } from "../project/timelineSources";

/** Search for something to add to the timeline map: a character, place, plotline, life or kind of element. */
export class SourcePicker extends FuzzySuggestModal<Source> {
  constructor(app: App, private options: Source[], private onPick: (s: Source) => void) {
    super(app);
    this.setPlaceholder("Add to the timeline: a character, place, plotline, life…");
  }
  getItems() {
    return this.options;
  }
  getItemText(s: Source) {
    return s.kind === "all" ? "Everything" : `${SOURCE_LABELS[s.kind]}: ${s.name}`;
  }
  onChooseItem(s: Source) {
    this.onPick(s);
  }
}

export const SOURCE_ICONS: Record<SourceKind, string> = {
  character: "users",
  location: "map-pin",
  plotline: "git-branch",
  life: "hourglass",
  kind: "tag",
  all: "layers",
};
