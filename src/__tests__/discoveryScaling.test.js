import fs from "node:fs/promises";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import { discoverSessions, clearDiscoveryCache, discoveryMetrics, readDiscoveryPreview } from "../../routes/discovery";
import { readVSCodeSessionPreview, readCodexSessionPreview, readCopilotCliSessionPreview } from "../../routes/sessions";

describe("asynchronous discovery scaling", () => {
  it("matches preview readers for all enriched formats and closes failed reads", async () => {
    const root = path.resolve(".discovery-preview-fixture");
    await fs.mkdir(root, { recursive: true });
    try {
      const samples = [
        ["vscode-chat", JSON.stringify({ version: 3, sessionId: "vscode-id", requests: [{ message: { text: "Hello" } }], customTitle: "Saved title" }), readVSCodeSessionPreview],
        ["copilot-cli", JSON.stringify({ type: "user.message", data: { content: "CLI prompt" } }), readCopilotCliSessionPreview],
        ["codex", JSON.stringify({ type: "session_meta", payload: { id: "codex-id", cwd: "example" } }) + "\n" + JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "Codex prompt" } }), readCodexSessionPreview],
      ];
      for (const [format, raw, sync] of samples) {
        const file = path.join(root, format + ".jsonl");
        await fs.writeFile(file, raw);
        const size = Buffer.byteLength(raw);
        expect(await readDiscoveryPreview({ format, path: file, size })).toEqual(sync(file, size));
      }
      const close = vi.fn().mockResolvedValue();
      vi.spyOn(fs, "open").mockResolvedValue({ read: vi.fn().mockRejectedValue(new Error("Read failed")), close });
      expect(await readDiscoveryPreview({ format: "codex", path: "missing", size: 100 })).toMatchObject({ sessionId: null, title: null });
      expect(close).toHaveBeenCalledOnce();
    } finally {
      vi.restoreAllMocks();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it("enriches only recent candidates, reuses previews, invalidates companion changes and yields", async () => {
    const home = path.resolve(".discovery-scaling-fixture");
    const appdata = path.join(home, "appdata");
    vi.stubEnv("APPDATA", appdata);
    clearDiscoveryCache();
    const root = path.join(home, ".copilot", "session-state");
    let timer;
    try {
      await fs.mkdir(root, { recursive: true });
      for (let i = 0; i < 1000; i++) {
        const dir = path.join(root, String(i).padStart(4, "0"));
        await fs.mkdir(dir);
        const file = path.join(dir, "events.jsonl");
        await fs.writeFile(file, JSON.stringify({ type: "user.message", data: { content: "Session " + i } }));
        await fs.utimes(file, 1700000000 + i, 1700000000 + i);
      }
      let ticks = 0;
      timer = setInterval(() => ticks++, 1);
      const before = discoveryMetrics.previews;
      const start = performance.now();
      const first = await discoverSessions(home);
      const coldMs = performance.now() - start;
      expect(first).toHaveLength(200);
      expect(first[0].sessionId).toBe("0999");
      expect(discoveryMetrics.previews - before).toBe(200);
      const warmStart = performance.now();
      expect(await discoverSessions(home)).toEqual(first);
      const warmMs = performance.now() - warmStart;
      expect(discoveryMetrics.previews - before).toBe(200);
      await fs.writeFile(path.join(root, "0999", "workspace.yaml"), "summary: Changed title\n");
      const changed = await discoverSessions(home);
      expect(changed[0].summary).toBe("Changed title");
      expect(discoveryMetrics.previews - before).toBe(201);
      clearInterval(timer);
      expect(ticks).toBeGreaterThan(0);
      process.stdout.write(JSON.stringify({ discoveryCandidates: 1000, coldPreviews: 200, warmPreviews: 0, coldMs, warmMs, eventLoopTicks: ticks }) + "\n");
    } finally {
      clearInterval(timer);
      await fs.rm(home, { recursive: true, force: true });
      vi.unstubAllEnvs();
      clearDiscoveryCache();
    }
  }, 30000);
});
