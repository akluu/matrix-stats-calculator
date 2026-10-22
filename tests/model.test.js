import test from "node:test";
import assert from "node:assert/strict";
import {
  Workbook,
  bounds,
  hfRange,
  parseAddress,
  parseTSV,
  toTSV,
  validateSave,
} from "../src/model.js";
const a = (row, col = 0) => ({ sheet: 0, row, col });
test("initialization and edits recompute dependents, undo and redo", () => {
  const w = new Workbook();
  try {
    w.set(0, 0, "2");
    w.set(0, 1, "=A1^2");
    assert.equal(w.value(0, 1), 4);
    w.set(0, 0, "3");
    assert.equal(w.value(0, 1), 9);
    w.undo();
    assert.equal(w.value(0, 1), 4);
    w.redo();
    assert.equal(w.value(0, 1), 9);
  } finally {
    w.destroy();
  }
});
test("copy shifts relative references, preserves mixed and absolute references", () => {
  const w = new Workbook();
  try {
    w.set(0, 0, "=B1+$B$1+B$1+$B1");
    w.engine.copy({ start: a(0), end: a(0) });
    w.mutate(() => w.engine.paste(a(1, 1)));
    assert.equal(w.raw(1, 1), "=C2+$B$1+C$1+$B2");
  } finally {
    w.destroy();
  }
});
test("inserting rows updates an unmoved formula and cross-sheet references", () => {
  const w = new Workbook();
  try {
    w.set(0, 0, "=B10");
    w.set(9, 1, "7");
    w.mutate(() => w.engine.addSheet("Other"));
    w.mutate(() =>
      w.engine.setCellContents({ sheet: 1, row: 0, col: 0 }, [
        ["=Scratch!B10"],
      ]),
    );
    w.mutate(() => w.engine.addRows(0, [4, 1]));
    assert.equal(w.raw(0, 0), "=B11");
    assert.equal(w.value(0, 0), 7);
    assert.equal(
      w.engine.getCellFormula({ sheet: 1, row: 0, col: 0 }),
      "=Scratch!B11",
    );
    w.undo();
    assert.equal(w.raw(0, 0), "=B10");
  } finally {
    w.destroy();
  }
});
test("spill children are protected, blocked spills recover, snapshots preserve only anchors", () => {
  const w = new Workbook();
  try {
    w.set(0, 0, "=MINVERSE({1,2;3,4})");
    assert.equal(w.isSpill(1, 1), true);
    assert.throws(() => w.set(1, 1, "8"), /array result/);
    const s = w.snapshot();
    assert.equal(s.sheets.Scratch[1]?.[1] ?? null, null);
    const restored = new Workbook(s);
    assert.ok(Math.abs(restored.value(1, 1) + 0.5) < 1e-12);
    restored.destroy();
    w.clear([bounds({ row: 0, col: 0 })]);
    w.set(1, 1, "8");
    w.set(0, 0, "=MINVERSE({1,2;3,4})");
    assert.equal(w.value(0, 0).value, "#SPILL!");
    w.clear([bounds({ row: 1, col: 1 })]);
    assert.ok(Math.abs(w.value(1, 1) + 0.5) < 1e-12);
  } finally {
    w.destroy();
  }
});
test("fill down and paste external numeric text", () => {
  const w = new Workbook();
  try {
    w.paste(0, 0, parseTSV("1\t=A1*2\n2\n3"));
    w.fill({ top: 0, bottom: 2, left: 1, right: 1 }, "down");
    assert.equal(w.value(2, 1), 6);
    assert.equal(w.raw(2, 1), "=A3*2");
    w.undo();
    assert.equal(w.raw(2, 1), "");
  } finally {
    w.destroy();
  }
});
test("cut moves dependencies and undo is atomic", () => {
  const w = new Workbook();
  try {
    w.set(0, 0, "8");
    w.set(0, 1, "=A1");
    w.engine.cut({ start: a(0), end: a(0) });
    w.mutate(() => w.engine.paste(a(2)));
    assert.equal(w.raw(0, 1), "=A3");
    assert.equal(w.value(0, 1), 8);
    assert.equal(w.value(0, 0), null);
    w.undo();
    assert.equal(w.raw(0, 1), "=A1");
    assert.equal(w.value(0, 0), 8);
  } finally {
    w.destroy();
  }
});
test("TSV quotes, trailing rows, bounds and import validation", () => {
  const values = [
    ["a\tb", 'x"y', "line\nbreak"],
    ["1", "2", "3"],
  ];
  assert.deepEqual(parseTSV(toTSV(values)), values);
  assert.deepEqual(parseTSV("1\t2\r\n3\t4\r\n"), [
    ["1", "2"],
    ["3", "4"],
  ]);
  assert.deepEqual(parseAddress("$CZ$2000"), { row: 1999, col: 103 });
  assert.throws(() => parseAddress("DA1"));
  assert.throws(() => validateSave({ version: 1, sheets: { x: [[{}]] } }));
});
test("array formulas survive clear, overwrite, structural deletion and sheet deletion undo", () => {
  for (const operation of [
    (w) => w.clear([bounds({ row: 0, col: 0 })]),
    (w) => w.set(0, 0, "9"),
    (w) => w.mutate(() => w.engine.removeRows(w.active, [0, 1])),
    (w) => w.mutate(() => w.engine.removeRows(w.active, [1, 1])),
    (w) => w.mutate(() => w.engine.removeColumns(w.active, [0, 1])),
    (w) => w.mutate(() => w.engine.removeSheet(w.active)),
  ]) {
    const w = new Workbook();
    try {
      w.mutate(() => w.engine.addSheet("Other"));
      w.set(5, 4, "9");
      w.set(0, 0, "=MINVERSE({1,2;3,4})");
      operation(w);
      w.undo();
      assert.equal(w.raw(0, 0), "=MINVERSE({1,2;3,4})");
      assert.ok(Math.abs(w.value(1, 1) + 0.5) < 1e-12);
      const saved = new Workbook(w.snapshot());
      assert.equal(saved.raw(0, 0), "=MINVERSE({1,2;3,4})");
      saved.destroy();
      w.redo();
      w.undo();
      assert.equal(w.raw(0, 0), "=MINVERSE({1,2;3,4})");
    } finally {
      w.destroy();
    }
  }
});
test("failed operations roll back, cell text limits preserve reloadability, and sheet names round-trip", () => {
  const w = new Workbook();
  try {
    w.set(0, 0, "keep");
    assert.throws(() => w.set(0, 0, "x".repeat(10001)), /10,000/);
    assert.equal(w.raw(0, 0), "keep");
    assert.throws(
      () =>
        w.mutate(() => {
          w.engine.setCellContents(a(0), [["lost"]]);
          throw new Error("fail");
        }),
      /fail/,
    );
    assert.equal(w.raw(0, 0), "keep");
    w.mutate(() => w.engine.renameSheet(0, "__proto__"));
    const save = w.snapshot();
    assert.equal(Object.hasOwn(save.sheets, "__proto__"), true);
    const restored = new Workbook(save);
    assert.equal(restored.raw(0, 0), "keep");
    restored.destroy();
  } finally {
    w.destroy();
  }
});
test("history keeps patches and is bounded", () => {
  const w = new Workbook();
  try {
    for (let i = 0; i < 70; i++) w.set(0, 0, String(i));
    assert.equal(w.undoStack.length, 60);
    assert.equal(
      w.undoStack.reduce((n, e) => n + e.changes.length, 0),
      60,
    );
    w.undo();
    assert.equal(w.value(0, 0), 68);
    w.set(0, 0, "90");
    assert.equal(w.canRedo(), false);
  } finally {
    w.destroy();
  }
});
test("arrays cannot spill beyond the grid, and rejection preserves the workbook", () => {
  const w = new Workbook();
  try {
    w.set(0, 0, "keep");
    assert.throws(() => w.set(1999, 0, "={1;2}"), /beyond the grid/);
    assert.throws(() => w.set(0, 103, "={1,2}"), /beyond the grid/);
    assert.equal(w.raw(0, 0), "keep");
    const restored = new Workbook(w.snapshot());
    restored.destroy();
  } finally {
    w.destroy();
  }
});
test("shifted blocked arrays recover after their obstruction is removed", () => {
  const w = new Workbook();
  try {
    w.set(2, 1, "9");
    w.set(1, 0, "={1,2;3,4}");
    w.mutate(() => w.engine.addRows(0, [0, 1]));
    w.clear([bounds({ row: 3, col: 1 })]);
    assert.equal(w.value(2, 0), 1);
    assert.equal(w.value(3, 1), 4);
  } finally {
    w.destroy();
  }
});
test("cut to the same address is a no-op and array-anchor copy remains live", () => {
  const w = new Workbook();
  try {
    w.set(0, 0, "7");
    w.set(0, 1, "=A1*2");
    const source = { start: a(0), end: a(0) };
    w.engine.cut(source);
    w.mutate(() => w.pasteInternal(a(0), { cut: true, source }));
    w.set(0, 0, "9");
    assert.equal(w.value(0, 1), 18);
    w.paste(2, 0, [
      [1, 2],
      [3, 4],
    ]);
    w.set(2, 3, "=MINVERSE($A$3:$B$4)");
    const src = { start: a(2, 3), end: a(2, 3) };
    w.engine.copy(src);
    const clip = { source: src, arrayFormula: true, revision: w.revision };
    w.mutate(() => w.pasteInternal(a(5, 3), clip));
    assert.equal(w.raw(5, 3), "=MINVERSE($A$3:$B$4)");
    w.set(2, 0, "2");
    assert.ok(Math.abs(w.value(5, 3) - 2) < 1e-12);
  } finally {
    w.destroy();
  }
});
test("oversized workbook inputs are rejected atomically", () => {
  const w = new Workbook();
  try {
    w.set(0, 0, "keep");
    assert.throws(
      () =>
        w.paste(
          0,
          0,
          Array.from({ length: 101 }, () => ["x".repeat(10000)]),
        ),
      /1,000,000/,
    );
    assert.equal(w.raw(0, 0), "keep");
  } finally {
    w.destroy();
  }
});

