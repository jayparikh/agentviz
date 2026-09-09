import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

var __dirname = path.dirname(fileURLToPath(import.meta.url));
var repoRoot = path.resolve(__dirname, "..", "..");
var fixturePath = path.join(repoRoot, "src", "__tests__", "fixtures", "test-copilot.jsonl");

function captureFailures(page) {
  var failures = [];
  page.on("pageerror", function (error) {
    failures.push("pageerror: " + error.message);
  });
  page.on("console", function (message) {
    if (message.type() === "error") failures.push("console: " + message.text());
  });
  return failures;
}

async function installApiStubs(page) {
  await page.route("**/api/meta", function (route) {
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.route("**/api/sessions", function (route) {
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/api/config", function (route) {
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/api/coach/analyze", function (route) {
    var body = "data: " + JSON.stringify({
      done: true,
      result: {
        model: "test-coach",
        usage: { total_tokens: 0 },
        recommendations: [],
      },
    }) + "\n\n";
    return route.fulfill({ status: 200, contentType: "text/event-stream", body: body });
  });
}

async function openV2(page) {
  await installApiStubs(page);
  await page.goto("/");
  await expect(page).toHaveURL(/#\/v2\/find$/);
}

async function importGoldenFixture(page) {
  await page.locator('input[type="file"]').setInputFiles(fixturePath);
  await expect(page).toHaveURL(/#\/v2\/review$/);
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
}

test("new OpenAI token prices stay request-scoped and unknown models stay unpriced", async function ({ page }) {
  var failures = captureFailures(page);
  await openV2(page);
  var prompts = [0, 1].map(function (index) {
    return {
      request: { model: "gpt-5.6-sol", messages: [{ role: "user", content: "Synthetic pricing request " + index }] },
      response: { usage: { input_tokens: 200000, output_tokens: 10000, input_tokens_details: { cached_tokens: 60000, cache_write_tokens: 20000 } } },
    };
  });
  await page.locator('input[type="file"]').setInputFiles({ name: "pricing.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(prompts)) });
  await expect(page).toHaveURL(/review$/);
  await page.getByRole("button", { name: /Analyze,/ }).click();
  await expect(page.getByText("$1.61", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Standard service tier assumed/)).toBeVisible();
  await page.getByRole("tab", { name: "Cost", exact: true }).click();
  await expect(page.getByText("Token cost estimates", { exact: true })).toBeVisible();
  await expect(page.getByText("$1.61", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("200k", { exact: true })).toBeVisible();
  await expect(page.getByText("Estimated context composition", { exact: true })).toBeVisible();
  expect(await page.getByText("$ BILLED", { exact: true }).count()).toBe(0);
  await page.getByRole("button", { name: /Find,/ }).click();
  prompts[0].request.model = "gpt-5.6-unknown";
  await page.locator('input[type="file"]').setInputFiles({ name: "unknown-pricing.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(prompts)) });
  await expect(page).toHaveURL(/review$/);
  await page.getByRole("button", { name: /Analyze,/ }).click();
  await expect(page.getByText(/Pricing unavailable for gpt-5.6-unknown/)).toBeVisible();
  expect(await page.getByText("$0.00", { exact: true }).count()).toBe(0);
  expect(failures).toEqual([]);
});

for (let width of [1400, 600]) {
  test("playback speed options stay inside the viewport at " + width + "px", async function ({ page }) {
    var failures = captureFailures(page);
    await page.setViewportSize({ width: width, height: 860 });
    await openV2(page);
    await importGoldenFixture(page);
    await page.getByRole("button", { name: /Investigate,/ }).click();
    var speed = page.getByRole("button", { name: "Playback speed", exact: true });
    await speed.click();
    var menu = page.getByRole("listbox", { name: "Playback speed" });
    var bounds = await menu.boundingBox();
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(860);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width);
    await page.getByRole("option", { name: "8x", exact: true }).click();
    await expect(speed).toHaveText("8x");
    await page.getByRole("button", { name: /Analyze,/ }).click();
    await expect(speed).toHaveText("8x");
    expect(failures).toEqual([]);
  });
}

test("v2 Find imports a golden fixture and supports theme switching", async function ({ page }) {
  var failures = captureFailures(page);
  await openV2(page);
  await expect(page.getByText("No sessions available yet.")).toBeVisible();

  await importGoldenFixture(page);
  await expect(page.getByText("Review health")).toBeVisible();

  await page.getByRole("button", { name: "Theme selector" }).click();
  await page.getByRole("menuitemradio", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Theme selector" }).click();
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  expect(failures).toEqual([]);
});

test("v2 Review and Investigate route to evidence", async function ({ page }) {
  var failures = captureFailures(page);
  await openV2(page);
  await importGoldenFixture(page);

  await expect(page.getByText("81", { exact: true })).toBeVisible();
  await expect(page.getByText("Needs review", { exact: true })).toBeVisible();
  await expect(page.getByText("4.7 credits (~$0.047)", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("9%", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: /Investigate/ }).click();
  await expect(page).toHaveURL(/#\/v2\/investigate$/);
  await expect(page.getByRole("main").getByText("Evidence stream", { exact: true })).toBeVisible();
  await expect(page.getByText("Can you add a hello world function to utils.js?")).toBeVisible();

  expect(failures).toEqual([]);
});

test("v2 Investigate filters normalized user inputs", async function ({ page }) {
  var failures = captureFailures(page);
  await openV2(page);
  await importGoldenFixture(page);

  await page.getByRole("button", { name: /Investigate/ }).click();
  await page.getByRole("button", { name: "User only" }).click();
  await expect(page.getByText("Can you add a hello world function to utils.js?")).toBeVisible();
  await expect(page.getByText("I'll add that function.")).toHaveCount(0);

  await page.getByRole("textbox", { name: "Search evidence events" }).fill("hello world function");
  await expect(page.getByText("1 match", { exact: true })).toBeVisible();

  expect(failures).toEqual([]);
});

test("v2 Analyze Cost and command palette routing work", async function ({ page }) {
  var failures = captureFailures(page);
  await openV2(page);
  await importGoldenFixture(page);

  await page.getByRole("button", { name: /Analyze/ }).first().click();
  await expect(page).toHaveURL(/#\/v2\/analyze$/);
  await expect(page.getByText("Analysis panels", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Cost" }).click();
  await expect(page).toHaveURL(/#\/v2\/analyze\/cost$/);
  await expect(page.getByText("Reported AI Credit usage")).toBeVisible();

  await page.keyboard.press("Control+K");
  await page.getByPlaceholder("Search workflow, events, turns...").fill("review");
  await page.getByRole("button", { name: "Go to Review zone" }).click();
  await expect(page).toHaveURL(/#\/v2\/review$/);

  expect(failures).toEqual([]);
});

test("v2 Compare and Improve zones render from the golden session", async function ({ page }) {
  var failures = captureFailures(page);
  await openV2(page);
  await importGoldenFixture(page);

  await page.getByRole("button", { name: /Compare.*A\/B sessions/ }).click();
  await expect(page).toHaveURL(/#\/v2\/compare$/);
  await expect(page.getByText("Select two sessions to compare")).toBeVisible();

  await page.getByRole("button", { name: /Improve.*Coach & Q&A/ }).click();
  await expect(page).toHaveURL(/#\/v2\/improve$/);
  await expect(page.getByText("Coach and Q&A")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask about session" })).toBeVisible();

  expect(failures).toEqual([]);
});

test("v2 compact layout keeps workflow navigation keyboard accessible", async function ({ page }) {
  var failures = captureFailures(page);
  await page.setViewportSize({ width: 720, height: 860 });
  await openV2(page);
  await importGoldenFixture(page);

  var analyze = page.getByRole("button", { name: /Analyze.*Deep panels/ });
  await analyze.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/v2\/analyze$/);
  await expect(page.getByRole("tablist", { name: "Analysis panels" })).toBeVisible();

  var compare = page.getByRole("button", { name: /Compare.*A\/B sessions/ });
  await compare.focus();
  await expect(page.getByText("A/B sessions")).toBeVisible();

  expect(failures).toEqual([]);
});

test("palette preserves equal-time identity, distant Waterfall selection, and shared search", async ({ page }) => {
  const failures = captureFailures(page);
  await openV2(page);
  const timestamp = "2026-05-01T00:00:00.000Z";
  const records = [{ type: "user", timestamp, message: { content: "first evidence" } }];
  for (let i = 0; i < 100; i++) records.push({
    type: "assistant", timestamp,
    message: { content: [{ type: "tool_use", id: "call-" + i, name: "tool_" + String(i).padStart(3, "0"), input: { marker: i } }] },
  });
  await page.locator('input[type="file"]').setInputFiles({
    name: "navigation.jsonl", mimeType: "text/plain", buffer: Buffer.from(records.map(JSON.stringify).join("\n")),
  });
  await expect(page).toHaveURL(/review$/);
  await page.getByRole("button", { name: /Investigate/ }).click();
  await page.getByRole("button", { name: "User only" }).click();
  await page.getByRole("textbox", { name: "Search evidence events" }).fill("retained search");
  await page.getByRole("textbox", { name: "Search evidence events" }).blur();
  await page.keyboard.press("Control+K");
  await page.getByPlaceholder("Search workflow, events, turns...").fill("tool_090");
  await page.getByRole("button", { name: /tool_090/ }).click();
  await expect(page.locator('[data-event-index="91"][aria-pressed="true"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "User only" })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "See in Waterfall" }).click();
  await expect(page).toHaveURL(/analyze\/waterfall$/);
  const target = page.locator('[data-event-index="91"][aria-pressed="true"]');
  await expect(target).toBeVisible();
  await target.click();
  await expect(page.locator('[data-event-index="91"]')).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: /Investigate/ }).click();
  await expect(page.getByRole("textbox", { name: "Search evidence events" })).toHaveValue("retained search");
  await page.keyboard.press("Control+K");
  await page.getByPlaceholder("Search workflow, events, turns...").fill("first evidence");
  await page.getByRole("button", { name: /first evidence/ }).last().click();
  await expect(page.locator('[data-event-index="0"][aria-pressed="true"]')).toBeVisible();
  expect(failures).toEqual([]);
});

test("Find stays pending until success, reports malformed imports, and retries read failures", async ({ page }) => {
  await openV2(page);
  await page.locator('input[type="file"]').setInputFiles({ name: "invalid.jsonl", mimeType: "text/plain", buffer: Buffer.from("{}") });
  await expect(page.getByRole("alert")).toContainText("Supported");
  await expect(page).toHaveURL(/find$/);
  await importGoldenFixture(page);
  await page.getByRole("button", { name: "Find, Portfolio" }).click();
  await page.evaluate(() => {
    const NativeReader = window.FileReader;
    window.FileReader = class extends NativeReader {
      readAsText() { this.dispatchEvent(new ProgressEvent("error")); }
    };
    window.restoreReader = () => { window.FileReader = NativeReader; };
  });
  await page.locator('input[type="file"]').setInputFiles(fixturePath);
  await expect(page.getByRole("alert")).toContainText("Unable to read");
  await page.evaluate(() => window.restoreReader());
  await page.getByRole("button", { name: "Retry reading file" }).click();
  await expect(page).toHaveURL(/review$/);
});

test("slow discovered load stays in Find and stale responses cannot replace a newer import", async ({ page }) => {
  await installApiStubs(page);
  await page.route("**/api/sessions", route => route.fulfill({
    json: [{ path: "slow", filename: "slow.jsonl", size: 6000, mtime: Date.now(), format: "claude-code" }],
  }));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route("**/api/session?path=slow", async route => {
    await gate;
    await route.fulfill({ body: '{"type":"user","message":{"content":"STALE REQUEST"}}' });
  });
  await page.goto("/");
  await page.getByRole("article").filter({ hasText: "slow.jsonl" }).getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Loading requested session");
  await expect(page).toHaveURL(/find$/);
  await importGoldenFixture(page);
  release();
  await expect(page.getByText("Review health")).toBeVisible();
  await expect(page.getByText("STALE REQUEST")).toHaveCount(0);
});

test("Review slowest-tool insight reveals the exact filtered Waterfall row", async ({ page }) => {
    const failures = captureFailures(page);
    await openV2(page);
    const time = seconds => new Date(Date.UTC(2026, 4, 1, 0, 0, seconds)).toISOString();
    const records = [
      { type: "session.start", timestamp: time(0), data: { producer: "copilot-agent", sessionId: "slow-tool-test" } },
      { type: "user.message", timestamp: time(1), data: { content: "inspect timing" } },
    ];
    for (let i = 0; i < 100; i++) {
      const toolName = i === 90 ? "slow_target" : "fast_tool";
      records.push({ type: "tool.execution_start", timestamp: time(2 + i * 2), data: { toolCallId: "t" + i, toolName, arguments: { marker: i } } });
      records.push({ type: "tool.execution_complete", timestamp: time(2 + i * 2 + (i === 90 ? 20 : 1)), data: { toolCallId: "t" + i, success: true, result: { content: "done" } } });
    }
    await page.locator('input[type="file"]').setInputFiles({ name: "timing.jsonl", mimeType: "text/plain", buffer: Buffer.from(records.map(JSON.stringify).join("\n")) });
    await expect(page).toHaveURL(/review$/);
    await page.getByRole("button", { name: /Investigate/ }).click();
    await page.getByRole("button", { name: "User only" }).click();
    await page.getByRole("button", { name: "Back to Review" }).click();
    await page.getByRole("button", { name: "Open Waterfall", exact: true }).click();
    await expect(page).toHaveURL(/analyze\/waterfall$/);
    await expect(page.locator('[data-event-index][aria-pressed="true"]')).toContainText("slow_target");
    await expect(page.locator('[data-event-index][aria-pressed="true"]')).toBeVisible();
    expect(failures).toEqual([]);
  });

test("successful delayed fetch navigates only after completion and HTTP failure offers retry", async ({ page }) => {
    await installApiStubs(page);
    await page.route("**/api/sessions", route => route.fulfill({
      json: [{ path: "retry", filename: "retry.jsonl", size: 6000, mtime: Date.now(), format: "claude-code" }],
    }));
    let finish;
    const gate = new Promise(resolve => { finish = resolve; });
    let attempts = 0;
    await page.route("**/api/session?path=retry", async route => {
      attempts++;
      if (attempts === 1) return route.fulfill({ status: 500, body: "unavailable" });
      await gate;
      await route.fulfill({ body: '{"type":"user","message":{"content":"recovered request"}}' });
    });
    await page.goto("/");
    await page.getByRole("article").getByRole("button", { name: "Open", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Failed to load session");
    await expect(page).toHaveURL(/find$/);
    await page.getByRole("button", { name: "Retry load" }).click();
    await expect(page.getByRole("status")).toContainText("Loading requested session");
    await expect(page).toHaveURL(/find$/);
    finish();
    await expect(page).toHaveURL(/review$/);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

test("playback position survives workflow switches and successful imports reset search", async ({ page }) => {
  await openV2(page);
  const records = [
    { type: "user", timestamp: "2026-05-01T00:00:00Z", message: { content: "start marker" } },
    { type: "assistant", timestamp: "2026-05-01T00:00:10Z", message: { content: "middle marker" } },
    { type: "assistant", timestamp: "2026-05-01T00:00:20Z", message: { content: "late marker" } },
  ];
  await page.locator('input[type="file"]').setInputFiles({ name: "position.jsonl", mimeType: "text/plain", buffer: Buffer.from(records.map(JSON.stringify).join("\n")) });
  await expect(page).toHaveURL(/review$/);
  await page.getByRole("button", { name: "Command palette" }).click();
  await page.getByPlaceholder("Search workflow, events, turns...").fill("middle marker");
  await page.getByRole("button", { name: /middle marker/ }).click();
  await expect(page.locator('[data-event-index="1"][aria-pressed="true"]')).toBeVisible();
  await expect(page.locator('[data-event-index="2"]')).toHaveCount(0);
  await page.getByRole("textbox", { name: "Search evidence events" }).fill("middle");
  await page.getByRole("button", { name: "Analyze, Deep panels" }).click();
  await page.getByRole("button", { name: "Improve, Coach & Q&A" }).click();
  await page.getByRole("button", { name: "Investigate, Evidence stream" }).click();
  await expect(page.locator('[data-event-index="2"]')).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Search evidence events" })).toHaveValue("middle");
  await page.getByRole("button", { name: "Find, Portfolio" }).click();
  await importGoldenFixture(page);
  await page.getByRole("button", { name: "Investigate, Evidence stream" }).click();
  await expect(page.getByRole("textbox", { name: "Search evidence events" })).toHaveValue("");
});
