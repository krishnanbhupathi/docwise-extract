import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("a developer creates a key, sends an invoice, approves it with a correction, then revokes the key", async ({ page }) => {
  const api = page.request;
  expect((await api.get("/api/v1/invoices")).status()).toBe(401);

  await page.goto("/developers");
  await page.getByPlaceholder(/What it's for/).fill("e2e");
  await page.getByRole("button", { name: "Create key" }).click();
  const key = (await page.getByTestId("new-api-key").textContent())!;
  expect(key).toMatch(/^dw_/);
  const auth = { authorization: `Bearer ${key}` };

  const sent = await api.post("/api/v1/invoices", {
    headers: auth,
    multipart: { file: { name: "inv-001.pdf", mimeType: "application/pdf", buffer: readFileSync(path.join(process.cwd(), "test-set", "invoices", "inv-001.pdf")) } },
  });
  expect(sent.status()).toBe(202);
  const { id, status } = await sent.json();
  expect(status).toBe("queued");

  // The fake model's invoice doesn't cross-foot, so it waits for review.
  await expect.poll(async () => (await (await api.get(`/api/v1/invoices/${id}`, { headers: auth })).json()).status, { timeout: 30_000 }).toBe("needs_review");
  const read = await (await api.get(`/api/v1/invoices/${id}`, { headers: auth })).json();
  expect(read.checks.map((c: { rule: string }) => c.rule)).toEqual(["total_mismatch"]);
  expect(read.confidence.tax).toMatchObject({ level: "low", reasons: expect.arrayContaining(["model_uncertain"]) });

  // The key acts for this browser: the invoice is in its inbox.
  await page.goto("/");
  await expect(page.getByRole("link", { name: /inv-001\.pdf/ })).toBeVisible();

  const refused = await api.post(`/api/v1/invoices/${id}/approve`, { headers: auth, data: {} });
  expect(refused.status()).toBe(422);
  expect((await refused.json()).error.code).toBe("checks_fail");
  const approved = await api.post(`/api/v1/invoices/${id}/approve`, { headers: auth, data: { invoice: { total: "1274.40" } } });
  expect(approved.status()).toBe(200);
  expect(await approved.json()).toMatchObject({ status: "approved", approval: "review", corrected_fields: ["total"], checks: [] });

  // Samples can be read but not approved.
  expect((await (await api.get("/api/v1/invoices/sample-056", { headers: auth })).json()).sample).toBe(true);
  expect((await api.post("/api/v1/invoices/sample-056/approve", { headers: auth, data: {} })).status()).toBe(403);

  await page.goto("/developers");
  await page.getByRole("button", { name: "Revoke", exact: true }).click();
  await page.getByRole("button", { name: /^Revoke dw_/ }).click();
  await expect(page.getByText("No keys yet.")).toBeVisible();
  expect((await api.get("/api/v1/invoices", { headers: auth })).status()).toBe(401);
});

test("the developers page fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/developers");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
