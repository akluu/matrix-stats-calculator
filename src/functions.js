import {
  HyperFormula,
  FunctionPlugin,
  FunctionArgumentType as A,
  CellError,
  ErrorType,
  ArraySize,
  SimpleRangeValue,
} from "hyperformula";
import {
  Matrix,
  inverse,
  determinant,
  QrDecomposition,
  SingularValueDecomposition,
} from "ml-matrix";
import jstat from "jstat";

const error = (type, message) => new CellError(ErrorType[type], message);
// Numeric formatting subtypes (percent, date, currency) carry their raw number in val.
const rawData = (range) =>
  range.data.map((row) =>
    row.map((v) =>
      v && !(v instanceof CellError) && typeof v.val === "number" ? v.val : v,
    ),
  );
const numeric = (data) =>
  data.length &&
  data[0].length &&
  data.every(
    (row) =>
      row.length === data[0].length &&
      row.every((v) => typeof v === "number" && Number.isFinite(v)),
  );
const finite = (rows) =>
  rows.every((row) =>
    row.every((v) => typeof v !== "number" || Number.isFinite(v)),
  );
function rangeError(range) {
  for (const row of range.data)
    for (const value of row) if (value instanceof CellError) return value;
  return numeric(rawData(range))
    ? null
    : error("VALUE", "Use a range containing only numbers.");
}

// Centering/scaling and QR avoid squaring the condition number in X'X.
export function regression(yData, xData, intercept = true, stats = false) {
  if (!numeric(yData) || (yData.length > 1 && yData[0].length > 1))
    return error("VALUE", "known_y must be a numeric row or column.");
  const rowY = yData.length === 1;
  const y = yData.flat();
  let x = xData ?? y.map((_, i) => [i + 1]);
  if (xData && rowY) x = new Matrix(xData).transpose().to2DArray();
  if (!numeric(x) || x.length !== y.length)
    return error(
      "VALUE",
      "Each observation must have matching x and y values.",
    );
  const n = y.length,
    p = x[0].length,
    k = p + Number(intercept);
  if (n < k)
    return error("NUM", "Too few observations for the number of coefficients.");
  const means = Array.from({ length: p }, (_, j) =>
    intercept ? x.reduce((s, row) => s + row[j] / n, 0) : 0,
  );
  const scales = means.map((m, j) => Math.hypot(...x.map((row) => row[j] - m)));
  if (scales.some((s) => s === 0 || !Number.isFinite(s)))
    return error(
      "NUM",
      "Predictors are constant or outside the numeric range.",
    );
  const design = new Matrix(
    x.map((row) => [
      ...row.map((v, j) => (v - means[j]) / scales[j]),
      ...(intercept ? [1] : []),
    ]),
  );
  const svd = new SingularValueDecomposition(design, { autoTranspose: true });
  if (svd.rank < k)
    return error(
      "NUM",
      "Predictors are linearly dependent. Remove redundant columns.",
    );
  const qr = new QrDecomposition(design);
  const yMean = intercept ? y.reduce((sum, v) => sum + v / n, 0) : 0;
  const centeredY = y.map((v) => v - yMean);
  const beta = qr.solve(Matrix.columnVector(centeredY)).to1DArray();
  const slopes = beta.slice(0, p).map((b, j) => b / scales[j]);
  const b0 = intercept
    ? yMean + beta[p] - slopes.reduce((s, b, j) => s + b * means[j], 0)
    : 0;
  const coefficients = [...slopes].reverse().concat(b0);
  if (!finite([coefficients]))
    return error("NUM", "Result is outside the numeric range.");
  if (!stats) return [coefficients];
  // Residuals in centered coordinates retain accuracy when x/y have large offsets.
  const residuals = centeredY.map(
    (v, i) => v - design.getRow(i).reduce((s, a, j) => s + a * beta[j], 0),
  );
  const sse = residuals.reduce((s, r) => s + r * r, 0);
  const sst = centeredY.reduce((s, v) => s + v * v, 0);
  const ssr = Math.max(0, sst - sse),
    df = n - k;
  const div0 = () =>
    error("DIV_BY_ZERO", "Statistic is undefined for these data.");
  let se = Array(p).fill(null).map(div0),
    se0 = intercept ? div0() : error("NA", "Intercept fixed at zero.");
  if (df > 0) {
    const invR = inverse(qr.upperTriangularMatrix);
    const sigma = Math.sqrt(sse / df);
    se = scales.map(
      (scale, j) => (sigma * Math.hypot(...invR.getRow(j))) / scale,
    );
    if (intercept) {
      const weights = [...means.map((m, j) => -m / scales[j]), 1];
      const projected = Array.from({ length: k }, (_, col) =>
        weights.reduce((s, w, j) => s + w * invR.get(j, col), 0),
      );
      se0 = sigma * Math.hypot(...projected);
    }
  }
  const rows = [
    coefficients,
    [...se].reverse().concat(se0),
    [sst > 0 ? 1 - sse / sst : div0(), df > 0 ? Math.sqrt(sse / df) : div0()],
    [df > 0 && sse > 0 ? ssr / p / (sse / df) : div0(), df],
    [ssr, sse],
  ];
  for (const row of rows)
    while (row.length < p + 1)
      row.push(error("NA", "No statistic in this position."));
  return finite(rows)
    ? rows
    : error("NUM", "Result is outside the numeric range.");
}

