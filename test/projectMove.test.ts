import { expect, it } from "vitest";
import { planMove } from "../src/project/projectMove";

it("plans a move into another folder or the vault root", () => {
  expect(planMove("StoryLine/Novel", "Books")).toEqual({ to: "Books/Novel" });
  expect(planMove("StoryLine/Novel", "/")).toEqual({ to: "Novel" });
  expect(planMove("Novel", "StoryLine/Series")).toEqual({ to: "StoryLine/Series/Novel" });
});
it("refuses the same place and moving into itself", () => {
  expect(planMove("StoryLine/Novel", "StoryLine")).toHaveProperty("error");
  expect(planMove("StoryLine/Novel", "StoryLine/Novel/Notes")).toHaveProperty("error");
  expect(planMove("StoryLine/Novel", "StoryLine/Novel")).toHaveProperty("error");
});
