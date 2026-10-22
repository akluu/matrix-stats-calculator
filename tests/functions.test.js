import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createEngine, functionNames } from "../src/functions.js";
import { catalog } from "../src/catalog.js";
const close = (a, b, tol = 1e-8) =>
  assert.ok(
    typeof a === "number" && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)),
    `${JSON.stringify(a)} != ${b}`,
  );
function evaluate(formula, data = []) {
  const h = createEngine({ Scratch: data });
  try {
    h.setCellContents({ sheet: 0, row: 0, col: 20 }, [[formula]]);
    return h.getCellValue({ sheet: 0, row: 0, col: 20 });
  } finally {
    h.destroy();
  }
}
const expected = [
  ["EXP(1)", Math.E],
  ["LN(EXP(2))", 2],
  ["SQRT(9)", 3],
  ["ABS(-3)", 3],
  ["MOD(-3,2)", 1],
  ["FLOOR.MATH(-2.4)", -3],
  ["CEILING.MATH(-2.4)", -2],
  ["FACT(5)", 120],
  ["COMBIN(5,2)", 10],
  ["GAMMA(0.5)", Math.sqrt(Math.PI)],
  ["SUM(A1:A4)", 10],
  ['SUMIF(A1:A4,">2",B1:B4)', 6],
  ["SUMPRODUCT(A1:A4,B1:B4)", 29],
  ["PRODUCT(A1:A4)", 24],
  ["AVERAGE(A1:A4)", 2.5],
  ["COUNT(A1:A4)", 4],
  ['COUNTIF(A1:A4,">2")', 2],
  ["MIN(A1:A4)", 1],
  ["MAX(A1:A4)", 4],
  ["VAR.S(A1:A4)", 5 / 3],
  ["VAR.P(A1:A4)", 1.25],
  ["STDEV.S(A1:A4)", Math.sqrt(5 / 3)],
  ["STDEV.P(A1:A4)", Math.sqrt(1.25)],
  ["DEVSQ(A1:A4)", 5],
  ["CORREL(A1:A4,B1:B4)", 0.8],
  ["PEARSON(A1:A4,B1:B4)", 0.8],
  ["RSQ(A1:A4,B1:B4)", 0.64],
  ["POISSON.DIST(3,1,FALSE)", Math.exp(-1) / 6],
  ["POISSON.DIST(3,1,TRUE)", (Math.exp(-1) * 8) / 3],
  ["BINOM.DIST(3,5,0.5,FALSE)", 0.3125],
  ["BINOM.DIST(3,5,0.5,TRUE)", 0.8125],
  ["NEGBINOM.DIST(2,3,0.5,FALSE)", 0.1875],
  ["NEGBINOM.DIST(2,3,0.5,TRUE)", 0.5],
  ["EXPON.DIST(2,0.5,FALSE)", 0.5 / Math.E],
  ["EXPON.DIST(2,0.5,TRUE)", 1 - 1 / Math.E],
  ["GAMMA.DIST(2,2,1,FALSE)", 2 * Math.exp(-2)],
  ["GAMMA.DIST(2,2,1,TRUE)", 1 - 3 * Math.exp(-2)],
  ["WEIBULL.DIST(2,2,2,FALSE)", Math.exp(-1)],
  ["WEIBULL.DIST(2,2,2,TRUE)", 1 - Math.exp(-1)],
  ["BETA.DIST(0.5,2,2,FALSE)", 1.5],
  ["BETA.DIST(0.5,2,2,TRUE)", 0.5],
  ["NORM.DIST(0,0,2,FALSE)", 1 / (2 * Math.sqrt(2 * Math.PI))],
  ["NORM.DIST(0,0,2,TRUE)", 0.5],
  ["NORM.S.DIST(0,TRUE)", 0.5],
  ["LOGNORM.DIST(1,0,1,FALSE)", 1 / Math.sqrt(2 * Math.PI)],
  ["LOGNORM.DIST(1,0,1,TRUE)", 0.5],
  ["NORM.S.INV(0.975)", 1.959963984540054],
  ["CHISQ.DIST(2,2,TRUE)", 1 - 1 / Math.E],
  ["CHISQ.DIST.RT(2,2)", 1 / Math.E],
  ["CHISQ.INV(0.95,2)", -2 * Math.log(0.05)],
  ["CHISQ.INV.RT(0.05,2)", -2 * Math.log(0.05)],
  ["CHISQ.TEST({10;20;30},{20;20;20})", Math.exp(-5)],
  ["T.DIST(1,1,TRUE)", 0.75],
  ["T.DIST.2T(1,1)", 0.5],
  ["T.DIST.RT(1,1)", 0.25],
  ["T.INV(0.75,1)", 1],
  ["T.INV.2T(0.5,1)", 1],
  ["T.INV.RT(0.25,1)", 1],
  ["T.TEST(A1:A4,B1:B4,2,1)", 1],
  ["F.TEST(A1:A4,B1:B4)", 1],
  ["F.DIST(1,2,2,TRUE)", 0.5],
  ["F.DIST.RT(1,2,2)", 0.5],
  ["F.INV(0.5,2,2)", 1],
  ["F.INV.RT(0.5,2,2)", 1],
  ["MDETERM({2,-3,1;2,0,-1;1,4,5})", 49],
  ["IF(AND(TRUE,NOT(FALSE)),INDEX(A1:B4,2,2),0)", 3],
  ['SUMIFS(B1:B4,A1:A4,">2")', 6],
  ["VLOOKUP(3,A1:B4,2,FALSE)", 2],
];
const extraCases = [
  ["POWER(2,5)", 32],
  ["LOG(8,2)", 3],
  ["LOG10(100)", 2],
  ["ROUND(1.234,2)", 1.23],
  ["ROUNDUP(-1.231,2)", -1.24],
  ["ROUNDDOWN(-1.239,2)", -1.23],
  ["INT(-1.2)", -2],
  ["INT(1.9)", 1],
  ["INT(-2)", -2],
  ["INT(0)", 0],
  ["PI()", Math.PI],
  ["SIN(PI()/6)", 0.5],
  ["COS(PI()/3)", 0.5],
  ["TAN(PI()/4)", 1],
  ['COUNTA({1,"text",TRUE})', 3],
  ["MEDIAN({1;2;9})", 2],
  ["PERCENTILE.INC({1;2;3;4},0.25)", 1.75],
  ["NORM.INV(0.975,10,2)", 13.919927969080108],
  ["SLOPE(B1:B4,A1:A4)", 0.8],
  ["IF(TRUE,4,9)", 4],
  ["IFERROR(1/0,7)", 7],
  ["AND(TRUE,FALSE)", false],
  ["OR(FALSE,TRUE)", true],
  ["NOT(TRUE)", false],
  ["INDEX(A1:B4,2,2)", 3],
  ["MATCH(3,A1:A4,0)", 3],
  ['COUNTIFS(A1:A4,">1",B1:B4,"<4")', 2],
  ["ROW(B3)", 3],
  ["COLUMN(B3)", 2],
  ["ROWS(A1:B4)", 4],
  ["COLUMNS(A1:B4)", 2],
  ["NORM.S.DIST(0,FALSE)", 1 / Math.sqrt(2 * Math.PI)],
  ["CHISQ.DIST(2,2,FALSE)", 0.5 / Math.E],
  ["T.DIST(1,1,FALSE)", 1 / (2 * Math.PI)],
  ["F.DIST(1,2,2,FALSE)", 0.25],
  ["T.TEST({2;4;6},{1;2;3},2,1)", 1 - Math.sqrt(6 / 7)],
  ["T.TEST({2;4;6},{1;2;3},1,1)", (1 - Math.sqrt(6 / 7)) / 2],
  ["T.TEST({1;3},{4;6},2,2)", 1 - 3 / Math.sqrt(13)],
  ["T.TEST({1;1},{2;4},2,3)", 1 - (2 * Math.atan(2)) / Math.PI],
  ["F.TEST({1;3},{2;6})", (4 * Math.atan(0.5)) / Math.PI],
  ["CHISQ.TEST({10,20;20,10},{15,15;15,15})", 0.009823274507519247],
  ["FLOOR.MATH(-2.4,2,1)", -2],
  ["CEILING.MATH(-2.4,2,1)", -4],
];
const matrixCases = [
  [
    "MMULT({1,2,3;4,5,6},{7,8;9,10;11,12})",
    [
      [58, 64],
      [139, 154],
    ],
  ],
  [
    "MINVERSE({1,2;3,4})",
    [
      [-2, 1],
      [1.5, -0.5],
    ],
  ],
  [
    "TRANSPOSE({1,2,3;4,5,6})",
    [
      [1, 4],
      [2, 5],
      [3, 6],
    ],
  ],
  ["LINEST({1;3;2;4},{1;2;3;4})", [[0.8, 0.5]]],
];
for (const [formula, result] of [...expected, ...extraCases]) {
  test(formula, () => {
    const actual = evaluate("=" + formula, [
      [1, 1],
      [2, 3],
      [3, 2],
      [4, 4],
    ]);
    if (typeof result === "number") close(actual, result, 1e-7);
    else assert.equal(actual, result);
  });
}
for (const [formula, values] of matrixCases) {
  test(formula, () => {
    const h = createEngine({ Scratch: [["=" + formula]] });
    try {
      assert.deepEqual(h.getSheetDimensions(0), {
        height: values.length,
        width: values[0].length,
      });
      values.forEach((row, r) =>
        row.forEach((v, c) =>
          close(h.getCellValue({ sheet: 0, row: r, col: c }), v),
        ),
      );
    } finally {
      h.destroy();
    }
  });
}
test("every required and featured function has a result assertion", () => {
  const required = Object.values(
    JSON.parse(
      readFileSync(new URL("required-functions.json", import.meta.url)),
    ),
  ).flat();
  assert.equal(required.length, 60);
  assert.equal(new Set(required).size, 60);
  const covered = new Set([
    ...[...expected, ...extraCases, ...matrixCases].map(([formula]) =>
      formula.slice(0, formula.indexOf("(")),
    ),
    ...catalog.map(({ example }) => example.slice(1, example.indexOf("("))),
  ]);
  const featured = new Set(catalog.map(({ name }) => name));
  for (const name of required)
    assert.ok(featured.has(name), `Missing from catalog: ${name}`);
  for (const name of new Set([...required, ...featured]))
    assert.ok(covered.has(name), `Missing result test: ${name}`);
});
test("all listed functions are registered", () => {
  for (const f of catalog) assert.ok(functionNames.includes(f.name), f.name);
});
test("matrix inverse, transpose and multiplication spill", () => {
  const h = createEngine({
    Scratch: [
      [0, 1, null, "=MINVERSE(A1:B2)"],
      [1, 0],
      [],
      ["=TRANSPOSE(A1:B2)"],
      [],
      [],
      ["=MMULT(A1:B2,D1:E2)"],
    ],
  });
  try {
    assert.deepEqual(
      h.getRangeValues({
        start: { sheet: 0, row: 0, col: 3 },
        end: { sheet: 0, row: 1, col: 4 },
      }),
      [
        [0, 1],
        [1, 0],
      ],
    );
    assert.deepEqual(
      h.getRangeValues({
        start: { sheet: 0, row: 6, col: 0 },
        end: { sheet: 0, row: 7, col: 1 },
      }),
      [
        [1, 0],
        [0, 1],
      ],
    );
  } finally {
    h.destroy();
  }
});
test("MINVERSE singular and input errors", () => {
  for (const [f, code] of [
    ["MINVERSE({1,2;2,4})", "#NUM!"],
    ["MINVERSE({1,2,3})", "#VALUE!"],
    ['MDETERM({1,"x";3,4})', "#VALUE!"],
    ["MINVERSE({1,2;3,1/0})", "#DIV/0!"],
  ])
    assert.equal(evaluate("=" + f).value, code, f);
});
test("LINEST five-row statistics", () => {
  const h = createEngine({
    Scratch: [
      [1, 1],
      [2, 3],
      [3, 2],
      [4, 4],
      [],
      ["=LINEST(B1:B4,A1:A4,TRUE,TRUE)"],
    ],
  });
  try {
    const expected = [
      [0.8, 0.5],
      [Math.sqrt(0.18), Math.sqrt(1.35)],
      [0.64, Math.sqrt(0.9)],
      [32 / 9, 2],
      [3.2, 1.8],
    ];
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 2; c++)
        close(h.getCellValue({ sheet: 0, row: 5 + r, col: c }), expected[r][c]);
  } finally {
    h.destroy();
  }
});
test("LINEST intercept=false uses uncentered statistics", () => {
  const h = createEngine({
    Scratch: [[1, 1], [2, 2], [3, 4], [], ["=LINEST(B1:B3,A1:A3,FALSE,TRUE)"]],
  });
  try {
    close(h.getCellValue({ sheet: 0, row: 4, col: 0 }), 17 / 14);
    assert.equal(h.getCellValue({ sheet: 0, row: 4, col: 1 }), 0);
    close(h.getCellValue({ sheet: 0, row: 6, col: 0 }), 289 / 294);
    close(h.getCellValue({ sheet: 0, row: 7, col: 0 }), 115.6);
    close(h.getCellValue({ sheet: 0, row: 8, col: 1 }), 5 / 14);
  } finally {
    h.destroy();
  }
});
test("LINEST multiple regression and orientation", () => {
  // Orthogonal predictors and residual vector give exact known coefficients and SSE=4.
  const h = createEngine({
    Scratch: [
      ["=LINEST({-1;1;3;9},{-1,-1;-1,1;1,-1;1,1},TRUE,TRUE)"],
      [],
      [],
      [],
      [],
      [],
      ["=LINEST({-1,1,3,9},{-1,-1,1,1;-1,1,-1,1},TRUE,TRUE)"],
    ],
  });
  try {
    const row = h.getRangeValues({
      start: { sheet: 0, row: 0, col: 0 },
      end: { sheet: 0, row: 0, col: 2 },
    })[0];
    [2, 3, 3].forEach((n, c) => close(row[c], n));
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 3; c++) {
        const a = h.getCellValue({ sheet: 0, row: r, col: c }),
          b = h.getCellValue({ sheet: 0, row: r + 6, col: c });
        if (typeof a === "number") close(a, b);
        else assert.equal(a.value, b.value);
      }
    assert.equal(h.getCellValue({ sheet: 0, row: 2, col: 2 }).value, "#N/A");
    close(h.getCellValue({ sheet: 0, row: 4, col: 1 }), 4);
  } finally {
    h.destroy();
  }
});
test("LINEST defaults, flags, rank and large offsets", () => {
  close(evaluate("=INDEX(LINEST({1;3;2;4}),1,1)"), 0.8);
  close(evaluate("=INDEX(LINEST({1;3;2;4},,TRUE,TRUE),3,1)"), 0.64);
  close(
    evaluate(
      "=INDEX(LINEST({1;3;2;4},{1000001;1000002;1000003;1000004},TRUE,TRUE),1,2)",
    ),
    -799999.5,
  );
  assert.equal(
    evaluate("=LINEST({1;2;3},{1,2;2,4;3,6},TRUE,TRUE)").value,
    "#NUM!",
  );
  assert.equal(
    evaluate("=LINEST({1;2;3},{1;2;3},TRUE,A1)", [[true]]).value,
    "#VALUE!",
  );
});
test("right-tail inverse symmetry and domain", () => {
  close(evaluate("=T.INV.RT(0.05,10)"), 1.8124611228107335, 1e-7);
  close(evaluate("=T.INV.RT(0.95,10)"), -1.8124611228107335, 1e-7);
  close(evaluate("=T.INV.RT(0.05,1.9)"), 6.313751514675, 1e-7);
  for (const f of ["=T.INV.RT(0,10)", "=T.INV.RT(1,10)", "=T.INV.RT(0.1,0)"])
    assert.equal(evaluate(f).value, "#NUM!");
});
test("beta density scales to non-unit bounds and includes endpoints", () => {
  close(evaluate("=BETA.DIST(2,2,2,FALSE,0,4)"), 0.375);
  close(evaluate("=BETA.DIST(2,2,2,TRUE,0,4)"), 0.5);
  close(evaluate("=BETA.DIST(0,2,2,TRUE)"), 0);
  close(evaluate("=BETA.DIST(1,2,2,TRUE)"), 1);
  close(evaluate("=BETA.DIST(0,1,1,FALSE)"), 1);
  assert.equal(evaluate("=BETA.DIST(0.5,2,2,TRUE,2,1)").value, "#NUM!");
});
test("formatted numbers in matrices and regression retain numeric meaning", () => {
  close(evaluate("=MDETERM({10%,20%;30%,40%})"), -0.02);
  close(evaluate("=INDEX(LINEST({10%;20%;40%},{1;2;3},TRUE,TRUE),1,1)"), 0.15);
  close(evaluate("=MMULT({10%,20%},{1;1})"), 0.3);
  close(evaluate("=INDEX(MINVERSE({10%,20%;30%,40%}),1,1)"), -20);
});
test("numerically singular matrix is rejected rather than producing a bogus inverse", () => {
  assert.equal(evaluate("=MINVERSE({1,1,1;2,1,3;3,2,4})").value, "#NUM!");
  close(evaluate("=INDEX(MINVERSE({1,0;0,0.000000000000000001}),2,2)"), 1e18);
});

