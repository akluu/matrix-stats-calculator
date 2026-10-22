import { test as base, expect, chromium } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
const extensionPath = path.resolve("dist");
const test = base.extend({
  context: async ({}, use) => {
    const profile = await fs.mkdtemp(
      path.join(os.tmpdir(), "matrix-stats-test-"),
    );
    const context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
      viewport: { width: 1000, height: 720 },
    });
    await use(context);
    await context.close();
    await fs.rm(profile, { recursive: true, force: true });
  },
  page: async ({ context }, use) => {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    const id = new URL(worker.url()).host;
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`chrome-extension://${id}/index.html`);
    await expect(page.locator("#save-status")).toHaveText("Saved locally");
    await use(page);
    expect(errors).toEqual([]);
  },
});
const cell = (page, r, c) =>
  page.locator(`td[data-row="${r}"][data-col="${c}"]`);
async function go(page, address) {
  await page.locator("#address").fill(address);
  await page.locator("#address").press("Enter");
}
async function enter(page, address, text) {
  await go(page, address);
  await page.locator("#formula").fill(text);
  await page.locator("#formula").press("Enter");
}
async function paste(page, text) {
  await page.locator("#grid").evaluate((grid, text) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    grid.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, text);
}
async function copied(page, kind = "copy") {
  return page.locator("#grid").evaluate((grid, kind) => {
    const dt = new DataTransfer();
    grid.dispatchEvent(
      new ClipboardEvent(kind, {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
    return Object.fromEntries([...dt.types].map((t) => [t, dt.getData(t)]));
  }, kind);
}
async function pasteData(page, data) {
  await page.locator("#grid").evaluate((grid, data) => {
    const dt = new DataTransfer();
    for (const [k, v] of Object.entries(data)) dt.setData(k, v);
    grid.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, data);
}
test("formulas, selection totals, save and reopen", async ({ page }) => {
  await go(page, "A1");
  await paste(page, "1\t2\n3\t4");
  await enter(page, "D1", "=SUM(A1:B2)");
  await expect(cell(page, 0, 3)).toHaveText("10");
  await go(page, "A1:B2");
  await expect(page.locator("#selection-stats")).toContainText("Sum 10");
  await expect(page.locator("#selection-stats")).toContainText("Average 2.5");
  await enter(page, "D2", "=NORM.S.INV(0.975)");
  await expect(cell(page, 1, 3)).toContainText("1.959963");
  await page.reload();
  await expect(cell(page, 0, 3)).toHaveText("10");
});
test("matrix spills, protected children, references and persistence", async ({
  page,
}) => {
  await go(page, "A1");
  await paste(page, "1\t2\n3\t4");
  await enter(page, "D1", "=MINVERSE(A1:B2)");
  await expect(cell(page, 0, 3)).toHaveText("-2");
  await expect(cell(page, 1, 4)).toHaveText("-0.5");
  await go(page, "E2");
  await page.keyboard.type("9");
  await expect(page.locator("#message")).toContainText("Array result");
  await expect(cell(page, 1, 4)).toHaveText("-0.5");
  await page.reload();
  await expect(cell(page, 1, 4)).toHaveText("-0.5");
  await enter(page, "A1", "2");
  await expect(cell(page, 0, 3)).toHaveText("2");
});
test("keyboard editing, shift selection, fill, mixed-reference copy and undo", async ({
  page,
}) => {
  await go(page, "A1");
  await page.keyboard.type("2");
  await page.keyboard.press("Enter");
  await page.keyboard.type("3");
  await page.keyboard.press("Enter");
  await enter(page, "B1", "=A1+$A$1");
  await go(page, "B1:B2");
  await page.locator("#fill-down").click();
  await expect(cell(page, 1, 1)).toHaveText("5");
  await page.locator("#undo").click();
  await expect(cell(page, 1, 1)).toHaveText("");
  await page.locator("#redo").click();
  await expect(cell(page, 1, 1)).toHaveText("5");
  await go(page, "B1");
  const data = await copied(page);
  await go(page, "C2");
  await pasteData(page, data);
  await expect(cell(page, 1, 2)).toHaveText("7");
  await go(page, "C2");
  await expect(page.locator("#formula")).toHaveValue("=B2+$A$1");
  await go(page, "A1");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.locator("#address")).toHaveValue("A1:B2");
});
test("click and drag formula references, F4, and function suggestions", async ({
  page,
}) => {
  await enter(page, "A1", "4");
  await enter(page, "A2", "5");
  await go(page, "C1");
  await page.keyboard.type("=SUM(");
  await expect(page.locator("#formula-help strong")).toHaveText("number1");
  const [a, b] = await page.evaluate(() => [
    document
      .querySelector('td[data-row="0"][data-col="0"]')
      .getBoundingClientRect()
      .toJSON(),
    document
      .querySelector('td[data-row="1"][data-col="0"]')
      .getBoundingClientRect()
      .toJSON(),
  ]);
  await page.mouse.move(a.x + 20, a.y + 10);
  await page.mouse.down();
  await page.mouse.move(b.x + 20, b.y + 10);
  await page.mouse.up();
  await page.keyboard.type(")");
  await page.keyboard.press("Enter");
  await expect(cell(page, 0, 2)).toHaveText("9");
  await go(page, "C2");
  await page.keyboard.type("=A1");
  await page.keyboard.press("F4");
  await page.keyboard.press("Enter");
  await go(page, "C2");
  await expect(page.locator("#formula")).toHaveValue("=$A$1");
  await go(page, "D1");
  await page.keyboard.type("=NORM.S.I");
  await expect(page.locator("#suggestions")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.locator("#editor")).toHaveValue("=NORM.S.INV(");
  await page.keyboard.press("Escape");
});
test("row insertion and sheet changes save correctly", async ({ page }) => {
  await enter(page, "A1", "=B10");
  await enter(page, "B10", "7");
  await go(page, "A5");
  await page.locator("#insert-row").click();
  await go(page, "A1");
  await expect(page.locator("#formula")).toHaveValue("=B11");
  await expect(cell(page, 0, 0)).toHaveText("7");
  await page.locator("#new-sheet").click();
  await enter(page, "A1", "=Scratch!B11");
  await expect(cell(page, 0, 0)).toHaveText("7");
  await page.reload();
  await expect(cell(page, 0, 0)).toHaveText("7");
});
test("virtualized grid, sizing and plain layout", async ({ page }) => {
  const initial = await page.locator("td[data-row]").count();
  expect(initial).toBeLessThan(600);
  await go(page, "CZ2000");
  await expect(cell(page, 1999, 103)).toBeVisible();
  await page.keyboard.type("12");
  await page.keyboard.press("Enter");
  await expect(cell(page, 1999, 103)).toHaveText("12");
  expect(await page.locator("td[data-row]").count()).toBeLessThan(600);
  await go(page, "A1");
  const handle = page.locator('[data-resize="0"]');
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + 3, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 83, box.y + 10);
  await page.mouse.up();
  await expect
    .poll(async () => Math.round((await cell(page, 0, 0).boundingBox()).width))
    .toBe(190);
  await page.locator("#row-height").fill("40");
  await page.locator("#row-height").press("Tab");
  await expect
    .poll(async () => Math.round((await cell(page, 0, 0).boundingBox()).height))
    .toBe(40);
  await page.screenshot({ path: "/tmp/matrix-stats-calculator.png" });
});
test("local-only startup and moderate worksheet performance", async ({
  page,
  context,
}) => {
  const network = [];
  page.on("request", (r) => {
    if (/^https?:/.test(r.url())) network.push(r.url());
  });
  const data = Array.from({ length: 1000 }, (_, r) =>
    Array.from({ length: 20 }, (_, c) =>
      c === 19 ? `=SUM(A${r + 1}:S${r + 1})` : r + c,
    ),
  );
  await page.evaluate(
    (data) =>
      localStorage.setItem(
        "mas-i-scratchpad-v1",
        JSON.stringify({
          version: 1,
          sheets: { Scratch: data },
          active: "Scratch",
        }),
      ),
    data,
  );
  const start = Date.now();
  await page.reload();
  await expect(page.locator("#save-status")).toHaveText("Saved locally");
  const loadMs = Date.now() - start;
  const client = await context.newCDPSession(page);
  await client.send("Performance.enable");
  const before = await client.send("Performance.getMetrics");
  const scrollMs = await page.evaluate(async () => {
    const grid = document.getElementById("grid"),
      start = performance.now();
    for (let i = 0; i < 30; i++) {
      grid.scrollTop = i * 700;
      await new Promise(requestAnimationFrame);
    }
    return performance.now() - start;
  });
  const editMs = await page.evaluate(() => {
    const input = document.getElementById("formula");
    input.focus();
    input.value = "2";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const start = performance.now();
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    return performance.now() - start;
  });
  const after = await client.send("Performance.getMetrics");
  const heap = after.metrics.find((m) => m.name === "JSHeapUsedSize").value;
  console.log(
    JSON.stringify({
      cells: 20000,
      loadMs,
      scrollMs: Math.round(scrollMs),
      editMs: Math.round(editMs),
      rendered: await page.locator("td[data-row]").count(),
      heapMB: Math.round(heap / 1024 / 1024),
    }),
  );
  expect(network).toEqual([]);
  expect(await page.locator("td[data-row]").count()).toBeLessThan(600);
  expect(loadMs).toBeLessThan(5000);
  expect(scrollMs).toBeLessThan(2500);
  expect(heap).toBeLessThan(150 * 1024 * 1024);
  expect(editMs).toBeLessThan(500);
});
test("extension opens a native side panel without creating a popup", async ({
  page,
  context,
}) => {
  const worker = context.serviceWorkers()[0];
  await expect
    .poll(() => worker.evaluate(() => chrome.sidePanel.getPanelBehavior()))
    .toEqual({ openPanelOnActionClick: true });
  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.side_panel.default_path).toBe("index.html");
  expect(manifest.commands._execute_action.suggested_key.default).toBe(
    "Alt+Shift+S",
  );
  await enter(page, "A1", "=SUM(2,3)");
  await page.evaluate(async () => {
    const win = await chrome.windows.getCurrent();
    document
      .querySelector("#help")
      .addEventListener("click", () =>
        chrome.sidePanel.open({ windowId: win.id }),
      );
  });
  await page.locator("#help").click();
  await expect
    .poll(() =>
      worker.evaluate(
        async () =>
          (await chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] }))
            .length,
      ),
    )
    .toBe(1);
  const windows = await worker.evaluate(() => chrome.windows.getAll());
  expect(windows.filter((w) => w.type === "popup")).toHaveLength(0);
  await expect(page.locator("#save-status")).toHaveText("Saved locally");
});
test("narrow sidebar keeps controls visible and calculations usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await enter(page, "A1", "=NORM.S.DIST(0,TRUE)");
  await expect(cell(page, 0, 0)).toHaveText("0.5");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  expect(
    await page.locator("#grid").evaluate((el) => el.clientHeight),
  ).toBeGreaterThan(250);
  for (const id of [
    "functions",
    "help",
    "export",
    "import",
    "apply",
    "insert-row",
    "delete-row",
    "insert-col",
    "delete-col",
  ]) {
    const rect = await page.locator(`#${id}`).boundingBox();
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(320);
  }
  await page.screenshot({ path: "/tmp/matrix-stats-sidebar.png" });
});
test("invalid address is atomic and external copy keeps full precision", async ({
  page,
}) => {
  await enter(page, "A1", "1.23456789012345");
  await enter(page, "A2", "keep");
  await go(page, "A1");
  const data = await copied(page);
  expect(data["text/plain"]).toBe("1.23456789012345");
  await page.locator("#address").fill("A2:bad");
  await page.locator("#address").press("Enter");
  await expect(page.locator("#message")).toContainText("Enter an address");
  await page.locator("#grid").focus();
  await page.keyboard.press("Delete");
  await expect(cell(page, 1, 0)).toHaveText("keep");
});
test("undo restores a live matrix formula after clearing it", async ({
  page,
}) => {
  await enter(page, "A1", "=MINVERSE({1,2;3,4})");
  await go(page, "A1");
  await page.keyboard.press("Delete");
  await expect(cell(page, 1, 1)).toHaveText("");
  await page.locator("#undo").click();
  await expect(cell(page, 1, 1)).toHaveText("-0.5");
  await go(page, "A1");
  await expect(page.locator("#formula")).toHaveValue("=MINVERSE({1,2;3,4})");
  await page.reload();
  await expect(cell(page, 1, 1)).toHaveText("-0.5");
});
test("select all while scrolled stays editable, unsupported clipboard is harmless", async ({
  page,
}) => {
  await go(page, "A1000");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("42");
  await page.keyboard.press("Enter");
  await expect(cell(page, 0, 0)).toHaveText("42");
  await go(page, "A1");
  await page.locator("#grid").evaluate((grid) => {
    const dt = new DataTransfer();
    dt.setData("image/png", "x");
    grid.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(cell(page, 0, 0)).toHaveText("42");
  await expect(page.locator("#message")).toContainText("no spreadsheet text");
});
test("copy survives as a formula or explicitly requests recopy after undo", async ({
  page,
}) => {
  await enter(page, "A1", "4");
  await enter(page, "B1", "=A1*2");
  await go(page, "B1");
  const data = await copied(page);
  await enter(page, "A2", "9");
  await page.locator("#undo").click();
  await go(page, "C1");
  await pasteData(page, data);
  await expect(cell(page, 0, 2)).toHaveText("");
  await expect(page.locator("#message")).toContainText("Copy the cells again");
});
test("scrolling during a cell edit keeps the formula bar usable", async ({
  page,
}) => {
  await go(page, "A1");
  await page.keyboard.type("=SUM(1,2)");
  await page.locator("#grid").evaluate((grid) => (grid.scrollTop = 10000));
  await expect(page.locator("#formula")).toBeFocused();
  await page.keyboard.press("Enter");
  await go(page, "A1");
  await expect(cell(page, 0, 0)).toHaveText("3");
});

test("scroll handoff preserves the selected text for replacement", async ({
  page,
}) => {
  await go(page, "A1");
  await page.keyboard.type("=SUM(1,2)");
  await page
    .locator("#editor")
    .evaluate((input) => input.setSelectionRange(5, 6, "backward"));
  await page.locator("#grid").evaluate((grid) => (grid.scrollTop = 10000));
  await expect(page.locator("#formula")).toBeFocused();
  expect(
    await page
      .locator("#formula")
      .evaluate((input) => [
        input.selectionStart,
        input.selectionEnd,
        input.selectionDirection,
      ]),
  ).toEqual([5, 6, "backward"]);
  await page.keyboard.type("4");
  await page.keyboard.press("Enter");
  await go(page, "A1");
  await expect(cell(page, 0, 0)).toHaveText("6");
});

test("a stale view pauses editing, exports its draft, and reloads without overwriting", async ({
  page,
  context,
}) => {
  await enter(page, "A1", "1");
  const other = await context.newPage();
  await other.goto(page.url());
  await expect(other.locator("#save-status")).toHaveText("Saved locally");
  await go(other, "B1");
  await other.keyboard.type("=SUM(7,8)");
  await enter(page, "A1", "9");
  await expect(other.locator("#conflict")).toBeVisible();
  expect(await other.locator("#workspace").evaluate((el) => el.inert)).toBe(
    true,
  );
  await other.keyboard.type("999");
  const downloadEvent = other.waitForEvent("download");
  await other.locator("#conflict-backup").click();
  const download = await downloadEvent;
  const data = JSON.parse(await fs.readFile(await download.path(), "utf8"));
  expect(data.sheets.Scratch[0][0]).toBe("1");
  expect(data.sheets.Scratch[0][1]).toBe("=SUM(7,8)");
  await other.locator("#reload-latest").click();
  await expect(other.locator("#conflict")).toBeHidden();
  await expect(cell(other, 0, 0)).toHaveText("9");
  await expect(cell(other, 0, 1)).toHaveText("");
  await page.reload();
  await expect(cell(page, 0, 0)).toHaveText("9");
  await other.close();
});

test("reloading a stale view with an unfinished edit cannot overwrite newer work", async ({
  page,
  context,
}) => {
  await enter(page, "A1", "1");
  const other = await context.newPage();
  await other.goto(page.url());
  await go(other, "B1");
  await other.keyboard.type("42");
  await enter(page, "A1", "9");
  await expect(other.locator("#conflict")).toBeVisible();
  other.once("dialog", (dialog) => dialog.accept());
  await other.locator("#reload-latest").click();
  await expect(cell(other, 0, 0)).toHaveText("9");
  await expect(cell(other, 0, 1)).toHaveText("");
  await page.reload();
  await expect(cell(page, 0, 0)).toHaveText("9");
  await expect(cell(page, 0, 1)).toHaveText("");
  await other.close();
});

test("conflict recovery closes overlays and preserves an invalid draft as text", async ({
  page,
  context,
}) => {
  await enter(page, "A1", "1");
  const other = await context.newPage();
  await other.goto(page.url());
  await go(other, "B1");
  const draft = "x".repeat(10001);
  await other.locator("#formula").fill(draft);
  await other.locator("#functions").click();
  await expect(other.locator("#function-panel")).toBeVisible();
  await enter(page, "A1", "9");
  await expect(other.locator("#conflict")).toBeVisible();
  await expect(other.locator("#function-panel")).toBeHidden();
  const downloading = other.waitForEvent("download");
  await other.locator("#save-draft").click();
  const download = await downloading;
  expect(await fs.readFile(await download.path(), "utf8")).toBe(
    "Scratch!B1\n\n" + draft,
  );
  const backupEvent = other.waitForEvent("download");
  await other.locator("#conflict-backup").click();
  const backup = JSON.parse(
    await fs.readFile(await (await backupEvent).path(), "utf8"),
  );
  expect(backup.sheets.Scratch[0][0]).toBe("1");
  expect(backup.sheets.Scratch[0][1] ?? null).toBe(null);
  other.once("dialog", (dialog) => dialog.accept());
  await other.locator("#reload-latest").click();
  await expect(cell(other, 0, 0)).toHaveText("9");
  await expect(cell(other, 0, 1)).toHaveText("");
  await other.close();
});

test("copy survives a rejected out-of-bounds paste", async ({ page }) => {
  await paste(page, "1\n2\n3");
  await go(page, "A1:A3");
  const data = await copied(page);
  await go(page, "A1999");
  await pasteData(page, data);
  await expect(page.locator("#message")).toContainText("exceed");
  await go(page, "B1");
  await pasteData(page, data);
  await expect(cell(page, 2, 1)).toHaveText("3");
});
test("double-click while pointing a formula preserves the draft", async ({
  page,
}) => {
  await go(page, "C1");
  await page.keyboard.type("=SUM(");
  await cell(page, 0, 0).dblclick();
  await expect(page.locator("#formula")).toHaveValue("=SUM(A1");
});
test("formula focus followed by grid selection does not join reference tokens", async ({
  page,
}) => {
  await enter(page, "C1", "=A1+1");
  await go(page, "C1");
  await page.locator("#formula").focus();
  await page.locator("#formula").evaluate((el) => el.setSelectionRange(4, 4));
  await cell(page, 2, 1).click();
  await go(page, "C1");
  await expect(page.locator("#formula")).toHaveValue("=A1+1");
});
test("saving checks current storage even before a change event is delivered", async ({
  page,
}) => {
  await enter(page, "A1", "1");
  // Deterministic queued-event analogue: change persisted data inside prompt,
  // without a storage event in this context, then let the rename resume.
  await page.evaluate(() => {
    window.prompt = () => {
      const key = "mas-i-scratchpad-v1";
      const data = JSON.parse(localStorage.getItem(key));
      data.sheets.Scratch[0][0] = "9";
      localStorage.setItem(key, JSON.stringify(data));
      return "Renamed";
    };
  });
  await page.locator("#rename").click();
  await expect(page.locator("#conflict")).toBeVisible();
  await page.locator("#reload-latest").click();
  await expect(cell(page, 0, 0)).toHaveText("9");
  await expect(page.locator("#tabs button")).toHaveText("Scratch");
});

test("copy survives a rejected paste onto an array result", async ({
  page,
}) => {
  await enter(page, "D1", "=TRANSPOSE({1,2})");
  await enter(page, "A1", "7");
  await go(page, "A1");
  const data = await copied(page);
  await go(page, "D2");
  await pasteData(page, data);
  await expect(page.locator("#message")).toContainText("array result");
  await expect(cell(page, 1, 3)).toHaveText("2");
  await go(page, "B1");
  await pasteData(page, data);
  await expect(cell(page, 0, 1)).toHaveText("7");
});
test("pointing can replace a selected reference before a percent operator", async ({
  page,
}) => {
  await enter(page, "A1", "20");
  await enter(page, "B1", "50");
  await enter(page, "C1", "=A1%");
  await go(page, "C1");
  await page.locator("#formula").focus();
  await page.locator("#formula").evaluate((el) => el.setSelectionRange(1, 3));
  await cell(page, 0, 1).click();
  await page.keyboard.press("Enter");
  await go(page, "C1");
  await expect(page.locator("#formula")).toHaveValue("=B1%");
  await expect(cell(page, 0, 2)).toHaveText("0.5");
});

test("range, disjoint, header and keyboard selections count each cell once", async ({
  page,
}) => {
  await go(page, "A1");
  await paste(page, "1\t2\n3\ttext");
  await enter(page, "D1", "10");
  const start = await cell(page, 0, 0).boundingBox();
  const end = await cell(page, 1, 1).boundingBox();
  await page.mouse.move(start.x + 20, start.y + 10);
  await page.mouse.down();
  await page.mouse.move(end.x + 20, end.y + 10);
  await page.mouse.up();
  await expect(page.locator("#address")).toHaveValue("A1:B2");
  await cell(page, 0, 0).click();
  await cell(page, 1, 1).click({ modifiers: ["Shift"] });
  await expect(page.locator("#address")).toHaveValue("A1:B2");
  await expect(page.locator("#selection-stats")).toHaveText(
    "Count 4    Sum 6    Average 2",
  );
  await cell(page, 0, 3).click({ modifiers: ["Control"] });
  await expect(page.locator("#selection-stats")).toHaveText(
    "Count 5    Sum 16    Average 4",
  );
  await cell(page, 0, 0).click({ modifiers: ["Control"] });
  await expect(page.locator("#selection-stats")).toHaveText(
    "Count 5    Sum 16    Average 4",
  );
  await page.keyboard.press("Delete");
  await expect(cell(page, 1, 1)).toHaveText("");
  await expect(cell(page, 0, 3)).toHaveText("");
  await page.locator("#undo").click();
  await expect(cell(page, 1, 1)).toHaveText("text");
  await expect(cell(page, 0, 3)).toHaveText("10");
  await page
    .locator('th[data-kind="column"][data-col="1"]')
    .click({ position: { x: 20, y: 10 } });
  await expect(page.locator("#address")).toHaveValue("B1:B2000");
  await page.locator('th[data-kind="row"][data-row="1"]').click();
  await expect(page.locator("#address")).toHaveValue("A2:CZ2");
  await go(page, "B2");
  await page.keyboard.press("Control+Space");
  await expect(page.locator("#address")).toHaveValue("B1:B2000");
  await go(page, "B2");
  await page.keyboard.press("Shift+Space");
  await expect(page.locator("#address")).toHaveValue("A2:CZ2");
  await page.locator('th[data-kind="all"]').click();
  await expect(page.locator("#address")).toHaveValue("A1:CZ2000");
});

test("navigation, data jumps, edit and cancel preserve cell values", async ({
  page,
}) => {
  await go(page, "A1");
  await paste(page, "1\t2\t3\n4\t5\t6\n7\t8\t9");
  for (const [key, address] of [
    ["Control+ArrowRight", "C1"],
    ["Control+ArrowDown", "C3"],
    ["Home", "A3"],
    ["Control+Home", "A1"],
    ["Control+End", "C3"],
    ["ArrowLeft", "B3"],
    ["Tab", "C3"],
    ["Shift+Tab", "B3"],
    ["Enter", "B4"],
    ["Shift+Enter", "B3"],
  ]) {
    await page.keyboard.press(key);
    await expect(page.locator("#address")).toHaveValue(address);
  }
  await page.keyboard.press("F2");
  await expect(page.locator("#editor")).toHaveValue("8");
  await page.keyboard.type("99");
  await page.keyboard.press("Escape");
  await expect(cell(page, 2, 1)).toHaveText("8");
  await cell(page, 2, 1).dblclick();
  await page.locator("#editor").fill("12");
  await page.keyboard.press("Enter");
  await expect(cell(page, 2, 1)).toHaveText("12");
  await go(page, "A1");
  await page.keyboard.press("PageDown");
  const down = await page.locator("#address").inputValue();
  expect(Number(down.slice(1))).toBeGreaterThan(1);
  await page.keyboard.press("PageUp");
  await expect(page.locator("#address")).toHaveValue("A1");
});

test("cut and fill right update formulas and support undo and redo", async ({
  page,
}) => {
  await enter(page, "A1", "3");
  await enter(page, "B1", "=A1+1");
  await go(page, "A1");
  const data = await copied(page, "cut");
  await go(page, "A2");
  await pasteData(page, data);
  await expect(cell(page, 0, 0)).toHaveText("");
  await expect(cell(page, 1, 0)).toHaveText("3");
  await go(page, "B1");
  await expect(page.locator("#formula")).toHaveValue("=A2+1");
  await go(page, "B1:D1");
  await page.locator("#fill-right").click();
  await go(page, "D1");
  await expect(page.locator("#formula")).toHaveValue("=C2+1");
  await page.keyboard.press("Control+z");
  await expect(cell(page, 0, 3)).toHaveText("");
  await page.keyboard.press("Control+Shift+z");
  await expect(cell(page, 0, 3)).toHaveText("1");
});

test("column and row deletion, sheet rename and deletion keep references and undo", async ({
  page,
}) => {
  await enter(page, "A1", "7");
  await enter(page, "B1", "=A1*2");
  await go(page, "A1");
  await page.locator("#insert-col").click();
  await go(page, "C1");
  await expect(page.locator("#formula")).toHaveValue("=B1*2");
  await go(page, "A1");
  await page.locator("#delete-col").click();
  await expect(cell(page, 0, 1)).toHaveText("14");
  await page.locator("#delete-row").click();
  await expect(cell(page, 0, 1)).toHaveText("");
  await page.locator("#undo").click();
  await expect(cell(page, 0, 1)).toHaveText("14");
  await page.locator("#new-sheet").click();
  await enter(page, "A1", "=Scratch!B1");
  await page
    .locator("#tabs button")
    .filter({ hasText: /^Scratch$/ })
    .click();
  await enter(page, "C1", "='Scratch 1'!A1");
  await page
    .locator("#tabs button")
    .filter({ hasText: /^Scratch 1$/ })
    .click();
  page.once("dialog", (dialog) => dialog.accept("Results"));
  await page.locator("#rename").click();
  await expect(page.locator('#tabs button[aria-selected="true"]')).toHaveText(
    "Results",
  );
  await page
    .locator("#tabs button")
    .filter({ hasText: /^Scratch$/ })
    .click();
  await go(page, "C1");
  await expect(page.locator("#formula")).toHaveValue(/^='?Results'?!A1$/);
  await expect(cell(page, 0, 2)).toHaveText("14");
  await page
    .locator("#tabs button")
    .filter({ hasText: /^Results$/ })
    .click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#delete-sheet").click();
  await expect(page.locator("#tabs button")).toHaveCount(1);
  await page.locator("#undo").click();
  await page.locator("#tabs button", { hasText: "Results" }).click();
  await expect(cell(page, 0, 0)).toHaveText("14");
});

test("renamed extension reads existing storage and round-trips workbook backups", async ({
  page,
}) => {
  await expect(page).toHaveTitle("Matrix & Stats Calculator");
  const legacy = {
    version: 1,
    sheets: { Scratch: [["=SUM(2,3)"]] },
    active: "Scratch",
    widths: { 0: 150 },
    rowHeight: 32,
  };
  await page.evaluate(
    (value) =>
      localStorage.setItem("mas-i-scratchpad-v1", JSON.stringify(value)),
    legacy,
  );
  await page.reload();
  await expect(cell(page, 0, 0)).toHaveText("5");
  await expect(page.locator("#row-height")).toHaveValue("32");
  const pending = page.waitForEvent("download");
  await page.locator("#export").click();
  const backup = await pending;
  expect(backup.suggestedFilename()).toBe("matrix-stats-calculator.json");
  const file = await backup.path();
  const exported = JSON.parse(await fs.readFile(file, "utf8"));
  expect(exported.sheets.Scratch[0][0]).toBe("=SUM(2,3)");
  await enter(page, "A1", "999");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#file").setInputFiles(file);
  await expect(cell(page, 0, 0)).toHaveText("5");
  await go(page, "A1");
  await expect(page.locator("#formula")).toHaveValue("=SUM(2,3)");
  await page.reload();
  await expect(cell(page, 0, 0)).toHaveText("5");
  await go(page, "A1");
  await expect(page.locator("#formula")).toHaveValue("=SUM(2,3)");
});

test("function search inserts a working formula", async ({ page }) => {
  await go(page, "A1");
  await page.locator("#functions").click();
  await page.locator("#function-search").fill("MDETERM");
  await page.locator("#function-list button").click();
  await expect(page.locator("#editor")).toHaveValue("=MDETERM(");
  await page.keyboard.type("{1,2;3,4})");
  await page.keyboard.press("Enter");
  await expect(cell(page, 0, 0)).toHaveText("-2");
});

test("direct row and column buttons act on selected ranges and commit edits", async ({
  page,
}) => {
  await expect(page.locator("#structure")).toHaveCount(0);
  await enter(page, "A1", "3");
  await enter(page, "B1", "=A1*2");
  await go(page, "A1");
  await page.keyboard.press("F2");
  await page.locator("#editor").fill("7");
  await page.locator("#insert-row").click();
  await expect(cell(page, 0, 0)).toHaveText("");
  await expect(cell(page, 1, 0)).toHaveText("7");
  await expect(cell(page, 1, 1)).toHaveText("14");
  await expect(page.locator("#message")).toHaveText(
    "Inserted 1 row above row 1.",
  );
  await page.locator("#insert-row").click();
  await expect(cell(page, 2, 0)).toHaveText("7");
  await go(page, "A1:A2");
  await page.locator("#delete-row").click();
  await expect(cell(page, 0, 0)).toHaveText("7");
  await expect(page.locator("#message")).toHaveText(
    "Deleted 2 rows starting at 1.",
  );
  await go(page, "A1:B1");
  await page.locator("#insert-col").click();
  await expect(cell(page, 0, 2)).toHaveText("7");
  await expect(cell(page, 0, 3)).toHaveText("14");
  await page.locator("#delete-col").click();
  await expect(cell(page, 0, 0)).toHaveText("7");
  await page.locator("#undo").click();
  await expect(cell(page, 0, 2)).toHaveText("7");
  await page.reload();
  await expect(cell(page, 0, 3)).toHaveText("14");
});

test("function guide explains parameters, examples and additional statistics", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.locator("#functions").click();
  await page.locator("#function-search").fill("GAMMA.DIST");
  const gamma = page.getByRole("button", { name: /^GAMMA\.DIST\(/ });
  await expect(gamma).toContainText("scale, not rate");
  await expect(gamma.locator(".function-example")).toContainText(
    "=GAMMA.DIST(2,2,1,FALSE)",
  );
  await page.locator("#function-search").fill("STANDARDIZE");
  await expect(page.locator("#function-list button")).toContainText("z-score");
  await expect(page.locator("#function-list .function-example")).toContainText(
    "→ 2",
  );
  const panel = page.locator("#function-panel");
  expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.locator("#function-list button").click();
  await page.keyboard.type("14,10,2)");
  await page.keyboard.press("Enter");
  await expect(cell(page, 0, 0)).toHaveText("2");
});

test("row action confirmation does not hide an autosave failure", async ({
  page,
}) => {
  await enter(page, "A1", "9");
  await go(page, "A1");
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };
  });
  await page.locator("#insert-row").click();
  await expect(cell(page, 1, 0)).toHaveText("9");
  await expect(page.locator("#save-status")).toHaveText("Not saved");
  await expect(page.locator("#message")).toContainText("Autosave failed");
});

