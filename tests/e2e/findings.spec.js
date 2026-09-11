import { expect, test } from "@playwright/test";

var text = [
  { type: "user", uuid: "user-one", sessionId: "findings-fixture", timestamp: "2026-01-15T10:00:00.000Z", message: { role: "user", content: "First exact event" } },
  { type: "assistant", uuid: "assistant-two", sessionId: "findings-fixture", timestamp: "2026-01-15T10:00:00.000Z", message: { role: "assistant", content: [{ type: "text", text: "Second equal-time event" }] } },
].map(JSON.stringify).join("\n");

async function open(page) {
  await page.route("**/api/meta", function (route) { return route.fulfill({ json: {} }); });
  await page.route("**/api/sessions", function (route) { return route.fulfill({ json: [] }); });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "findings.jsonl", mimeType: "application/json", buffer: Buffer.from(text) });
  await expect(page).toHaveURL(/review$/);
  await page.getByRole("button", { name: /Investigate,/ }).click();
}

async function note(page, index, value) {
  await page.locator('[data-event-index="' + index + '"]').click();
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await page.getByRole("textbox", { name: "Event note" }).fill(value);
  await page.getByRole("button", { name: "Save note", exact: true }).click();
}

for (let width of [1400, 600]) {
  test("bookmarks create, edit, exact jump and reopen at " + width + "px", async function ({ page }) {
    await page.setViewportSize({ width: width, height: 860 });
    await open(page);
    await note(page, 0, "Note for zero");
    await note(page, 1, "Note for equal time");
    await page.getByRole("button", { name: "Bookmarks (2)", exact: true }).click();
    var panel = page.getByRole("region", { name: "Bookmarks", exact: true });
    await expect(panel.getByText("Note for zero")).toBeVisible();
    await panel.getByRole("button", { name: "Jump to bookmarked event 1" }).click();
    await page.getByRole("button", { name: "Edit note", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Event note" })).toHaveValue("Note for zero");
    await page.getByRole("textbox", { name: "Event note" }).fill("Updated zero");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await panel.getByRole("button", { name: "Jump to bookmarked event 2" }).click();
    await page.getByRole("button", { name: "Edit note", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Event note" })).toHaveValue("Note for equal time");
    await page.getByRole("button", { name: "Cancel note", exact: true }).click();
    var bounds = await panel.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(860);
    expect(await page.evaluate(function () { return document.documentElement.scrollWidth <= window.innerWidth; })).toBe(true);
    await page.reload();
    await page.getByRole("button", { name: /Find,/ }).click();
    await page.getByRole("article", { name: "First exact event" }).getByRole("button", { name: "Open", exact: true }).click();
    await expect(page).toHaveURL(/review$/);
    await page.getByRole("button", { name: /Investigate,/ }).click();
    await page.getByRole("button", { name: "Bookmarks (2)", exact: true }).click();
    await expect(page.getByRole("region", { name: "Bookmarks" }).getByText("Updated zero")).toBeVisible();
    await expect(page.getByRole("region", { name: "Bookmarks" }).getByText("Note for equal time")).toBeVisible();
  });
}

test("note draft survives zones and failed save supports retry and backup restore", async function ({ page }) {
  await open(page);
  await page.locator('[data-event-index="0"]').click();
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await page.getByRole("textbox", { name: "Event note" }).fill("Draft across zones");
  await page.getByRole("button", { name: /Analyze,/ }).click();
  await page.getByRole("button", { name: /Investigate,/ }).click();
  await page.getByRole("button", { name: "Bookmarks", exact: true }).click();
  await page.getByRole("button", { name: "Jump to bookmarked event 1" }).click();
  await expect(page.getByRole("textbox", { name: "Event note" })).toHaveValue("Draft across zones");
  await page.evaluate(function () {
    window.originalFindingsWrite = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("agentviz:findings:v1:")) throw new DOMException("Full", "QuotaExceededError");
      return window.originalFindingsWrite.call(this, key, value);
    };
  });
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.getByText(/Browser storage is full. Findings are kept in memory/).first()).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Event note" })).toHaveValue("Draft across zones");
  var downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download findings", exact: true }).first().click();
  var download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("agentviz-findings.json");
  var chunks = [];
  for await (var chunk of await download.createReadStream()) chunks.push(chunk);
  var backup = Buffer.concat(chunks);
  expect(JSON.parse(backup).items[0].note).toBe("Draft across zones");
  await page.evaluate(function () { Storage.prototype.setItem = window.originalFindingsWrite; });
  await page.getByRole("button", { name: "Retry findings save", exact: true }).first().click();
  await expect(page.getByText(/Browser storage is full. Findings are kept in memory/)).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Event note" })).toHaveCount(0);
  var panel = page.getByRole("region", { name: "Bookmarks" });
  await panel.getByRole("button", { name: "Remove bookmark and note" }).click();
  await expect(panel.getByText("No bookmarks yet.", { exact: false })).toBeVisible();
  await panel.getByLabel("Restore findings backup").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: backup });
  await panel.getByRole("button", { name: "Replace with backup", exact: true }).click();
  await expect(panel.getByText("Draft across zones", { exact: true })).toBeVisible();
  expect(await page.evaluate(function () {
    return Object.keys(localStorage).filter(function (key) { return key.startsWith("agentviz:session-content:"); }).map(function (key) { return localStorage.getItem(key); });
  })).toEqual([text]);
});

test("live worker reset retains unavailable bookmarks without rebinding them", async function ({ page }) {
  await page.addInitScript(function () {
    window.EventSource = class {
      constructor() { window.findingsStream = this; }
      close() {}
    };
  });
  await page.route("**/api/meta", function (route) { return route.fulfill({ json: { filename: "live.jsonl", live: true } }); });
  await page.route("**/api/file?live=1", function (route) { return route.fulfill({ contentType: "text/plain", body: text + "\n" }); });
  await page.route("**/api/sessions", function (route) { return route.fulfill({ json: [] }); });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Close session", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Investigate,/ }).click();
  await page.locator('[data-event-index="0"]').click();
  await page.getByRole("button", { name: "Bookmark event", exact: true }).click();
  await page.getByRole("button", { name: "Bookmarks (1)", exact: true }).click();
  await page.evaluate(function () { window.findingsStream.onmessage({ data: JSON.stringify({ reset: true, lines: "" }) }); });
  var panel = page.getByRole("region", { name: "Bookmarks" });
  await expect(panel.getByText("Unavailable in this snapshot")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Jump to bookmarked event 1" })).toBeDisabled();
  await page.evaluate(function (replacement) { window.findingsStream.onmessage({ data: JSON.stringify({ lines: replacement }) }); },
    text.replace("First exact event", "Different event after reset").replace("user-one", "new-user") + "\n");
  await expect(page.getByText("Different event after reset", { exact: true }).first()).toBeVisible();
  await expect(panel.getByRole("button", { name: "Jump to bookmarked event 1" })).toBeDisabled();
  await page.evaluate(function (original) { window.findingsStream.onmessage({ data: JSON.stringify({ reset: true, lines: original }) }); }, text + "\n");
  await expect(panel.getByRole("button", { name: "Jump to bookmarked event 1" })).toBeEnabled();
  await panel.getByRole("button", { name: "Jump to bookmarked event 1" }).click();
  await expect(page.getByRole("button", { name: "Remove bookmark", exact: true }).last()).toBeVisible();
});