test("large-shape beta endpoint densities remain finite", () => {
  close(evaluate(`=BETA.DIST(0,1,512,FALSE)`), 512);
  close(evaluate(`=BETA.DIST(4,512,1,FALSE,0,4)`), 128);
  close(evaluate(`=BETA.DIST(2,2,2,FALSE,0,4)`), 0.375);
  close(evaluate(`=BETA.DIST(0,512,1,FALSE)`), 0);
  close(evaluate(`=BETA.DIST(1,1,512,FALSE)`), 0);
  assert.equal(evaluate(`=BETA.DIST(0,0.5,2,FALSE)`).value, "#NUM!");
});
test("inverse rank guard accepts different row and column units", () => {
  close(evaluate("=INDEX(MINVERSE({1,1e-18;1,-1e-18}),1,1)"), 0.5);
  close(evaluate("=INDEX(MINVERSE({1,1e-18;1,-1e-18}),2,1)"), 5e17);
  close(evaluate("=INDEX(MINVERSE({1,1e-18;1,-1e-18}),2,2)"), -5e17);
});

test("legacy BETADIST follows Excel cumulative-only argument order", () => {
  close(evaluate("=BETADIST(0.5,2,2)"), 0.5);
  close(evaluate("=BETADIST(0.5,2,2,0,1)"), 0.5);
  close(evaluate("=BETADIST(0.7,2,2)"), 0.784);
  close(evaluate("=BETADIST(2,2,2,0,4)"), 0.5);
});
test("representable beta tail density does not underflow to zero", () => {
  const expected = 4.141858260907966e-37;
  close(evaluate("=BETA.DIST(0.3,500,500,FALSE)") / expected, 1, 1e-8);
});