test("sheet rename cannot expand a formula past the reloadable cell limit", () => {
  const w = new Workbook();
  try {
    w.set(0, 0, "7");
    const formula = "=SUM(" + Array(120).fill("Scratch!A1").join(",") + ")";
    w.set(0, 2, formula);
    const before = w.snapshot();
    assert.throws(
      () => w.mutate(() => w.engine.renameSheet(w.active, "S".repeat(100))),
      /too long/,
    );
    assert.deepEqual(w.snapshot(), before);
    validateSave(w.snapshot());
    const restored = new Workbook(w.snapshot());
    try {
      assert.equal(restored.value(0, 2), 840);
    } finally {
      restored.destroy();
    }
  } finally {
    w.destroy();
  }
});

test("structural edits invalidate copy-time absolute references", () => {
  const w = new Workbook();
  try {
    w.set(0, 0, "1");
    w.set(0, 1, "=$A$1");
    w.engine.copy({ start: a(0, 1), end: a(0, 1) });
    w.structural(() => w.engine.addRows(w.active, [0, 1]));
    assert.equal(w.raw(1, 1), "=$A$2");
    assert.equal(w.engine.isClipboardEmpty(), true);
  } finally {
    w.destroy();
  }
});
test("numeric sheet names keep their order across undo and backup reload", () => {
  const w = new Workbook();
  try {
    w.structural(() => w.engine.addSheet("2024"));
    w.set(0, 0, "1");
    w.undo();
    assert.deepEqual(w.engine.getSheetNames(), ["Scratch", "2024"]);
    const count = w.undoStack.length;
    w.set(0, 0, "");
    assert.equal(w.undoStack.length, count);
    assert.equal(w.canRedo(), true);
    const restored = new Workbook(w.snapshot());
    try {
      assert.deepEqual(restored.engine.getSheetNames(), ["Scratch", "2024"]);
    } finally {
      restored.destroy();
    }
  } finally {
    w.destroy();
  }
});
test("grouped numeric inputs calculate while text and formulas are preserved", () => {
  const w = new Workbook();
  try {
    w.paste(0, 0, parseTSV("1,234\n5\n=SUM(A1:A2)\n=A1*2"));
    assert.equal(w.value(0, 0), 1234);
    assert.equal(w.value(2, 0), 1239);
    assert.equal(w.value(3, 0), 2468);
    w.set(4, 0, "-1,234.50");
    assert.equal(w.value(4, 0), -1234.5);
    w.set(5, 0, "'1,234");
    assert.equal(w.value(5, 0), "1,234");
    w.set(6, 0, "12,34");
    assert.equal(w.value(6, 0), "12,34");
  } finally {
    w.destroy();
  }
});
