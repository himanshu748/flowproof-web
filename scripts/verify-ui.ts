import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
await fs.mkdir("outputs", { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:5173/#demo", { waitUntil: "networkidle" });
await page
  .getByRole("heading", { name: "Forma Studio", exact: true })
  .waitFor();
await page.getByRole("button", { name: "Overview", exact: true }).click();
await page.getByRole("heading", { name: "Your work. Verified." }).waitFor();
await page.screenshot({
  path: "outputs/flowproof-desktop.png",
  fullPage: true,
});
await page.locator(".project-row").filter({ hasText: "Forma Studio" }).click();
await page
  .getByRole("heading", { name: "Forma Studio", exact: true })
  .waitFor();
await page.screenshot({ path: "outputs/flowproof-review.png", fullPage: true });
const approveAll = page.getByRole("button", {
  name: "Approve all checks",
  exact: true,
});
if (await approveAll.isEnabled()) await approveAll.click();
await page.getByRole("button", { name: "Run audit", exact: true }).click();
await page
  .getByRole("button", { name: "Export delivery report", exact: true })
  .waitFor({ timeout: 130000 });
await page.locator(".screenshot-link img").waitFor();
await page.screenshot({
  path: "outputs/flowproof-evidence.png",
  fullPage: true,
});
const downloadEvent = page.waitForEvent("download");
await page
  .getByRole("button", { name: "Export delivery report", exact: true })
  .click();
const download = await downloadEvent;
await download.saveAs("outputs/flowproof-ui-report.html");
for (const width of [1440, 768, 390, 360]) {
  await page.setViewportSize({ width, height: 900 });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const dimensions = await page.evaluate(() => ({
    width: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert(
    dimensions.scroll <= dimensions.width,
    `Evidence overflows at ${width}px`,
  );
}
await page.waitForTimeout(4600);
await page.screenshot({
  path: "outputs/flowproof-mobile-evidence.png",
  fullPage: true,
});
await page
  .getByRole("button", { name: "Open navigation", exact: true })
  .click();
await page.getByRole("button", { name: "Overview", exact: true }).click();
await page.getByRole("heading", { name: "Your work. Verified." }).waitFor();
assert(
  await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  ),
  "Mobile overview overflows",
);
await page.screenshot({ path: "outputs/flowproof-mobile.png", fullPage: true });
await page.setViewportSize({ width: 1440, height: 1000 });
await page.getByRole("button", { name: "Model lab", exact: false }).click();
await page.getByRole("heading", { name: "Model lab", exact: true }).waitFor();
await page.screenshot({
  path: "outputs/flowproof-model-lab.png",
  fullPage: true,
});
await page
  .getByRole("button", { name: "Failure library", exact: true })
  .click();
await page
  .getByRole("heading", { name: "Failure library", exact: true })
  .waitFor();
await page.screenshot({
  path: "outputs/flowproof-failures.png",
  fullPage: true,
});
await page.getByRole("button", { name: "Overview", exact: true }).click();
await page.getByRole("button", { name: "New project", exact: true }).click();
await page.getByRole("dialog").waitFor();
await page.keyboard.press("Escape");
assert.equal(await page.getByRole("dialog").count(), 0);
assert.deepEqual(errors, []);
await fs.writeFile(
  "outputs/ui-verification.json",
  JSON.stringify(
    {
      executedAt: new Date().toISOString(),
      screens: [
        "overview",
        "review",
        "audit",
        "reports",
        "model lab",
        "failure library",
        "project modal",
      ],
      viewportWidths: [1440, 768, 390, 360],
      consoleErrors: errors,
      liveAudit: "completed",
      reportDownload: "verified",
      mobileNavigation: "verified",
      modalEscape: "verified",
      reducedMotion: "enabled",
    },
    null,
    2,
  ),
);
await context.close();
await browser.close();
console.log(
  "UI workflow, report export, modal and responsive checks passed. Screenshots saved in outputs.",
);