test("INT coerces numeric inputs and propagates errors", () => {
  close(evaluate('=INT("-1.2")'), -2);
  close(evaluate("=INT(TRUE)"), 1);
  close(evaluate("=INT(A1)"), 0);
  assert.equal(evaluate('=INT("text")').value, "#VALUE!");
  assert.equal(evaluate("=INT(1/0)").value, "#DIV/0!");
});

for (const item of catalog) {
  test(`guide example: ${item.name}`, () => {
    assert.ok(item.description.length > 40, item.name);
    assert.ok(item.example.startsWith(`=${item.name}(`), item.name);
    const h = createEngine({ Scratch: item.data ?? [] });
    try {
      h.setCellContents({ sheet: 0, row: 0, col: 20 }, [[item.example]]);
      const expected = Array.isArray(item.result)
        ? item.result
        : [[item.result]];
      expected.forEach((row, r) =>
        row.forEach((value, c) => {
          const actual = h.getCellValue({ sheet: 0, row: r, col: 20 + c });
          if (typeof value === "number") close(actual, value, 1e-7);
          else assert.equal(actual, value);
        }),
      );
    } finally {
      h.destroy();
    }
  });
}

test("MMULT preserves a matrix when either operand is the identity", () => {
  const h = createEngine({
    Scratch: [
      [12, 12, null, 1, 0],
      [12, 12, null, 0, 1],
    ],
  });
  try {
    for (const formula of ["=MMULT(A1:B2,D1:E2)", "=MMULT(D1:E2,A1:B2)"]) {
      h.setCellContents({ sheet: 0, row: 4, col: 0 }, [[formula]]);
      assert.deepEqual(
        h.getRangeValues({
          start: { sheet: 0, row: 4, col: 0 },
          end: { sheet: 0, row: 5, col: 1 },
        }),
        [
          [12, 12],
          [12, 12],
        ],
      );
    }
    h.setCellContents({ sheet: 0, row: 0, col: 0 }, [
      [1, 2],
      [3, 4],
    ]);
    assert.deepEqual(
      h.getRangeValues({
        start: { sheet: 0, row: 4, col: 0 },
        end: { sheet: 0, row: 5, col: 1 },
      }),
      [
        [1, 2],
        [3, 4],
      ],
    );
  } finally {
    h.destroy();
  }
});