test("formula hints track nested arguments, caret changes and F4 without changing saved cells", async ({
  page,
}) => {
  await go(page, "F1");
  const input = page.locator("#formula"),
    help = page.locator("#formula-help");
  await input.fill("=MMULT(A1:B2,D1:E2)");
  await input.evaluate((el) => {
    el.setSelectionRange(13, 13);
    el.dispatchEvent(new Event("select"));
  });
  await expect(help.locator("strong")).toHaveText("array2");
  await expect(cell(page, 0, 0)).toHaveClass(/formula-reference/);
  await expect(cell(page, 1, 1)).toHaveClass(/formula-reference/);
  await expect(cell(page, 0, 3)).toHaveClass(/formula-reference/);
  expect(
    await cell(page, 0, 0).evaluate((el) =>
      el.style.getPropertyValue("--reference-fill"),
    ),
  ).not.toBe(
    await cell(page, 0, 3).evaluate((el) =>
      el.style.getPropertyValue("--reference-fill"),
    ),
  );
  await input.evaluate((el) => {
    el.setSelectionRange(8, 8);
    el.dispatchEvent(new Event("select"));
  });
  await expect(help.locator("strong")).toHaveText("array1");
  await input.press("F4");
  await expect(input).toHaveValue("=MMULT($A$1:B2,D1:E2)");
  await expect(help).toContainText("$A$1:B2");
  await input.fill("=MMULT(TRANSPOSE(A1:B2),D1:E2)");
  await input.evaluate((el) => {
    const p = el.value.indexOf(")");
    el.setSelectionRange(p, p);
    el.dispatchEvent(new Event("select"));
  });
  await expect(help.locator(".function-signature")).toHaveText(
    "TRANSPOSE(array)",
  );
  await input.press("Escape");
  await expect(help).toBeHidden();
  await expect(page.locator(".formula-reference")).toHaveCount(0);
  await expect(cell(page, 0, 5)).toHaveText("");
});

