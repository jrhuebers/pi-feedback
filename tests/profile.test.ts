import assert from "node:assert/strict";
import { test } from "node:test";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { profileInfo } from "../src/profile.ts";

test("vanilla and custom profiles store feedback outside projects", async () => {
  const vanilla = join(homedir(), ".pi", "agent");
  assert.deepEqual(await profileInfo(vanilla, {}), { profile: "pi", cluster: undefined, root: join(vanilla, "feedback") });
  assert.deepEqual(await profileInfo("/example/custom", {}), { profile: "custom", cluster: undefined, root: "/example/custom/feedback" });
});

test("research provenance and explicit shared store override", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-feedback-profile-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, ".pi-research-managed.json"), JSON.stringify({ cluster: "rcp" }));
  const info = await profileInfo(dir, { PI_RESEARCH_AGENT_DIR: dir });
  assert.equal(info.profile, "pi-research");
  assert.equal(info.cluster, "rcp");
  const custom = await profileInfo(dir, { PI_RESEARCH_AGENT_DIR: dir, PI_FEEDBACK_PROFILE: "work", PI_FEEDBACK_DIR: "~/shared-feedback" });
  assert.equal(custom.root, join(homedir(), "shared-feedback"));
  assert.equal(custom.profile, "work");
  assert.equal((await profileInfo(dir, { PI_RESEARCH_AGENT_DIR: "/different/profile" })).cluster, undefined);
  await writeFile(join(dir, ".pi-research-managed.json"), "invalid");
  assert.equal((await profileInfo(dir, { PI_RESEARCH_AGENT_DIR: dir })).profile, "pi-research");
});
