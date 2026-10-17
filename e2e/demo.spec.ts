import path from "node:path";
import { expect, test } from "@playwright/test";

test("a visitor opens a sample with no sign-up", async ({ page }) => {
  await page.goto("/");
  const samples = page.getByRole("region", { name: "Try a sample" }).getByRole("listitem");
  await expect(samples).toHaveCount(9);
  await samples.filter({ hasText: "Scan" }).click();

  await expect(page).toHaveURL(/\/documents\/sample-046$/);
  await expect(page.getByText("Approved automatically: every mark passed.")).toBeVisible();
  await expect(page.getByText(/so this page made no model call/)).toBeVisible();
  await expect(page.getByText("Northwind Lane Logistics Inc.")).toBeVisible();
});

test("a visitor reviews their own copy of a sample that doesn't add up", async ({ page }) => {
  await page.goto("/documents/sample-056");
  await page.getByRole("button", { name: /Review your own copy/ }).click();
  await expect(page).not.toHaveURL(/sample-056$/);
  await expect(page.getByText(/Your private copy of/)).toBeVisible();

  const approve = page.getByRole("button", { name: "✓ Approve invoice" });
  await expect(approve).toBeDisabled();
  await page.getByLabel(/Approve it as printed/).check();
  await approve.click();
  await expect(page.getByText(/Approved by a reviewer/)).toBeVisible();

  const csv = await (await page.request.get("/export.csv")).text();
  expect(csv).toContain("Cobalt Peak Studio Inc.");
  // The shared sample still waits for review.
  await page.goto("/documents/sample-056");
  await expect(page.getByRole("button", { name: /Review your own copy/ })).toBeVisible();
});

test("an uploaded invoice is read and waits in the review queue", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(path.join(process.cwd(), "test-set", "invoices", "inv-001.pdf"));
  await expect(page).toHaveURL(/\/documents\/[a-z0-9]{12}$/);
  // The fake model always lists tax as uncertain, so the invoice goes to review.
  await expect(page.getByText("Some values need a person.", { exact: false })).toBeVisible({ timeout: 30_000 });
  await page.goto("/review");
  await expect(page.getByText("inv-001.pdf")).toBeVisible();
});

test.describe("at phone width", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const url of ["/", "/documents/sample-052", "/documents/sample-056"]) {
    test(`${url} doesn't scroll sideways`, async ({ page }) => {
      await page.goto(url);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    });
  }
});