// The statistics argument controls spill size; only literal flags have a stable size.
function literalFlag(ast, fallback) {
  if (!ast || ast.type === "EMPTY") return fallback;
  if (ast.type === "NUMBER" && [0, 1].includes(ast.value))
    return Boolean(ast.value);
  if (
    ast.type === "NAMED_EXPRESSION" &&
    ["TRUE", "FALSE"].includes(ast.expressionName?.toUpperCase())
  )
    return ast.expressionName.toUpperCase() === "TRUE";
  if (
    ast.type === "FUNCTION_CALL" &&
    ["TRUE", "FALSE"].includes(ast.procedureName) &&
    ast.args.length === 0
  )
    return ast.procedureName === "TRUE";
  return null;
}

function betaDistribution(x, alpha, beta, cumulative, low, high) {
  if (low >= high || x < low || x > high)
    return error("NUM", "Require A < B and A ≤ x ≤ B.");
  const z = (x - low) / (high - low);
  let value;
  if (cumulative) {
    value = z === 0 ? 0 : z === 1 ? 1 : jstat.beta.cdf(z, alpha, beta);
  } else if (z > 0 && z < 1) {
    // Log-space evaluation avoids underflow before division by the beta function.
    value = Math.exp(
      (alpha - 1) * Math.log(z) +
        (beta - 1) * Math.log1p(-z) -
        jstat.betaln(alpha, beta) -
        Math.log(high - low),
    );
  } else {
    const density =
      z === 0
        ? alpha === 1
          ? beta
          : alpha > 1
            ? 0
            : Infinity
        : beta === 1
          ? alpha
          : beta > 1
            ? 0
            : Infinity;
    value = density / (high - low);
  }
  return Number.isFinite(value)
    ? value
    : error("NUM", "Density is not finite at this endpoint.");
}

class CalculatorFunctions extends FunctionPlugin {
  integer(ast, state) {
    return this.runFunction(ast.args, state, this.metadata("INT"), Math.floor);
  }

