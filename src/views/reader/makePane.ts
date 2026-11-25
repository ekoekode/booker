import type { Place } from "../../reader/place";
import { BiblePane } from "./biblePane";
import { CommentaryPane } from "./commentaryPane";
import { ShelfPane } from "./shelfPane";
import type { Pane, PaneCtx } from "./types";
import { WordPane } from "./wordPane";
import { WorkPane } from "./workPane";

/** The pane that shows a place: a Bible, a commentary, a work, or the shelf. Used by the Reader and by the window that follows it. */
export function makePane(p: Place, ctx: PaneCtx): Pane {
  switch (p.kind) {
    case "bible":
      return new BiblePane(ctx, p);
    case "work":
      return new WorkPane(ctx, p);
    case "word":
      return new WordPane(ctx, p);
    case "commentary":
      return new CommentaryPane(ctx, p);
    default:
      return new ShelfPane(ctx, p);
  }
}
