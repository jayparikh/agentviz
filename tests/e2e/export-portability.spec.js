import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

import { createServer } from "../../server.js";

// Regression guard for shared exports. The exported HTML must render on a
// machine that has never run AGENTVIZ: no origin URLs, no data: URL modules,
// and no live /api backend. Everything here runs from file:// with all network
// access blocked, which is how a recipient opens the file.

var __dirname = path.dirname(fileURLToPath(import.meta.url));
var repoRoot = path.resolve(__dirname, "..", "..");
var distDir = path.join(repoRoot, "dist");
var fixturePath = path.join(repoRoot, "src", "__tests__", "fixtures", "test-copilot.jsonl");

var server = null;
var origin = null;
var exportPath = null;

test.beforeAll(async function ({ browser }) {
  if (!fs.existsSync(path.join(distDir, "index.html"))) {
    throw new Error(
      "dist/ is missing. Run `npm run build` first, or use `npm run test:e2e:export`."
    );
  }

  server = createServer({ sessionFile: null, distDir: distDir });
  await new Promise(function (resolve) {
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = "http://127.0.0.1:" + server.address().port;

  var context = await browser.newContext({ acceptDownloads: true });
  var page = await context.newPage();
  await page.goto(origin + "/");
  await page.locator('input[type="file"]').setInputFiles(fixturePath);
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();

  var downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).first().click();
  var download = await downloadPromise;

  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentviz-export-"));
  exportPath = path.join(dir, "shared-session.html");
  await download.saveAs(exportPath);
  await context.close();
});

test.afterAll(async function () {
  if (server) {
    await new Promise(function (resolve) { server.close(resolve); });
    server = null;
  }
});

async function openOffline(browser) {
  var context = await browser.newContext();
  var attempted = [];
  await context.route("**/*", function (route) {
    var url = route.request().url();
    if (url.startsWith("file://") || url.startsWith("blob:") || url.startsWith("data:")) {
      return route.continue();
    }
    attempted.push(url);
    return route.abort("connectionrefused");
  });

  var page = await context.newPage();
  var failures = [];
  page.on("pageerror", function (error) { failures.push("pageerror: " + error.message); });
  page.on("console", function (message) {
    if (message.type() === "error") failures.push("console: " + message.text());
  });

  await page.goto(pathToFileURL(exportPath).href);
  return { context: context, page: page, attempted: attempted, failures: failures };
}

test("exported HTML has no reference to the exporting origin", async function () {
  var html = fs.readFileSync(exportPath, "utf8");
  expect(html).not.toContain(origin);
  expect(html).not.toContain("127.0.0.1");
  expect(html).not.toContain('<script type="importmap">');
  expect(html).not.toContain("data:text/javascript");
  expect(html).not.toContain("fonts.googleapis.com");
});

test("exported HTML renders the session from file:// with the network blocked", async function ({ browser }) {
  var opened = await openOffline(browser);

  await expect(opened.page.getByText("Ready", { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(opened.page.getByText("This AGENTVIZ export failed to load")).toHaveCount(0);

  await opened.page.getByRole("button", { name: /Investigate/ }).click();
  await expect(
    opened.page.getByText("Can you add a hello world function to utils.js?")
  ).toBeVisible();

  expect(opened.attempted).toEqual([]);
  expect(opened.failures).toEqual([]);
  await opened.context.close();
});

test("exported HTML answers /api routes locally instead of failing on file://", async function ({ browser }) {
  var opened = await openOffline(browser);
  await expect(opened.page.getByText("Ready", { exact: true })).toBeVisible({ timeout: 20000 });

  var stub = await opened.page.evaluate(async function () {
    var coach = await fetch("/api/coach/analyze", { method: "POST" });
    var sessions = await fetch("/api/sessions");
    return {
      coachStatus: coach.status,
      coachBody: await coach.json(),
      sessionsStatus: sessions.status,
      sessionsBody: await sessions.json(),
    };
  });

  expect(stub.coachStatus).toBe(501);
  expect(stub.coachBody.error).toBe("Not available in exported view");
  expect(stub.sessionsStatus).toBe(200);
  expect(stub.sessionsBody).toEqual([]);
  expect(opened.failures).toEqual([]);
  await opened.context.close();
});
