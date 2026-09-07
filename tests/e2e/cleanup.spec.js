import { test, expect } from "@playwright/test";
import path from "node:path";
test.use({ hasTouch: true });

async function open(page) {
  await page.route("**/api/meta", route => route.fulfill({ json: {} }));
  await page.route("**/api/sessions", route => route.fulfill({ json: [] }));
  await page.goto("/?demo=empty");
}
async function load(page) {
  await open(page);
  await page.locator('input[type="file"]').setInputFiles(path.resolve("src", "__tests__", "fixtures", "test-copilot.jsonl"));
  await expect(page).toHaveURL(/review$/);
}

test("empty Find prioritizes real files and explicitly persists reading density", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("button", { name: "Import a session", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Portfolio metrics" })).toHaveCount(0);
  await expect(page.getByText(/No local sessions found/)).toBeVisible();
  await page.getByRole("button", { name: "Reading density", exact: true }).click();
  await page.getByRole("option", { name: "Comfortable density" }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("agentviz:density"))).toBe('"comfortable"');
  await page.reload();
  await expect(page.getByRole("button", { name: "Reading density", exact: true })).toHaveText("Comfortable density");
  await page.getByRole("button", { name: "Demo", exact: true }).click();
  await page.getByRole("button", { name: "Investigate, Evidence stream", exact: true }).click();
  await expect(page.locator("[data-event-index]").first()).toBeVisible();
  expect(await page.locator("[data-event-index]").first().evaluate(node => node.style.padding)).toBe("12px");
});

test("Replay resizing supports keyboard, pointer, width remeasurement and compact stacking", async ({ page }) => {
  await load(page);
  await page.getByRole("button", { name: "Investigate, Evidence stream", exact: true }).click();
  const separator = page.getByRole("separator");
  await separator.focus();
  const before = Number(await separator.getAttribute("aria-valuenow"));
  await separator.press("ArrowLeft");
  expect(Number(await separator.getAttribute("aria-valuenow"))).toBeLessThan(before);
  await separator.press("Home");
  expect(Number(await separator.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
  await separator.press("End");
  expect(Number(await separator.getAttribute("aria-valuenow"))).toBeLessThan(100);
  const box = await separator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 140, box.y + box.height / 2);
  await page.mouse.up();
  expect(await page.evaluate(() => document.body.style.userSelect)).toBe("");
  await page.setViewportSize({ width: 600, height: 860 });
  await expect(separator).toHaveAttribute("aria-orientation", "horizontal");
  await expect(page.locator('[data-panel-direction="vertical"]')).toBeVisible();
  await separator.press("ArrowUp");
  await expect.poll(async () => page.locator("[data-event-index]").evaluateAll(nodes => {
    const rows = nodes.map(node => node.parentElement.getBoundingClientRect()).sort((a,b) => a.top-b.top);
    return rows.every((row, i) => i === 0 || row.top >= rows[i-1].bottom - 1);
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("Graph has one keyboard entry and supports selecting and expanding turns", async ({ page }) => {
  await load(page);
  await page.getByRole("button", { name: "Analyze, Deep panels", exact: true }).click();
  await page.getByRole("tab", { name: "Graph", exact: true }).click();
  const graph = page.getByRole("tree");
  await expect(graph).toBeVisible();
  await graph.focus();
  await graph.press("Home");
  await graph.press("ArrowDown");
  const active = await graph.getAttribute("aria-activedescendant");
  expect(active).toBeTruthy();
  await expect(page.locator('[id="' + active + '"]')).toHaveAttribute("aria-selected", "true");
  await expect(graph.locator('[tabindex="0"]')).toHaveCount(0);
  const expandable = graph.locator('[role="treeitem"][aria-expanded="false"]').first();
  await expandable.click();
  await page.getByRole("button", { name: "Expand turn", exact: true }).click();
  await expect(graph.locator('[role="treeitem"][aria-expanded="true"]')).toHaveCount(1);
  await graph.focus();
  await graph.press("ArrowLeft");
  await expect(graph.locator('[role="treeitem"][aria-expanded="true"]')).toHaveCount(0);
});

test("dense Tracks retains individual touch and keyboard evidence with bounded DOM", async ({ page }) => {
  await open(page);
  const lines = Array.from({ length: 5000 }, (_, index) => JSON.stringify({
    type: "user", sessionId: "tracks-dense", timestamp: "2026-01-01T00:00:00Z",
    message: { role: "user", content: "Dense evidence " + index },
  })).join("\n");
  await page.locator('input[type="file"]').setInputFiles({ name: "dense.jsonl", mimeType: "application/json", buffer: Buffer.from(lines) });
  await expect(page).toHaveURL(/review$/);
  await page.getByRole("button", { name: "Analyze, Deep panels", exact: true }).click();
  await page.getByRole("tab", { name: "Tracks", exact: true }).click();
  expect(await page.locator("[data-track-mark]").count()).toBeLessThanOrEqual(200);
  const mark = page.locator("[data-track-mark]").first();
  await mark.tap();
  await mark.focus();
  await mark.press("Enter");
  await expect(page.getByRole("region", { name: "Track evidence" })).toBeVisible();
  await page.getByRole("button", { name: "Next events", exact: true }).click();
  await page.getByRole("button", { name: /^#51 ·/ }).click();
  await expect(page.getByText("Dense evidence 50", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Theme selector" }).click();
  await page.getByRole("menuitemradio", { name: "Light", exact: true }).click();
  expect(await mark.evaluate(node => getComputedStyle(node).color)).toBe("rgb(20, 24, 36)");
});

test("real live worker retains parser parity and lets browser timers progress", async ({ page }) => {
  await open(page);
  const metrics = await page.evaluate(async () => {
    const { createLiveParserClient } = await import("/src/lib/liveParserClient.js");
    const { parseSession } = await import("/src/lib/parseSession.ts");
    const { createLiveSessionParser, appendLiveSessionText } = await import("/src/lib/liveSessionParser.ts");
    const line = index => JSON.stringify({ type: index % 2 ? "assistant" : "user", sessionId: "worker-benchmark",
      timestamp: new Date(1700000000000 + index * 1000).toISOString(),
      message: { role: index % 2 ? "assistant" : "user", content: "Worker event " + index } });
    const initial = Array.from({ length: 10000 }, (_, i) => line(i)).join("\n") + "\n";
    const tail = line(10000) + "\n";
    const state = createLiveSessionParser(initial);
    const before = performance.now();
    appendLiveSessionText(state, tail);
    const baselineMainThreadMs = performance.now() - before;
    let ticks = 0;
    const timer = setInterval(() => ticks++, 1);
    let client;
    let dispatchMs;
    try {
      const result = await new Promise((resolve, reject) => {
        const start = performance.now();
        client = createLiveParserClient(new Worker("/src/lib/liveSessionWorker.ts", { type: "module" }), initial, data => {
          if (data.rawText.endsWith(tail)) resolve(data.result);
        }, reject);
        client.append(tail);
        dispatchMs = performance.now() - start;
      });
      const expected = parseSession(initial + tail);
      if (JSON.stringify(result) !== JSON.stringify(expected)) throw new Error("Worker/batch parser parity mismatch");
      return { events: result.events.length, baselineMainThreadMs, workerDispatchMs: dispatchMs, timerTicks: ticks };
    } finally { clearInterval(timer); client?.dispose(); }
  });
  expect(metrics.events).toBe(10001);
  expect(metrics.timerTicks).toBeGreaterThan(0);
  console.log("Live worker benchmark", metrics);
});