test("MMULT can be composed by pointing at colored ranges and commits the identity product", async ({
  page,
}) => {
  await go(page, "A1");
  await paste(page, "12\t12\t\t1\t0\n12\t12\t\t0\t1");
  await go(page, "G1");
  await page.keyboard.type("=MMU");
  await page.keyboard.press("Tab");
  await expect(page.locator("#editor")).toHaveValue("=MMULT(");
  await expect(page.locator("#formula-help strong")).toHaveText("array1");
  async function pointRange(r1, c1, r2, c2) {
    await expect(cell(page, r1, c1)).toBeVisible();
    await expect(cell(page, r2, c2)).toBeVisible();
    const [a, b] = await page.evaluate(
      ([r1, c1, r2, c2]) => [
        document
          .querySelector(`td[data-row="${r1}"][data-col="${c1}"]`)
          .getBoundingClientRect()
          .toJSON(),
        document
          .querySelector(`td[data-row="${r2}"][data-col="${c2}"]`)
          .getBoundingClientRect()
          .toJSON(),
      ],
      [r1, c1, r2, c2],
    );
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.up();
  }
  const gridTop = (await page.locator("#grid").boundingBox()).y;
  await pointRange(0, 0, 1, 1);
  expect((await page.locator("#grid").boundingBox()).y).toBe(gridTop);
  await expect(page.locator("#editor")).toHaveValue("=MMULT(A1:B2");
  await expect(page.locator(".formula-reference")).toHaveCount(4);
  await page.keyboard.type(",");
  await expect(page.locator("#formula-help strong")).toHaveText("array2");
  await pointRange(0, 3, 1, 4);
  await expect(page.locator("#editor")).toHaveValue("=MMULT(A1:B2,D1:E2");
  await expect(page.locator(".formula-reference")).toHaveCount(8);
  await page.keyboard.type(")");
  await page.keyboard.press("Enter");
  for (const [r, c] of [
    [0, 6],
    [0, 7],
    [1, 6],
    [1, 7],
  ])
    await expect(cell(page, r, c)).toHaveText("12");
  await expect(page.locator("#formula-help")).toBeHidden();
  await expect(page.locator(".formula-reference")).toHaveCount(0);
  await page.reload();
  await expect(cell(page, 1, 7)).toHaveText("12");
});

