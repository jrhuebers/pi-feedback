import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtemp, readFile, rm, stat, mkdir, writeFile, readdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FeedbackStore, cleanText, markdownBoard, plain, type Origin } from "../src/store.ts";

const origin: Origin = { profile: "test", cwd: "/example/project", sessionId: "test-session", piVersion: "test" };
async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "pi-feedback-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, store: new FeedbackStore(join(dir, "feedback")) };
}

test("capture persists Markdown and a linked, private board across store instances", async (t) => {
  const { store } = await fixture(t);
  const { note } = await store.add(" # Better reload\r\n\r\nKeep my draft. ", origin);
  assert.equal(note.text, "# Better reload\n\nKeep my draft.");
  assert.equal(note.status, "inbox");
  assert.match(await readFile(store.path(note.id), "utf8"), /pi-feedback .*\n\n# Better reload/);
  const snapshot = await new FeedbackStore(store.root).list();
  assert.deepEqual(snapshot.notes, [note]);
  assert.match(await readFile(join(store.root, "BOARD.md"), "utf8"), new RegExp(`items/${note.id}.md`));
  assert.equal((await stat(store.root)).mode & 0o777, 0o700);
  assert.equal((await stat(store.path(note.id))).mode & 0o777, 0o600);
  assert.equal((await stat(join(store.root, "BOARD.md"))).mode & 0o777, 0o600);
});

test("multiple writers do not lose notes or board entries", async (t) => {
  const { store } = await fixture(t);
  const notes = await Promise.all(Array.from({ length: 12 }, (_, i) => new FeedbackStore(store.root).add(`Idea ${i}`, origin)));
  const snapshot = await store.list();
  assert.equal(snapshot.notes.length, 12);
  const board = await readFile(join(store.root, "BOARD.md"), "utf8");
  for (const { note } of notes) assert.ok(board.includes(note.id));
  assert.deepEqual((await readdir(store.root)).sort(), ["BOARD.md", "items"]);
});

test("moves preserve concurrent edits and optimistic edits reject stale snapshots", async (t) => {
  const { store } = await fixture(t);
  const { note } = await store.add("Original", origin);
  await store.update(note.id, { text: "Improved" }, note.updated);
  await store.update(note.id, { status: "planned" });
  await assert.rejects(store.update(note.id, { text: "Stale" }, note.updated), /another session/);
  const [latest] = (await store.list()).notes;
  assert.equal(latest.text, "Improved");
  assert.equal(latest.status, "planned");
  assert.equal(latest.created, note.created);
  await store.update(note.id, { status: "done" });
  assert.match(await readFile(join(store.root, "BOARD.md"), "utf8"), /## done \(1\)/);
});

test("invalid notes and symlinks are reported without destroying valid notes", async (t) => {
  const { dir, store } = await fixture(t);
  await store.add("Valid", origin);
  const bad = "00000000-0000-4000-8000-000000000000";
  await writeFile(store.path(bad), "not feedback");
  await symlink(join(dir, "unrelated"), store.path("00000000-0000-4000-8000-000000000001"));
  const snapshot = await store.refresh();
  assert.equal(snapshot.notes.length, 1);
  assert.equal(snapshot.warnings.length, 2);
  assert.equal(await readFile(store.path(bad), "utf8"), "not feedback");
  assert.match(await readFile(join(store.root, "BOARD.md"), "utf8"), /## Warnings/);
  await assert.rejects(store.update(bad, { text: "overwrite" }), /Missing feedback metadata/);
  assert.throws(() => store.path("../../secrets"), /Invalid feedback ID/);
});

test("board failures do not turn a successful capture into a retry/duplicate", async (t) => {
  const { store } = await fixture(t);
  await mkdir(join(store.root, "BOARD.md"), { recursive: true });
  const result = await store.add("Keep this even if board fails", origin);
  assert.match(result.boardWarning!, /Note saved/);
  assert.equal((await store.list()).notes.length, 1);
});

test("rejects symlink stores and does not create files when only listing", async (t) => {
  const { store, dir } = await fixture(t);
  assert.deepEqual(await store.list(), { notes: [], warnings: [] });
  assert.deepEqual(await readdir(dir), []);
  await mkdir(join(dir, "target"));
  await symlink(join(dir, "target"), store.root);
  await assert.rejects(store.add("No", origin), /directory/);
  assert.deepEqual(await readdir(join(dir, "target")), []);
});

test("empty/oversize text is rejected and board labels cannot inject Markdown HTML/links", async (t) => {
  assert.throws(() => cleanText(" \n "), /empty/);
  assert.throws(() => cleanText("x".repeat(100001)), /exceeds/);
  assert.equal(plain("a\x1b]52;c;data\x07\nb"), "a]52;c;data\nb");
  const { store } = await fixture(t);
  await store.add("[click](bad) | <script>\nDetails", origin);
  const board = markdownBoard(await store.list());
  assert.ok(!board.includes("<script>"));
  assert.ok(board.includes("&#124;"));
  assert.ok(board.includes("\\[click\\]"));
});
