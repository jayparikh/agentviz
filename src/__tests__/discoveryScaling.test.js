import fs from "node:fs/promises";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import { discoverSessions, clearDiscoveryCache, discoveryMetrics } from "../../routes/discovery";

describe("asynchronous discovery scaling", () => {
  it("enriches only recent candidates, reuses previews, invalidates companion changes and yields", async () => {
    const home = path.resolve(".discovery-scaling-fixture");
    const appdata = path.join(home, "appdata");
    vi.stubEnv("APPDATA", appdata);
    clearDiscoveryCache();
    const root = path.join(home, ".copilot", "session-state");
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
      const timer = setInterval(() => ticks++, 1);
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
      await fs.rm(home, { recursive: true, force: true });
      vi.unstubAllEnvs();
      clearDiscoveryCache();
    }
  }, 30000);
});
