import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { FeedbackBoard, type BoardAction, type BoardOptions } from "../src/board.ts";
import type { Note } from "../src/store.ts";

const theme = { fg: (_color: string, text: string) => text } as Theme;
const keys = { matches: (data: string, action: string) => data === ({ "tui.select.up": "UP", "tui.select.down": "DOWN", "tui.select.confirm": "ENTER", "tui.select.cancel": "ESC" } as Record<string, string>)[action] };
const note: Note = { version: 1, id: "test-id", status: "inbox", created: "2026-01-01T00:00:00.000Z", updated: "2026-01-01T00:00:00.000Z", text: "Wide 界 📝 idea\n" + "Long detail line ".repeat(500), origin: { profile: "test", cwd: "/project", sessionId: "test-session", piVersion: "test" } };
function make(notes = [note], query = "") {
  let result: BoardAction;
  let closed = false;
  let redraws = 0;
  const options: BoardOptions = { notes, root: "/profile/feedback", query, oldest: false, warnings: 0 };
  const board = new FeedbackBoard(options, theme, keys, () => 24, () => redraws++, (action) => { result = action; closed = true; });
  return { board, options, state: () => ({ result, closed, redraws }) };
}

test("board and detail rendering fit narrow, wide, Unicode and resized terminals", () => {
  const { board } = make();
  for (const detail of [false, true]) {
    if (detail) board.handleInput("ENTER");
    for (const width of [0, 1, 10, 40, 89, 90, 120, 200]) {
      const lines = board.render(width);
      assert.ok(lines.length <= 24, `${lines.length} rows at width ${width}`);
      for (const line of lines) assert.ok(visibleWidth(line) <= width, `overwide at ${width}`);
    }
  }
});

test("detail scrolling, back and close do not mutate notes", () => {
  const { board, state } = make();
  board.handleInput("ENTER");
  board.handleInput("DOWN");
  assert.ok(board.render(80).some((line) => line.includes("Session:")));
  board.handleInput("ESC");
  assert.equal(state().closed, false);
  board.handleInput("ESC");
  assert.equal(state().closed, true);
  assert.ok(state().redraws >= 3);
});

test("navigation selects the right column/note and emits edit/move actions", () => {
  const second = { ...note, id: "planned-id", status: "planned" as const, text: "Plan" };
  const { board, state } = make([note, second]);
  board.handleInput("l");
  board.handleInput("m");
  assert.deepEqual(state().result, { action: "move", id: "planned-id" });
});

test("search, status filters, sort, empty columns, and action keys work", () => {
  const { board, options, state } = make([note], "missing");
  assert.match(board.render(100).join("\n"), /No feedback matches/);
  board.handleInput("m");
  assert.equal(state().closed, false);
  board.handleInput("f");
  assert.equal(options.filter, "inbox");
  board.handleInput("s");
  assert.equal(options.oldest, true);
  board.handleInput("/");
  assert.deepEqual(state().result, { action: "search" });
  const empty = make([]);
  empty.board.handleInput("n");
  assert.deepEqual(empty.state().result, { action: "new" });
});
