import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
test("real plans run locally in a worker, export and clear under production CSP", async ({
  page,
}) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => requests.push(r.url()));
  await page.goto("/");
  await page
    .locator("#base-plan")
    .setInputFiles(resolve("fixtures/terraform-generated/base.json"));
  await page
    .locator("#head-plan")
    .setInputFiles(resolve("fixtures/terraform-generated/head.json"));
  await page
    .getByRole("button", { name: "Analyze plans", exact: true })
    .click();
  await expect(page.locator("#introduced-count")).toHaveText("1");
  await expect(page.locator("#path-detail")).toContainText(
    "Minimum edit set: 1",
  );
  await expect(page.locator("#path-detail")).toContainText(
    "aws_s3_bucket.data",
  );
  await expect(page.locator("#error")).toBeHidden();
  const downloaded = page.waitForEvent("download");
  await page.locator("#export-json").click();
  expect((await downloaded).suggestedFilename()).toBe("report.json");
  await page.locator("#clear").click();
  await expect(page.locator("#introduced-count")).toHaveText("—");
  await expect(page.locator("#head-plan")).toHaveValue("");
  expect(
    requests.every(
      (url) =>
        url.startsWith("http://127.0.0.1:4173/") ||
        url.startsWith("blob:") ||
        url.startsWith("data:"),
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("demo is engine-produced, filterable, and usable on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator("#load-demo").click();
  await expect(page.locator("#demo-notice")).toBeVisible();
  await expect(page.locator("#introduced-count")).not.toHaveText("0");
  await expect(page.locator("#path-list button").first()).toBeVisible();
  await page.locator("#search").fill("no-such-resource");
  await expect(page.locator("#path-list")).toContainText("No paths match");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("invalid plan never replaces a valid report with a clean verdict", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#load-demo").click();
  await expect(page.locator("#demo-notice")).toBeVisible();
  const count = await page.locator("#introduced-count").textContent();
  await page
    .locator("#head-plan")
    .setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from("{"),
    });
  await page.locator("#analyze-plans").click();
  await expect(page.locator("#error")).toContainText("No clean verdict");
  await expect(page.locator("#introduced-count")).toHaveText(count!);
});
