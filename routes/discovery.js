import fs from "node:fs/promises";
import path from "node:path";
import { setImmediate as yieldIO } from "node:timers/promises";
import {
  filterSessionFiles, getVSCodeStorageRoots, readCodexSessionPreview,
  readCopilotCliSessionPreview, readVSCodeSessionPreview,
} from "./sessions.js";

const previews = new Map();
const inFlight = new Map();
export const discoveryMetrics = { previews: 0, cacheHits: 0 };
export function clearDiscoveryCache() { previews.clear(); }

async function entries(dir) {
  try { return await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
}
async function stat(file) {
  try { return await fs.lstat(file); } catch { return null; }
}
async function text(file) {
  try { return await fs.readFile(file, "utf8"); } catch { return ""; }
}
async function boundedMap(items, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

async function scan(home) {
  const candidates = [];
  const seen = new Set();
  async function add(file, descriptor) {
    const info = await stat(file);
    if (!info?.isFile() || info.isSymbolicLink()) return;
    candidates.push({ ...descriptor, path: file, filename: path.basename(file), size: info.size, mtime: info.mtime.toISOString() });
  }
  const claude = path.join(home, ".claude", "projects");
  for (const dir of await entries(claude)) {
    if (!dir.isDirectory()) continue;
    const root = path.join(claude, dir.name);
    await boundedMap(await entries(root), async file => {
      if (file.isFile() && file.name.endsWith(".jsonl")) await add(path.join(root, file.name), {
        id: "claude-code:" + dir.name + ":" + file.name, format: "claude-code",
        projectDir: dir.name, project: dir.name.replace(/^-/, "").split("-").filter(Boolean).pop() || dir.name,
      });
    });
  }
  const copilot = path.join(home, ".copilot", "session-state");
  await boundedMap(await entries(copilot), async dir => {
    if (dir.isDirectory()) await add(path.join(copilot, dir.name, "events.jsonl"), {
      id: "copilot-cli:" + dir.name + ":events.jsonl", format: "copilot-cli", projectDir: dir.name, sessionId: dir.name,
    });
  });
  const codex = path.join(home, ".codex", "sessions");
  async function dates(root, depth) {
    for (const item of await entries(root)) {
      if (depth < 3) {
        if (item.isDirectory() && (depth === 0 ? /^\d{4}$/ : /^\d{2}$/).test(item.name)) await dates(path.join(root, item.name), depth + 1);
      } else if (item.isFile() && /^rollout-.+\.jsonl$/.test(item.name)) {
        const file = path.join(root, item.name);
        const relative = path.relative(codex, file);
        await add(file, { id: "codex:" + relative, format: "codex", projectDir: path.dirname(relative) });
      }
    }
  }
  await dates(codex, 0);
  for (const root of getVSCodeStorageRoots(home)) {
    for (const ws of await entries(root)) {
      if (!ws.isDirectory()) continue;
      const chat = path.join(root, ws.name, "chatSessions");
      const files = filterSessionFiles((await entries(chat)).filter(file => file.isFile()).map(file => file.name));
      await boundedMap(files, file => add(path.join(chat, file), {
        id: "vscode-chat:" + ws.name + ":" + file, format: "vscode-chat", isInsiders: root.includes("Code - Insiders"),
      }));
    }
  }
  // Select newest candidates before opening transcript previews. Filtered
  // subprocess records are skipped until 200 visible sessions are collected.
  candidates.sort((a, b) => b.mtime.localeCompare(a.mtime) || a.path.localeCompare(b.path));
  const results = [];
  for (const candidate of candidates) {
    seen.add(candidate.path);
    if (results.length === 200) continue;
    if (candidate.format === "vscode-chat" && candidate.size < 200) continue;
    const companion = candidate.format === "copilot-cli" ? path.join(path.dirname(candidate.path), "workspace.yaml")
      : candidate.format === "vscode-chat" ? path.join(path.dirname(path.dirname(candidate.path)), "workspace.json") : null;
    const companionStat = companion ? await stat(companion) : null;
    const key = [candidate.mtime, candidate.size, companionStat?.mtimeMs, companionStat?.size].join(":");
    const cached = previews.get(candidate.path);
    if (cached?.key === key) {
      discoveryMetrics.cacheHits++;
      if (cached.value) results.push(cached.value);
      continue;
    }
    // Preview readers have bounded buffers (at most 64 KiB), never whole
    // transcripts. Yield between them so SSE and other requests can progress.
    await yieldIO();
    discoveryMetrics.previews++;
    let value = { ...candidate };
    if (candidate.format === "copilot-cli") {
      const yaml = await text(companion);
      const summary = (yaml.match(/^summary:\s+(?!\|-\s*$)(.+)$/m)?.[1] || yaml.match(/^summary:\s*\|-\s*\n[ \t]+(.+)$/m)?.[1] || "").trim();
      const preview = summary ? {} : readCopilotCliSessionPreview(candidate.path, candidate.size);
      if (summary.startsWith("Analyze this") || (summary.includes("Session stats") && summary.includes("read_config")) || preview.isContinuationSummary) value = null;
      else Object.assign(value, {
        file: preview.title || "events.jsonl", project: summary || preview.title || candidate.sessionId.slice(0, 8),
        summary: summary || preview.title || null, repository: yaml.match(/^repository:\s*(.+)$/m)?.[1]?.trim() || null,
        branch: yaml.match(/^branch:\s*(.+)$/m)?.[1]?.trim() || null,
      });
    } else if (candidate.format === "codex") {
      const preview = readCodexSessionPreview(candidate.path, candidate.size);
      Object.assign(value, {
        file: preview.title || candidate.filename, project: preview.cwd?.replace(/\\/g, "/").split("/").filter(Boolean).pop() || preview.title || "Codex",
        sessionId: preview.sessionId, summary: preview.summary || preview.title, repository: null, branch: null,
        originator: preview.originator, cliVersion: preview.cliVersion, model: preview.model,
      });
    } else if (candidate.format === "vscode-chat") {
      const preview = readVSCodeSessionPreview(candidate.path, candidate.size);
      let project = null;
      try {
        const workspace = JSON.parse(await text(companion));
        project = decodeURIComponent(workspace.folder || "").replace(/\\/g, "/").split("/").filter(Boolean).pop() || null;
      } catch {}
      Object.assign(value, { file: preview.title || candidate.filename, summary: preview.title, project, sessionId: preview.sessionId });
    }
    previews.set(candidate.path, { key, value });
    if (value) results.push(value);
  }
  for (const key of previews.keys()) if (!seen.has(key)) previews.delete(key);
  // Bound cache retention even when recent-session sets churn.
  while (previews.size > 1000) previews.delete(previews.keys().next().value);
  return results;
}

export function discoverSessions(home) {
  if (!inFlight.has(home)) inFlight.set(home, scan(home).finally(() => inFlight.delete(home)));
  return inFlight.get(home);
}