test("reference highlights ignore strings and other sheets and survive virtualized scrolling", async ({
  page,
}) => {
  await go(page, "F1");
  const input = page.locator("#formula");
  await input.fill("=SUM(\"A1\",Other!B2,'Scratch'!C3,A100:A102");
  await expect(cell(page, 0, 0)).not.toHaveClass(/formula-reference/);
  await expect(cell(page, 1, 1)).not.toHaveClass(/formula-reference/);
  await expect(cell(page, 2, 2)).toHaveClass(/formula-reference/);
  await page.locator("#grid").evaluate((el) => (el.scrollTop = 2500));
  await expect(cell(page, 99, 0)).toHaveClass(/formula-reference/);
  expect(await page.locator("td[data-row]").count()).toBeLessThan(600);
  await input.press("Escape");
  await expect(page.locator(".formula-reference")).toHaveCount(0);
});

test("formula help stays inside a narrow sidebar and clears on conflicting saves", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.locator("#formula").fill("=NORM.DIST(A1,B2,C3,");
  await expect(page.locator("#formula-help strong")).toHaveText("cumulative");
  const box = await page.locator("#formula-help").boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  expect((await page.locator("#grid").boundingBox()).height).toBeGreaterThan(
    200,
  );
  const other = await context.newPage();
  await other.goto(page.url());
  await enter(other, "A1", "10");
  await expect(page.locator("#conflict")).toBeVisible();
  await expect(page.locator("#formula-help")).toBeHidden();
  await expect(page.locator(".formula-reference")).toHaveCount(0);
});

