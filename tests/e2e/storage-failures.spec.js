import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

var fixture = readFileSync(path.resolve("src", "__tests__", "fixtures", "test-copilot.jsonl"), "utf8");

async function stubApi(page) {
  await page.route("**/api/meta", function (route) {
    return route.fulfill({ json: {} });
  });
  await page.route("**/api/sessions", function (route) {
    return route.fulfill({ json: [] });
  });
  await page.route("**/api/config", function (route) {
    return route.fulfill({ json: [] });
  });
}

for (let width of [1400, 600]) {
  for (let failure of ["quota", "index", "getter"]) {
    test("storage " + failure + " recovery at " + width + "px", async function ({ page }) {
      var errors = [];
      page.on("pageerror", function (error) { errors.push(error.message); });
      await page.setViewportSize({ width: width, height: 860 });
      await stubApi(page);
      await page.addInitScript(function (mode) {
        window.failStorage = true;
        var storage = window.localStorage;
        if (mode === "getter") {
          Object.defineProperty(window, "localStorage", { configurable: true, get: function () {
            if (window.failStorage) throw new DOMException("Storage blocked", "SecurityError");
            return storage;
          } });
          return;
        }
        var write = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, text) {
          if (window.failStorage && (mode === "index"
            ? key === "agentviz:session-library:v1" : key.startsWith("agentviz:session-content:v1:"))) {
            throw new DOMException("Storage full", "QuotaExceededError");
          }
          return write.call(this, key, text);
        };
      }, failure);
      await page.goto("/");
      await page.locator('input[type="file"]').setInputFiles({
        name: "recovery.jsonl", mimeType: "application/json", buffer: Buffer.from(fixture),
      });
      await expect(page).toHaveURL(/#\/v2\/review$/);
      var notice = page.getByTestId("storage-a");
      await expect(notice).toContainText("Latest transcript not saved locally.");
      if (failure === "index") await expect(notice).toContainText("The session index could not be saved.");
      await expect(page.getByText("Ready", { exact: true })).toBeVisible();
      var downloadPromise = page.waitForEvent("download");
      await notice.getByRole("button", { name: "Download transcript", exact: true }).click();
      var download = await downloadPromise;
      expect(download.suggestedFilename()).toBe("recovery.jsonl");
      var stream = await download.createReadStream();
      var chunks = [];
      for await (var chunk of stream) chunks.push(chunk);
      expect(Buffer.concat(chunks).toString("utf8")).toBe(fixture);
      var bounds = await notice.getByRole("button", { name: "Retry saving", exact: true }).boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(860);
      await page.getByRole("button", { name: /Investigate,/ }).click();
      await expect(notice).toContainText("Latest transcript not saved locally.");
      await page.evaluate(function () { window.failStorage = false; });
      await notice.getByRole("button", { name: "Retry saving", exact: true }).click();
      await expect(notice).toContainText("Saved locally.");
      await expect(notice.getByRole("button", { name: "Retry saving" })).toHaveCount(0);
      await page.getByRole("button", { name: "Close session", exact: true }).click();
      await expect(notice).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }
}
