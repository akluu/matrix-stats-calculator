import test from "node:test";
import assert from "node:assert/strict";
import {
  referenceSpan,
  cycleReference,
  functionContext,
  formulaReferences,
} from "../src/formula-editing.js";
import { display } from "../src/ui.js";

test("reference insertion respects operand boundaries and selected ranges", () => {
  assert.deepEqual(referenceSpan("=SUM()", 5, 5), { start: 5, end: 5 });
  assert.deepEqual(referenceSpan("=A1%", 1, 3), { start: 1, end: 3 });
  assert.deepEqual(referenceSpan("=SUM(A1)", 7, 7, { start: 5, end: 7 }), {
    start: 5,
    end: 7,
  });
  for (const [text, caret] of [
    ["=A1", 3],
    ["=A1+B31", 6],
    ['="A1"', 3],
    ['="a""b"', 5],
  ]) {
    assert.equal(referenceSpan(text, caret, caret), null, text);
  }
});
test("F4 cycles all four reference modes without touching strings or names", () => {
  let text = "=A1";
  for (const expected of ["=$A$1", "=A$1", "=$A1", "=A1"]) {
    const edit = cycleReference(text, text.length);
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
    assert.equal(text, expected);
  }
  for (const [text, caret] of [
    ['="A1"', 3],
    ["=ABC123_name", 5],
    ["=LOG10(2)", 4],
  ])
    assert.equal(cycleReference(text, caret), null, text);
});
test("display handles errors, booleans, empty cells and compact numeric precision", () => {
  for (const [value, expected] of [
    [null, ""],
    [undefined, ""],
    [true, "TRUE"],
    [false, "FALSE"],
    [{ value: "#NUM!" }, "#NUM!"],
    [{}, "#ERROR!"],
    [1 / 3, "0.333333333333"],
    [12345678901234, "12345678901234"],
    ["text", "text"],
  ])
    assert.equal(display(value), expected);
});

test("function context follows the caret through nested calls and grouped arguments", () => {
  const cases = [
    ["=MMULT(|", { name: "MMULT", argument: 0 }],
    ["=MMULT(A1:B2,|D1:E2)", { name: "MMULT", argument: 1 }],
    ["=MMULT(TRANSPOSE(A1:B2|),D1:E2)", { name: "TRANSPOSE", argument: 0 }],
    ["=MMULT(TRANSPOSE(A1:B2),|D1:E2)", { name: "MMULT", argument: 1 }],
    ["=SUM({1,2;3,4},|A1)", { name: "SUM", argument: 1 }],
    ["=SUM((A1+B2),|C3)", { name: "SUM", argument: 1 }],
    ['=IF(A1="a,""b",|2,3)', { name: "IF", argument: 1 }],
    ["=SUM('A, B''s'!A1,|C3)", { name: "SUM", argument: 1 }],
    ["=NORM.S.DIST(A1,|TRUE)", { name: "NORM.S.DIST", argument: 1 }],
    ['=IF(A1,"unfinished,|', { name: "IF", argument: 1 }],
    ["=MMULT(A1:B2,D1:E2)|", null],
    ['="SUM(A1,|"', null],
    ["SUM(A1,|", null],
  ];
  for (const [marked, expected] of cases) {
    assert.deepEqual(
      functionContext(marked.replace("|", ""), marked.indexOf("|")),
      expected,
      marked,
    );
  }
});

test("reference highlighting parses bounded local and quoted sheet ranges without strings or names", () => {
  const limits = { rows: 2000, cols: 104 };
  const text = `=MMULT($B$2:A1,'Data, O''Brien'!D4:E5)+Scratch!CZ2000+SUM(A:A,3:2)+"A1"+LOG10(10)+A1_name+1E10+ZZ1+CZ2001`;
  const refs = formulaReferences(text, limits);
  assert.deepEqual(
    refs.map(({ text, sheet, top, bottom, left, right }) => ({
      text,
      sheet,
      top,
      bottom,
      left,
      right,
    })),
    [
      { text: "$B$2:A1", sheet: null, top: 0, bottom: 1, left: 0, right: 1 },
      {
        text: "'Data, O''Brien'!D4:E5",
        sheet: "Data, O'Brien",
        top: 3,
        bottom: 4,
        left: 3,
        right: 4,
      },
      {
        text: "Scratch!CZ2000",
        sheet: "Scratch",
        top: 1999,
        bottom: 1999,
        left: 103,
        right: 103,
      },
      { text: "A:A", sheet: null, top: 0, bottom: 1999, left: 0, right: 0 },
      { text: "3:2", sheet: null, top: 1, bottom: 2, left: 0, right: 103 },
    ],
  );
  for (const ref of refs)
    assert.equal(text.slice(ref.start, ref.end), ref.text);
  assert.deepEqual(
    formulaReferences('="A1""B2"+A3', limits).map((r) => r.text),
    ["A3"],
  );
  assert.deepEqual(
    formulaReferences("='A1, B2'!C3+D4", limits).map((r) => r.text),
    ["'A1, B2'!C3", "D4"],
  );
  assert.deepEqual(formulaReferences("='unfinished A1", limits), []);
  assert.deepEqual(formulaReferences("A1:B2", limits), []);
});

test("reference ranges accept repeated matching sheet qualifiers and reject mixed sheets", () => {
  const limits = { rows: 2000, cols: 104 };
  for (const [formula, expected] of [
    ["=SUM(Scratch!A1:Scratch!B2)", [0, 1, 0, 1]],
    ["=SUM('Data, O''Brien'!B2:'data, o''brien'!A1)", [0, 1, 0, 1]],
    ["=SUM(Scratch!A:Scratch!B)", [0, 1999, 0, 1]],
    ["=SUM(Scratch!1:Scratch!2)", [0, 1, 0, 103]],
  ]) {
    const refs = formulaReferences(formula, limits);
    assert.equal(refs.length, 1, formula);
    assert.deepEqual(
      [refs[0].top, refs[0].bottom, refs[0].left, refs[0].right],
      expected,
      formula,
    );
  }
  for (const formula of [
    "=SUM(Scratch!A1:Other!B2)",
    "=SUM(A1:Other!B2)",
    "=SUM(A1:B)",
    "=SUM(1:B2)",
    "=A1$B2",
  ])
    assert.deepEqual(formulaReferences(formula, limits), [], formula);
});

test("deeply grouped incomplete formulas retain the enclosing function", () => {
  const formula = "=SUM(" + "(".repeat(9900);
  assert.deepEqual(functionContext(formula, formula.length), {
    name: "SUM",
    argument: 0,
  });
});

test("reference hints handle engine string escapes and zero-padded row numbers", () => {
  const limits = { rows: 2000, cols: 104 };
  const formula = String.raw`=IF(TRUE,"\"SUM(A1,B2",C3)`;
  assert.deepEqual(functionContext(formula, formula.length - 1), {
    name: "IF",
    argument: 2,
  });
  assert.deepEqual(
    formulaReferences(formula, limits).map((r) => r.text),
    ["C3"],
  );
  const [cells, rows] = formulaReferences("=SUM(A01:B002,01:02)", limits);
  assert.deepEqual(
    [cells.top, cells.bottom, cells.left, cells.right],
    [0, 1, 0, 1],
  );
  assert.deepEqual(
    [rows.top, rows.bottom, rows.left, rows.right],
    [0, 1, 0, 103],
  );
  assert.deepEqual(
    formulaReferences("=SUM(A0:B2,0:2,A2001:B2002)", limits),
    [],
  );
});
