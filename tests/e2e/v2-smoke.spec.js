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
  await expect(page.getByText("3 PRU", { exact: true }).first()).toBeVisible();
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
  await expect(page.getByText("Reported PRU")).toBeVisible();

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
