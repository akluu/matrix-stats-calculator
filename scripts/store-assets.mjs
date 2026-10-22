import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";

process.chdir(path.resolve(import.meta.dirname, ".."));
await fs.mkdir("public/icons", { recursive: true });
await fs.mkdir("store/images", { recursive: true });
const mark = `<rect x="16" y="16" width="96" height="96" rx="20" fill="#17645d"/><path d="M44 38H34V90H44M84 38H94V90H84" fill="none" stroke="white" stroke-width="5" stroke-linecap="round"/><g fill="white"><rect x="49" y="45" width="10" height="10" rx="2"/><rect x="69" y="45" width="10" height="10" rx="2"/><rect x="49" y="65" width="10" height="10" rx="2"/><rect x="69" y="65" width="10" height="10" rx="2"/></g>`;
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  const page = await browser.newPage();
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block}</style><svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">${mark}</svg>`,
    );
    await page.screenshot({
      path: `public/icons/icon-${size}.png`,
      omitBackground: true,
    });
  }
  await fs.writeFile(
    "store/icon.svg",
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${mark}</svg>\n`,
  );
  await fs.copyFile("public/icons/icon-128.png", "store/images/icon-128.png");
  await page.setViewportSize({ width: 440, height: 280 });
  await page.setContent(
    `<style>*{box-sizing:border-box}body{margin:0;width:440px;height:280px;background:#123d39;color:white;font-family:Arial,sans-serif;padding:28px}svg{width:80px;height:80px;margin:-10px 0 12px -10px}h1{font-size:30px;line-height:1.12;letter-spacing:-.6px;margin:0 0 14px}p{font-size:15px;color:#c1dcd6;margin:0}</style><svg viewBox="0 0 128 128">${mark}</svg><h1>Matrix &amp; Stats<br>Calculator</h1><p>A spreadsheet in your sidebar.</p>`,
  );
  await page.screenshot({
    path: "store/images/promo-440x280.png",
    omitBackground: false,
  });
} finally {
  await browser.close();
}

execFileSync(process.execPath, ["build.mjs"], { stdio: "inherit" });
const profile = await fs.mkdtemp(path.join(os.tmpdir(), "matrix-stats-store-"));
let context;
try {
  const extension = path.resolve("dist");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
    viewport: { width: 1280, height: 800 },
  });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${new URL(worker.url()).host}/index.html`,
  );
  const statistics = [
    ["Sample", "Value", null, "Summary", "Result"],
    [1, 12, null, "Mean", "=AVERAGE(B2:B9)"],
    [2, 15, null, "Sample SD", "=STDEV.S(B2:B9)"],
    [3, 13, null, "Variance", "=VAR.S(B2:B9)"],
    [4, 18, null, "Count", "=COUNT(B2:B9)"],
    [5, 11, null, "Median", "=MEDIAN(B2:B9)"],
    [6, 16],
    [7, 14],
    [8, 17],
    [],
    ["Probability", "Result"],
    ["Normal CDF", "=NORM.S.DIST(1.96,TRUE)"],
    ["97.5% z", "=NORM.S.INV(0.975)"],
    ["Poisson P(X=3)", "=POISSON.DIST(3,2,FALSE)"],
  ];
  const matrices = [
    ["Matrix A", null, null, "Inverse", null, null, "A × inverse"],
    [4, 7, null, "=MINVERSE(A2:B3)", null, null, "=MMULT(A2:B3,D2:E3)"],
    [2, 6],
    [],
    ["Determinant", "=MDETERM(A2:B3)"],
    [],
    ["Transpose"],
    ["=TRANSPOSE(A2:B3)"],
    [],
    [],
    ["x", "y", null, "Linear regression"],
    [1, 3, null, "Slope", "Intercept"],
    [2, 5, null, "=LINEST(B12:B16,A12:A16)"],
    [3, 7],
    [4, 9],
    [5, 11],
  ];
  async function show(active, address, filename) {
    await page.evaluate(
      ({ statistics, matrices, active }) =>
        localStorage.setItem(
          "mas-i-scratchpad-v1",
          JSON.stringify({
            version: 1,
            sheets: { Statistics: statistics, Matrices: matrices },
            sheetOrder: ["Statistics", "Matrices"],
            active,
            widths: {
              0: 155,
              1: 155,
              2: 65,
              3: 160,
              4: 155,
              5: 65,
              6: 155,
              7: 110,
            },
            rowHeight: 32,
          }),
        ),
      { statistics, matrices, active },
    );
    await page.reload();
    await page
      .locator("#save-status")
      .filter({ hasText: "Saved locally" })
      .waitFor();
    await page.locator("#address").fill(address);
    await page.locator("#address").press("Enter");
    await page.screenshot({
      path: `store/images/${filename}`,
      omitBackground: false,
    });
  }
  await show("Statistics", "B2:B9", "01-statistics-1280x800.png");
  await show("Matrices", "D2", "02-matrices-1280x800.png");
  await page.locator("#functions").click();
  await page.locator("#function-search").fill("NORM");
  await page.screenshot({
    path: "store/images/03-functions-1280x800.png",
    omitBackground: false,
  });
  console.log(
    "Store images saved in store/images (synthetic sample data only).",
  );
} finally {
  await context?.close();
  await fs.rm(profile, { recursive: true, force: true });
}
