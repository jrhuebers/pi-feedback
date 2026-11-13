import { lstat, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { homedir } from "node:os";

function expand(value: string): string {
  return value === "~" ? homedir() : value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
}
export async function profileInfo(agentDir: string, env: NodeJS.ProcessEnv = process.env): Promise<{ profile: string; cluster?: string; root: string }> {
  agentDir = resolve(agentDir);
  const research = env.PI_RESEARCH_AGENT_DIR && resolve(expand(env.PI_RESEARCH_AGENT_DIR)) === agentDir;
  const standard = agentDir === resolve(homedir(), ".pi", "agent");
  const profile = env.PI_FEEDBACK_PROFILE?.trim() || (research ? "pi-research" : standard ? "pi" : basename(agentDir));
  let cluster: string | undefined;
  // Read only the distribution's tiny, nonsecret ownership manifest; never settings/models/auth or project config.
  if (research) {
    const manifest = join(agentDir, ".pi-research-managed.json");
    try {
      const info = await lstat(manifest);
      if (info.isFile() && !info.isSymbolicLink() && info.size < 100_000) {
        const data = JSON.parse(await readFile(manifest, "utf8"));
        if (typeof data.cluster === "string" && /^[a-zA-Z0-9_-]+$/.test(data.cluster)) cluster = data.cluster;
      }
    } catch { /* Missing/malformed optional provenance must not prevent capturing feedback. */ }
  }
  return { profile, cluster, root: env.PI_FEEDBACK_DIR?.trim() ? resolve(expand(env.PI_FEEDBACK_DIR.trim())) : join(agentDir, "feedback") };
}
