import { test, expect } from "@playwright/test";

test.describe("Q&A view", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByText("load a demo session", { exact: false }).click();
    await expect(page.getByRole("button", { name: /Replay/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("Q&A tab is discoverable and renders the view", async ({ page }) => {
    // The Q&A tab should be present among the view tabs
    const qaTab = page.getByRole("button", { name: "Q&A", exact: true });
    await expect(qaTab).toBeVisible();

    // Click the Q&A tab
    await qaTab.click();
    await page.waitForTimeout(500);

    // Should show the Q&A header (always visible regardless of cached state)
    await expect(page.getByText("Session Q&A")).toBeVisible();
  });

  test("Q&A view has input and send button", async ({ page }) => {
    const qaTab = page.getByRole("button", { name: "Q&A", exact: true });
    await qaTab.click();
    await page.waitForTimeout(500);

    // Input and Send should always be visible
    await expect(
      page.getByPlaceholder("Ask a question about this session..."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send" }),
    ).toBeVisible();

    // The app should still be alive (no crash)
    await expect(page.locator("#root")).toBeVisible();
  });

  test("Q&A view shows model selector and header", async ({ page }) => {
    const qaTab = page.getByRole("button", { name: "Q&A", exact: true });
    await qaTab.click();
    await page.waitForTimeout(500);

    // The "Session Q&A" header should be visible
    await expect(page.getByText("Session Q&A")).toBeVisible();

    // A model selector (select element) should be present
    const modelSelect = page.locator("select[title='Choose model']");
    await expect(modelSelect).toBeVisible();
  });

  test("switching away from Q&A and back preserves the view", async ({
    page,
  }) => {
    // Go to Q&A
    const qaTab = page.getByRole("button", { name: "Q&A", exact: true });
    await qaTab.click();
    await page.waitForTimeout(300);
    await expect(page.getByText("Session Q&A")).toBeVisible();

    // Switch to Stats
    await page.getByRole("button", { name: /Stats/i }).click();
    await page.waitForTimeout(300);

    // Switch back to Q&A -- should not crash
    await qaTab.click();
    await page.waitForTimeout(300);
    await expect(page.getByText("Session Q&A")).toBeVisible();
  });
});
