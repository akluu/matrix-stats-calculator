import { createEngine, LIMITS } from "./functions.js";
export { LIMITS };
export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
const MAX_INPUT_CELLS = 100000;
const MAX_INPUT_CHARACTERS = 1000000;
const normalizeInput = (value) =>
  typeof value === "string" && /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(value)
    ? value.replaceAll(",", "")
    : value;
// Keep the original key so existing installations retain their workbooks.
export const STORAGE_KEY = "mas-i-scratchpad-v1";
export const label = (col) => {
  let s = "";
  for (let n = col + 1; n; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
export const addressLabel = ({ row, col }) => `${label(col)}${row + 1}`;
export function parseAddress(text) {
  const match = /^\$?([A-Z]{1,3})\$?([1-9]\d*)$/i.exec(text.trim());
  if (!match)
    throw new Error("Enter an address such as B4 or a range such as A1:C10.");
  const col =
      [...match[1].toUpperCase()].reduce(
        (n, c) => n * 26 + c.charCodeAt(0) - 64,
        0,
      ) - 1,
    row = Number(match[2]) - 1;
  if (row >= LIMITS.rows || col >= LIMITS.cols)
    throw new Error(
      `Grid limit: ${LIMITS.rows} rows × ${LIMITS.cols} columns.`,
    );
  return { row, col };
}
export function bounds(a, b = a) {
  return {
    top: Math.min(a.row, b.row),
    bottom: Math.max(a.row, b.row),
    left: Math.min(a.col, b.col),
    right: Math.max(a.col, b.col),
  };
}
export function hfRange(sheet, b) {
  return {
    start: { sheet, row: b.top, col: b.left },
    end: { sheet, row: b.bottom, col: b.right },
  };
}
export function validateSave(data) {
  if (
    !data ||
    data.version !== 1 ||
    !data.sheets ||
    typeof data.sheets !== "object" ||
    Array.isArray(data.sheets)
  )
    throw new Error("Not a supported workbook backup.");
  const entries = Object.entries(data.sheets);
  if (!entries.length || entries.length > 30)
    throw new Error("Backups must have 1–30 sheets.");
  if (
    data.sheetOrder !== undefined &&
    (!Array.isArray(data.sheetOrder) ||
      data.sheetOrder.length !== entries.length ||
      new Set(data.sheetOrder).size !== entries.length ||
      data.sheetOrder.some(
        (name) => typeof name !== "string" || !Object.hasOwn(data.sheets, name),
      ))
  )
    throw new Error("Invalid sheet order.");
  let inputCells = 0,
    characters = 0;
  for (const [name, rows] of entries) {
    if (
      !name ||
      name.length > 100 ||
      !Array.isArray(rows) ||
      rows.length > LIMITS.rows
    )
      throw new Error("Invalid sheet name or size.");
    for (const row of rows) {
      if (
        !Array.isArray(row) ||
        row.length > LIMITS.cols ||
        row.some(
          (v) =>
            v !== null &&
            typeof v !== "string" &&
            typeof v !== "boolean" &&
            !(typeof v === "number" && Number.isFinite(v)),
        )
      )
        throw new Error("Invalid cell data.");
      for (const value of row) {
        if (value !== null) inputCells++;
        if (typeof value === "string") characters += value.length;
      }
      if (inputCells > MAX_INPUT_CELLS || characters > MAX_INPUT_CHARACTERS)
        throw new Error(
          "Workbook limit: 100,000 input cells and 1,000,000 text/formula characters.",
        );
      if (row.some((v) => typeof v === "string" && v.length > 10000))
        throw new Error("Cell text is too long.");
    }
  }
  return data;
}
export class Workbook {
  constructor(saved) {
    if (saved) validateSave(saved);
    this.depth = 0;
    this.revision = 0;
    this.undoStack = [];
    this.redoStack = [];
    this.resetEngine(saved?.sheets, saved?.active, saved?.sheetOrder);
    this.state = this.captureInputs();
  }
  resetEngine(sheets, activeName, sheetOrder) {
    const replacement = createEngine(sheets, sheetOrder);
    this.engine?.destroy();
    this.engine = replacement;
    this.blocked = new Map();
    const track = (changes) => {
      for (const { address: a, newValue: v } of changes) {
        if (!a) continue;
        const key = `${a.sheet}:${a.row}:${a.col}`;
        if (v?.type === "SPILL") this.blocked.set(key, a);
        else this.blocked.delete(key);
      }
    };
    replacement.on("valuesUpdated", track);
    for (const name of replacement.getSheetNames()) {
      const sheet = replacement.getSheetId(name),
        formulas = replacement.getSheetFormulas(sheet);
      for (let row = 0; row < formulas.length; row++)
        for (let col = 0; col < formulas[row].length; col++)
          if (formulas[row][col]) {
            const address = { sheet, row, col };
            track([{ address, newValue: replacement.getCellValue(address) }]);
          }
    }
    this.active =
      (typeof activeName === "string"
        ? replacement.getSheetId(activeName)
        : undefined) ?? replacement.getSheetId(replacement.getSheetNames()[0]);
  }
  captureInputs() {
    const state = new Map();
    const blocked = new Map();
    let inputCells = 0,
      characters = 0;
    for (const name of this.engine.getSheetNames()) {
      if (!name || name.length > 100)
        throw new Error("Sheet names must contain 1–100 characters.");
      const sheet = this.engine.getSheetId(name),
        rows = this.engine.getSheetSerialized(sheet),
        cells = new Map();
      if (
        rows.length > LIMITS.rows ||
        rows.some((row) => row.length > LIMITS.cols)
      )
        throw new Error(
          "Array result or data would extend beyond the grid limits.",
        );
      for (let row = 0; row < rows.length; row++)
        for (let col = 0; col < rows[row].length; col++) {
          const value = rows[row][col],
            a = { sheet, row, col };
          // Derived array cells are display values, never independent workbook inputs.
          if (
            value !== null &&
            value !== undefined &&
            this.engine.getCellType(a) !== "ARRAY"
          ) {
            inputCells++;
            if (typeof value === "string") {
              if (value.length > 10000)
                throw new Error("Cell text is too long.");
              characters += value.length;
            }
            if (
              inputCells > MAX_INPUT_CELLS ||
              characters > MAX_INPUT_CHARACTERS
            )
              throw new Error(
                "Workbook limit: 100,000 input cells and 1,000,000 text/formula characters.",
              );
            cells.set(row * LIMITS.cols + col, value);
            if (
              typeof value === "string" &&
              value.startsWith("=") &&
              this.engine.getCellValue(a)?.type === "SPILL"
            )
              blocked.set(`${sheet}:${row}:${col}`, a);
          }
        }
      state.set(name, cells);
    }
    this.blocked = blocked;
    return state;
  }
  sheetsFromState(state = this.state) {
    return Object.fromEntries(
      [...state].map(([name, cells]) => {
        const rows = [];
        for (const [key, value] of cells) {
          const row = Math.floor(key / LIMITS.cols),
            col = key % LIMITS.cols;
          while (rows.length <= row) rows.push([]);
          while (rows[row].length <= col) rows[row].push(null);
          rows[row][col] = value;
        }
        return [name, rows];
      }),
    );
  }
  mutate(fn) {
    if (this.depth) return fn();
    const activeBefore = this.engine.getSheetName(this.active);
    const blocked = [...this.blocked.values()]
      .filter((a) => this.engine.getSheetName(a.sheet) !== undefined)
      .map((a) => [a, this.engine.getCellFormula(a)]);
    this.depth++;
    try {
      const result = fn();
      // Retry only anchors that were obstructed before this command. Clipboard
      // operations must run outside an engine batch (they read evaluated data).
      this.engine.batch(() => {
        for (const [a, f] of blocked)
          if (
            f &&
            this.engine.getSheetName(a.sheet) !== undefined &&
            this.engine.getCellFormula(a) === f
          )
            this.engine.setCellContents(a, [[f]]);
      });
      if (this.engine.getSheetName(this.active) === undefined)
        this.active = this.engine.getSheetId(this.engine.getSheetNames()[0]);
      const next = this.captureInputs(),
        changes = [];
      for (const name of new Set([...this.state.keys(), ...next.keys()])) {
        const before = this.state.get(name) ?? new Map(),
          after = next.get(name) ?? new Map();
        for (const key of new Set([...before.keys(), ...after.keys()])) {
          const oldValue = before.get(key),
            newValue = after.get(key);
          if (!Object.is(oldValue, newValue))
            changes.push([name, key, oldValue, newValue]);
        }
      }
      const beforeNames = [...this.state.keys()],
        afterNames = [...next.keys()];
      if (
        changes.length ||
        JSON.stringify(beforeNames) !== JSON.stringify(afterNames)
      ) {
        this.undoStack.push({
          changes,
          beforeNames,
          afterNames,
          activeBefore,
          activeAfter: this.engine.getSheetName(this.active),
        });
        this.redoStack = [];
        let cells = this.undoStack.reduce((n, h) => n + h.changes.length, 0);
        while (
          this.undoStack.length > 1 &&
          (this.undoStack.length > 60 || cells > 100000)
        )
          cells -= this.undoStack.shift().changes.length;
        this.state = next;
        this.revision++;
      }
      return result;
    } catch (err) {
      // Engine batches are not rollback transactions. Restore original inputs
      // if a paste or structural command failed partway through.
      this.resetEngine(this.sheetsFromState(), activeBefore, [
        ...this.state.keys(),
      ]);
      throw err;
    } finally {
      this.depth--;
    }
  }
  restoreHistory(entry, before) {
    const names = before ? entry.beforeNames : entry.afterNames;
    const restored = new Map(
      names.map((name) => [name, new Map(this.state.get(name) ?? [])]),
    );
    for (const [name, key, oldValue, newValue] of entry.changes) {
      const cells = restored.get(name);
      if (!cells) continue;
      const value = before ? oldValue : newValue;
      if (value === undefined) cells.delete(key);
      else cells.set(key, value);
    }
    // Rebuilding only on undo/redo avoids the engine's array-undo serialization
    // bug. History stores changed inputs, not full workbook copies or results.
    this.resetEngine(
      this.sheetsFromState(restored),
      before ? entry.activeBefore : entry.activeAfter,
      names,
    );
    this.state = restored;
    this.revision++;
  }
  undo() {
    const entry = this.undoStack.at(-1);
    if (!entry) return;
    this.restoreHistory(entry, true);
    this.undoStack.pop();
    this.redoStack.push(entry);
  }
  redo() {
    const entry = this.redoStack.at(-1);
    if (!entry) return;
    this.restoreHistory(entry, false);
    this.redoStack.pop();
    this.undoStack.push(entry);
  }
  canUndo() {
    return this.undoStack.length > 0;
  }
  canRedo() {
    return this.redoStack.length > 0;
  }
  addr(row, col) {
    return { sheet: this.active, row, col };
  }
  value(row, col) {
    return this.engine.getCellValue(this.addr(row, col));
  }
  raw(row, col) {
    return this.engine.getCellSerialized(this.addr(row, col)) ?? "";
  }
  isSpill(row, col) {
    const a = this.addr(row, col);
    return (
      this.engine.isCellPartOfArray(a) &&
      this.engine.getCellFormula(a) === undefined
    );
  }
  set(row, col, value) {
    if (typeof value === "string" && value.length > 10000)
      throw new Error("Cell text is limited to 10,000 characters.");
    if (this.isSpill(row, col))
      throw new Error(
        "This cell is an array result. Edit the formula in the top-left cell.",
      );
    this.mutate(() =>
      this.engine.setCellContents(this.addr(row, col), [
        [value === "" ? null : normalizeInput(value)],
      ]),
    );
  }
  paste(row, col, values) {
    if (!values.length) return;
    if (row + values.length > LIMITS.rows)
      throw new Error("Paste would exceed the grid limits.");
    let width = 0;
    for (const r of values) {
      width = Math.max(width, r.length);
      if (r.some((v) => typeof v === "string" && v.length > 10000))
        throw new Error("Cell text is limited to 10,000 characters.");
    }
    if (col + width > LIMITS.cols)
      throw new Error("Paste would exceed the grid limits.");
    for (let r = 0; r < values.length; r++)
      for (let c = 0; c < width; c++)
        if (this.isSpill(row + r, col + c))
          throw new Error(
            "Paste overlaps an array result. Clear its anchor first.",
          );
    const padded = values.map((r) =>
      Array.from({ length: width }, (_, c) =>
        r[c] === "" || r[c] === undefined ? null : normalizeInput(r[c]),
      ),
    );
    this.mutate(() => this.engine.setCellContents(this.addr(row, col), padded));
  }
  structural(fn) {
    return this.mutate(() => {
      const result = fn();
      // The engine retains COPY hashes with stale absolute references after edits.
      this.engine.clearClipboard();
      return result;
    });
  }
  pasteInternal(target, clipboard) {
    if (
      clipboard.cut &&
      clipboard.source.start.sheet === target.sheet &&
      clipboard.source.start.row === target.row &&
      clipboard.source.start.col === target.col
    ) {
      this.engine.clearClipboard();
      return;
    }
    if (clipboard.arrayFormula) {
      if (clipboard.revision !== this.revision)
        throw new Error("The source changed. Copy the array formula again.");
      const values = this.engine.getFillRangeData(
        clipboard.source,
        { start: target, end: target },
        true,
      );
      this.paste(target.row, target.col, values);
      return;
    }
    this.engine.paste(target);
  }
  clear(ranges) {
    const targets = new Map();
    for (const b of ranges)
      for (let r = b.top; r <= b.bottom; r++)
        for (let c = b.left; c <= b.right; c++) {
          if (this.isSpill(r, c)) continue;
          if (this.raw(r, c) !== "") targets.set(`${r},${c}`, this.addr(r, c));
        }
    if (!targets.size && ranges.some((b) => this.isSpill(b.top, b.left)))
      throw new Error(
        "Select the array’s top-left formula to clear its results.",
      );
    this.mutate(() => {
      this.engine.batch(() => {
        for (const a of targets.values())
          this.engine.setCellContents(a, [[null]]);
      });
    });
  }
  fill(b, direction) {
    const source =
      direction === "down" ? { ...b, bottom: b.top } : { ...b, right: b.left };
    const values = this.engine.getFillRangeData(
      hfRange(this.active, source),
      hfRange(this.active, b),
    );
    this.paste(b.top, b.left, values);
  }
  snapshot(extra = {}) {
    return {
      version: 1,
      sheets: this.sheetsFromState(),
      sheetOrder: [...this.state.keys()],
      active: this.engine.getSheetName(this.active),
      ...extra,
    };
  }
  destroy() {
    this.engine.destroy();
  }
}
// TSV with quoted cells round-trips tab/newline/quote content from Excel.
export function parseTSV(text) {
  const rows = [[]];
  let cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && (quoted || cell === "")) {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (ch === "\t" || ch === "\n" || ch === "\r")) {
      rows.at(-1).push(cell);
      cell = "";
      if (ch !== "\t") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        rows.push([]);
      }
    } else cell += ch;
  }
  rows.at(-1).push(cell);
  if (
    rows.length > 1 &&
    rows.at(-1).length === 1 &&
    rows.at(-1)[0] === "" &&
    /[\r\n]$/.test(text)
  )
    rows.pop();
  return rows;
}
export function toTSV(rows) {
  return rows
    .map((row) =>
      row
        .map((v) => {
          const s = String(v ?? "");
          return /[\t\n\r"]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
        })
        .join("\t"),
    )
    .join("\n");
}
