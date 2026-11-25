import type { App, Component } from "obsidian";
import type BookerPlugin from "../../main";
import type { Place } from "../../reader/place";
import type { SearchMode } from "../../reader/searchOptions";
import type { CopySettings } from "../../reader/copySettings";

/** What a pane may ask of the Reader that holds it. */
export interface PaneCtx {
  plugin: BookerPlugin;
  app: App;
  /** where the pane draws */
  host: HTMLElement;
  /** for rendering Markdown; unloaded with the Reader */
  render: Component;
  /** go to a place: a new step in the history, or (replace) just note where the pane now is */
  go(place: Place, opts?: { replace?: boolean }): void;
  /** the bar (labels, arrows) needs redrawing */
  changed(): void;
  /** how copied words are written in this window */
  copy(): CopySettings;
  /** open a word in the word study tab of the references window; absent where there is none */
  openWord?(place: Extract<Place, { kind: "word" }>): void;
  /** a window that follows the Reader: the pane must not tell the References which verse it is at */
  silent?: boolean;
}

export interface Crumb {
  text: string;
  go?: Place;
}

/** One kind of place the Reader can show. The Reader draws the bar from what the pane says about itself. */
export interface Pane {
  place(): Place;
  /** the name on the Source button */
  source(): string;
  crumbs(): Crumb[];
  /** the name on the Place button, or null when there is nothing to pick */
  placeLabel(): string | null;
  canPrev(): boolean;
  canNext(): boolean;
  prev(): void;
  next(): void;
  /** fill the popover under the Place button */
  picker?(into: HTMLElement, close: () => void): void;
  /** books the pane can offer a reference for (a Bible's books) */
  books?(): string[];
  /** go to another place of the same kind without rebuilding; false when it cannot */
  moveTo?(place: Place): boolean;
  /** colour every match of the terms on the page; returns how many */
  highlight?(terms: string[], mode: SearchMode): number;
  clearHighlight?(): void;
  load(): Promise<void>;
  destroy(): void;
}