test("function suggestions follow the editor after hint layout and scroll handoff", async ({
  page,
}) => {
  await go(page, "C1");
  await page.keyboard.type("=NORM");
  await expect(page.locator("#formula-help")).toBeVisible();
  await expect(page.locator("#suggestions")).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(() =>
        Math.round(
          document.getElementById("suggestions").getBoundingClientRect().top -
            document.getElementById("editor").getBoundingClientRect().bottom,
        ),
      ),
    )
    .toBe(0);
  await page.locator("#grid").evaluate((el) => (el.scrollTop = 1200));
  await expect(page.locator("#editor")).toBeHidden();
  await expect(page.locator("#formula")).toBeFocused();
  await expect
    .poll(async () =>
      page.evaluate(() =>
        Math.round(
          document.getElementById("suggestions").getBoundingClientRect().top -
            document.getElementById("formula").getBoundingClientRect().bottom,
        ),
      ),
    )
    .toBe(0);
  await page.keyboard.press("Tab");
  await expect(page.locator("#formula")).toHaveValue("=NORM.DIST(");
  await expect(page.locator("#formula-help strong")).toHaveText("x");
  await page.keyboard.press("Escape");
});

test("committing a formula preserves grid position until a selection drag finishes", async ({
  page,
}) => {
  await go(page, "C1");
  await page.keyboard.type("=SUM(A1:A2)");
  await expect(page.locator("#formula-help")).toBeVisible();
  const before = (await page.locator("#grid").boundingBox()).y;
  const [a, b] = await page.evaluate(() =>
    [4, 6].map((row) =>
      document
        .querySelector(`td[data-row="${row}"][data-col="3"]`)
        .getBoundingClientRect()
        .toJSON(),
    ),
  );
  await page.mouse.move(a.x + 20, a.y + 10);
  await page.mouse.down();
  await expect(cell(page, 0, 2)).toHaveText("0");
  expect((await page.locator("#grid").boundingBox()).y).toBe(before);
  await page.mouse.move(b.x + 20, b.y + 10);
  await page.mouse.up();
  await expect(page.locator("#address")).toHaveValue("D5:D7");
  await expect(page.locator("#formula-help")).toBeHidden();
});

test("virtualized renders paint formula references before exposing replacement cells", async ({
  page,
}) => {
  await go(page, "C1");
  await page.locator("#formula").fill("=SUM(A:A");
  await expect(cell(page, 0, 0)).toHaveClass(/formula-reference/);
  const unpainted = await page.evaluate(async () => {
    const grid = document.getElementById("grid"),
      body = document.getElementById("body");
    let misses = 0,
      renders = 0;
    const observer = new MutationObserver(() => {
      renders++;
      if (
        [...body.querySelectorAll('td[data-col="0"]')].some(
          (cell) => !cell.classList.contains("formula-reference"),
        )
      )
        misses++;
    });
    observer.observe(body, { childList: true });
    try {
      for (let i = 1; i <= 6; i++) {
        grid.scrollTop = i * 260;
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
      }
      return { misses, renders };
    } finally {
      observer.disconnect();
    }
  });
  expect(unpainted.renders).toBeGreaterThan(0);
  expect(unpainted.misses).toBe(0);
  await page.locator("#formula").press("Escape");
});
