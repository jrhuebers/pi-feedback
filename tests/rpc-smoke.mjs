// Real Pi startup + slash-command dispatch, without model credentials or network.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extension = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const temp = await mkdtemp(join(tmpdir(), "pi-feedback-smoke-"));
const cli = process.env.PI_FEEDBACK_PI_BIN || "pi";

function start(home, research) {
  const agentDir = research ? join(home, "research") : join(home, ".pi", "agent");
  const env = { PATH: process.env.PATH, HOME: home, TERM: "dumb", PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0" };
  if (research) Object.assign(env, { PI_CODING_AGENT_DIR: agentDir, PI_RESEARCH_AGENT_DIR: agentDir });
  const child = spawn(cli, ["--mode", "rpc", "--no-session", "--no-approve", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files", "-e", extension], { cwd: home, env, stdio: ["pipe", "pipe", "pipe"] });
  const records = [];
  let buffer = "", errors = "", sequence = 0;
  const waiters = new Set();
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (data) => { errors += data; });
  child.stdout.on("data", (data) => {
    buffer += data;
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (line.trim()) records.push(JSON.parse(line));
    }
    for (const check of waiters) check();
  });
  child.on("error", (error) => { errors += error.message; for (const check of waiters) check(error); });
  const exited = new Promise((resolve) => child.on("exit", (code) => { resolve(code); for (const check of waiters) check(new Error(`Pi exited (${code}): ${errors}`)); }));
  function wait(predicate, after = 0) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiters.delete(check); reject(new Error(`RPC timeout: ${errors}`)); }, 20000);
      function check(error) {
        const record = records.slice(after).find(predicate);
        if (!record && !error) return;
        clearTimeout(timer); waiters.delete(check);
        if (record) resolve(record); else reject(error);
      }
      waiters.add(check); check();
    });
  }
  function send(data) { child.stdin.write(JSON.stringify(data) + "\n"); }
  function command(type, data = {}) {
    const id = `request-${++sequence}`;
    send({ type, id, ...data });
    return wait((record) => record.type === "response" && record.id === id).then((record) => {
      assert.equal(record.success, true, JSON.stringify(record)); return record.data;
    });
  }
  async function dialog(method, value, after) {
    const request = await wait((record) => record.type === "extension_ui_request" && record.method === method, after);
    send({ type: "extension_ui_response", id: request.id, ...(value === undefined ? { cancelled: true } : { value: typeof value === "function" ? value(request) : value }) });
    return records.indexOf(request) + 1;
  }
  return { agentDir, child, records, command, dialog, wait, async stop() {
    child.stdin.end();
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    try { assert.equal(await exited, 0, errors); } finally { clearTimeout(timer); }
  } };
}

try {
  for (const research of [false, true]) {
    const home = join(temp, research ? "research-home" : "vanilla-home");
    await mkdir(home);
    if (research) {
      await mkdir(join(home, "research"));
      await writeFile(join(home, "research", ".pi-research-managed.json"), JSON.stringify({ cluster: "rcp" }));
    }
    const client = start(home, research);
    try {
      const { commands } = await client.command("get_commands");
      assert.deepEqual(commands.filter((command) => command.name.startsWith("feedback")).map((command) => command.name).sort(), ["feedback", "feedback-show"]);
      const root = join(client.agentDir, "feedback");
      await assert.rejects(access(root)); // No feedback files at startup.
      assert.equal((await client.command("prompt", { message: "/feedback Quick capture" })).disposition, "handled");
      let after = client.records.length;
      const cancelled = client.command("prompt", { message: "/feedback" });
      await client.dialog("editor", undefined, after);
      await cancelled;
      after = client.records.length;
      const edited = client.command("prompt", { message: "/feedback" });
      await client.dialog("editor", "Editor capture\n\nRemember this failure.", after);
      await edited;
      after = client.records.length;
      const board = client.command("prompt", { message: "/feedback-show Quick" });
      after = await client.dialog("select", (request) => {
        const choice = request.options.find((option) => option.includes("Quick capture"));
        assert.ok(choice); return choice;
      }, after);
      after = await client.dialog("select", "Move", after);
      after = await client.dialog("select", "planned", after);
      await client.dialog("select", undefined, after);
      await board;
      const files = await readdir(join(root, "items"));
      assert.equal(files.length, 2);
      const contents = await Promise.all(files.map((name) => readFile(join(root, "items", name), "utf8")));
      assert.ok(contents.some((text) => text.includes('"status":"planned"') && text.includes("Quick capture")));
      assert.ok(contents.every((text) => text.includes(`"profile":"${research ? "pi-research" : "pi"}"`)));
      if (research) assert.ok(contents.every((text) => text.includes('"cluster":"rcp"')));
      assert.match(await readFile(join(root, "BOARD.md"), "utf8"), /## planned \(1\)/);
      assert.deepEqual((await client.command("get_messages")).messages, []);
      assert.ok(!client.records.some((record) => record.type === "agent_start"));
      assert.ok(!client.records.some((record) => record.type === "extension_ui_request" && record.notifyType === "error"), JSON.stringify(client.records));
    } finally { await client.stop(); }
    // A fresh Pi process must discover the same persistent notes.
    const restarted = start(home, research);
    try {
      const after = restarted.records.length;
      const board = restarted.command("prompt", { message: "/feedback-show" });
      await restarted.dialog("select", (request) => {
        assert.ok(request.options.some((option) => option.startsWith("[planned] Quick capture")));
        return undefined;
      }, after);
      // A response with no value cancels select in Pi.
      await board;
    } finally { await restarted.stop(); }
    console.log(`Real Pi RPC smoke passed: ${research ? "pi-research" : "vanilla Pi"}`);
  }
} finally { await rm(temp, { recursive: true, force: true }); }