  mmult(ast, state) {
    return this.runFunction(
      ast.args,
      state,
      this.metadata("MMULT"),
      (left, right) => {
        const invalid = rangeError(left) || rangeError(right);
        if (invalid) return invalid;
        if (left.width() !== right.height())
          return error("VALUE", "Inner matrix dimensions must agree.");
        const result = new Matrix(rawData(left))
          .mmul(new Matrix(rawData(right)))
          .to2DArray();
        return finite(result)
          ? SimpleRangeValue.onlyNumbers(result)
          : error("NUM", "Result is outside the numeric range.");
      },
    );
  }
  mmultSize(ast, state) {
    if (ast.args.length !== 2) return ArraySize.error();
    const left = this.arraySizeForAst(ast.args[0], state),
      right = this.arraySizeForAst(ast.args[1], state);
    return new ArraySize(right.width, left.height);
  }
  minverse(ast, state) {
    return this.runFunction(
      ast.args,
      state,
      this.metadata("MINVERSE"),
      (range) => {
        const invalid = rangeError(range);
        if (invalid) return invalid;
        if (range.width() !== range.height())
          return error("VALUE", "Matrix must be square.");
        try {
          const data = rawData(range);
          const scaled = data.map((row) => {
            const scale = Math.max(...row.map(Math.abs));
            return row.map((v) => (scale ? v / scale : 0));
          });
          // Equilibrate both dimensions: a change of units must not look singular.
          for (let col = 0; col < data.length; col++) {
            const scale = Math.max(...scaled.map((row) => Math.abs(row[col])));
            if (scale) for (const row of scaled) row[col] /= scale;
          }
          if (
            new SingularValueDecomposition(new Matrix(scaled)).rank <
            data.length
          )
            return error("NUM", "Matrix is singular at numerical precision.");
          const result = inverse(new Matrix(data)).to2DArray();
          return finite(result)
            ? SimpleRangeValue.onlyNumbers(result)
            : error("NUM", "Matrix cannot be inverted.");
        } catch {
          return error("NUM", "Matrix is singular and cannot be inverted.");
        }
      },
    );
  }
  sameSize(ast, state) {
    if (ast.args.length !== 1) return ArraySize.error();
    const size = this.arraySizeForAst(ast.args[0], state);
    return new ArraySize(size.width, size.height);
  }
  mdeterm(ast, state) {
    return this.runFunction(
      ast.args,
      state,
      this.metadata("MDETERM"),
      (range) => {
        const invalid = rangeError(range);
        if (invalid) return invalid;
        if (range.width() !== range.height())
          return error("VALUE", "Matrix must be square.");
        try {
          const result = determinant(new Matrix(rawData(range)));
          return Number.isFinite(result)
            ? result
            : error("NUM", "Result is outside the numeric range.");
        } catch {
          return error("NUM", "Unable to compute determinant.");
        }
      },
    );
  }
  linest(ast, state) {
    if (literalFlag(ast.args[3], false) === null)
      return error(
        "VALUE",
        "LINEST stats must be literal TRUE, FALSE, 1 or 0.",
      );
    return this.runFunction(
      ast.args,
      state,
      this.metadata("LINEST"),
      (ys, xs, constant, stats) => {
        if (ast.args[1]?.type === "EMPTY") xs = undefined;
        const invalid = rangeError(ys) || (xs ? rangeError(xs) : null);
        if (invalid) return invalid;
        try {
          const result = regression(
            rawData(ys),
            xs ? rawData(xs) : undefined,
            constant,
            stats,
          );
          return result instanceof CellError
            ? result
            : SimpleRangeValue.onlyValues(result);
        } catch {
          return error(
            "NUM",
            "Regression could not be solved. Check data and independent predictors.",
          );
        }
      },
    );
  }
  linestSize(ast, state) {
    if (ast.args.length < 1 || ast.args.length > 4) return ArraySize.error();
    const stats = literalFlag(ast.args[3], false);
    if (stats === null) return ArraySize.scalar();
    const ys = this.arraySizeForAst(ast.args[0], state);
    const xs =
      ast.args[1] && ast.args[1].type !== "EMPTY"
        ? this.arraySizeForAst(ast.args[1], state)
        : null;
    const p = xs ? (ys.height === 1 ? xs.height : xs.width) : 1;
    return new ArraySize(p + 1, stats ? 5 : 1);
  }
  betadist(ast, state) {
    return this.runFunction(
      ast.args,
      state,
      this.metadata("BETA.DIST"),
      betaDistribution,
    );
  }
  betaLegacy(ast, state) {
    return this.runFunction(
      ast.args,
      state,
      this.metadata("BETADIST"),
      (x, alpha, beta, low, high) =>
        betaDistribution(x, alpha, beta, true, low, high),
    );
  }
  tinvrt(ast, state) {
    return this.runFunction(
      ast.args,
      state,
      this.metadata("T.INV.RT"),
      (prob, df) => {
        const value = -jstat.studentt.inv(prob, Math.trunc(df));
        return Number.isFinite(value)
          ? value
          : error("NUM", "Inverse is not finite.");
      },
    );
  }
}
CalculatorFunctions.implementedFunctions = {
  INT: {
    method: "integer",
    parameters: [{ argumentType: A.NUMBER }],
  },
  MMULT: {
    method: "mmult",
    sizeOfResultArrayMethod: "mmultSize",
    parameters: [{ argumentType: A.RANGE }, { argumentType: A.RANGE }],
    vectorizationForbidden: true,
  },
  MINVERSE: {
    method: "minverse",
    sizeOfResultArrayMethod: "sameSize",
    parameters: [{ argumentType: A.RANGE }],
    vectorizationForbidden: true,
  },
  MDETERM: {
    method: "mdeterm",
    parameters: [{ argumentType: A.RANGE }],
    vectorizationForbidden: true,
  },
  LINEST: {
    method: "linest",
    sizeOfResultArrayMethod: "linestSize",
    parameters: [
      { argumentType: A.RANGE },
      { argumentType: A.RANGE, optionalArg: true },
      { argumentType: A.BOOLEAN, defaultValue: true, emptyAsDefault: true },
      { argumentType: A.BOOLEAN, defaultValue: false, emptyAsDefault: true },
    ],
    vectorizationForbidden: true,
  },
  "BETA.DIST": {
    method: "betadist",
    parameters: [
      { argumentType: A.NUMBER },
      { argumentType: A.NUMBER, greaterThan: 0 },
      { argumentType: A.NUMBER, greaterThan: 0 },
      { argumentType: A.BOOLEAN },
      { argumentType: A.NUMBER, defaultValue: 0 },
      { argumentType: A.NUMBER, defaultValue: 1 },
    ],
  },
  BETADIST: {
    method: "betaLegacy",
    parameters: [
      { argumentType: A.NUMBER },
      { argumentType: A.NUMBER, greaterThan: 0 },
      { argumentType: A.NUMBER, greaterThan: 0 },
      { argumentType: A.NUMBER, defaultValue: 0 },
      { argumentType: A.NUMBER, defaultValue: 1 },
    ],
  },
  "T.INV.RT": {
    method: "tinvrt",
    parameters: [
      { argumentType: A.NUMBER, greaterThan: 0, lessThan: 1 },
      { argumentType: A.NUMBER, minValue: 1 },
    ],
  },
};
HyperFormula.registerFunctionPlugin(CalculatorFunctions, {
  enGB: Object.fromEntries(
    Object.keys(CalculatorFunctions.implementedFunctions).map((n) => [n, n]),
  ),
});

export const LIMITS = { rows: 2000, cols: 104 };
export function createEngine(
  sheets = { Scratch: [] },
  sheetOrder = Object.keys(sheets),
) {
  const engine = HyperFormula.buildEmpty({
    licenseKey: "gpl-v3",
    useArrayArithmetic: true,
    maxRows: LIMITS.rows,
    maxColumns: LIMITS.cols,
    precisionRounding: 15,
    smartRounding: false,
    undoLimit: 0,
  });
  engine.addNamedExpression("TRUE", "=TRUE()");
  engine.addNamedExpression("FALSE", "=FALSE()");
  // Plain-object enumeration reorders integer-like sheet names. Add explicitly.
  engine.batch(() => {
    for (const name of sheetOrder) engine.addSheet(name);
    for (const name of sheetOrder)
      engine.setSheetContent(engine.getSheetId(name), sheets[name]);
  });
  engine.clearUndoStack();
  return engine;
}
export const functionNames =
  HyperFormula.getRegisteredFunctionNames("enGB").sort();
