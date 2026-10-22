import {
  Workbook,
  STORAGE_KEY,
  MAX_BACKUP_BYTES,
  LIMITS,
  label,
  addressLabel,
  parseAddress,
  bounds,
  hfRange,
  parseTSV,
  toTSV,
  validateSave,
} from "./model.js";
import { functionNames } from "./functions.js";
import { catalog } from "./catalog.js";
import { referenceSpan, cycleReference } from "./formula-editing.js";
import { display, download } from "./ui.js";
import { createFormulaHelp } from "./formula-help.js";

const featuredFunctions = new Set(catalog.map((item) => item.name));
const functionCatalog = [
  ...catalog,
  ...functionNames
    .filter((name) => !featuredFunctions.has(name))
    .map((name) => ({
      name,
      args: "…",
      description: "Additional calculation-engine function.",
      category: "More functions",
    })),
];
const $ = (id) => document.getElementById(id);
const grid = $("grid"),
  body = $("body"),
  head = $("head"),
  formula = $("formula"),
  editor = $("editor");
let book,
  widths = {},
  rowHeight = 26,
  anchor = { row: 0, col: 0 },
  focus = { ...anchor },
  extras = [],
  editing = null,
  drag = null,
  pointerSelecting = false,
  resize = null;
let renderQueued = false,
  selectionQueued = false,
  savingAllowed = true,
  stale = false,
  conflictDraft = null,
  clipboard = null,
  suggestionItems = [],
  suggestionIndex = 0;
let startupError = "";
let savedText = null;
let statsKey = "";
let headerKey = "";
try {
  const text = (savedText = localStorage.getItem(STORAGE_KEY)),
    saved = text ? validateSave(JSON.parse(text)) : null;
  book = new Workbook(saved);
  if (saved?.widths && typeof saved.widths === "object")
    for (const [col, w] of Object.entries(saved.widths))
      if (/^\d+$/.test(col) && +col < LIMITS.cols && Number.isFinite(w))
        widths[col] = Math.min(500, Math.max(60, w));
  if (Number.isFinite(saved?.rowHeight))
    rowHeight = Math.min(80, Math.max(22, saved.rowHeight));
} catch (e) {
  book = new Workbook();
  savingAllowed = false;
  startupError = `Saved data could not be opened: ${e.message}. Existing storage has been preserved. Export any new work before closing.`;
}
const { refresh: refreshFormulaHelp, paint: paintFormulaHelp } =
  createFormulaHelp({
    panel: $("formula-help"),
    grid,
    catalog: functionCatalog,
    limits: LIMITS,
    getState: () => ({
      editing,
      keepSpace: pointerSelecting,
      sheet: book.engine.getSheetName(book.active),
      hidden: stale || !$("function-panel").hidden || $("help-dialog").open,
    }),
  });
const width = (col) => widths[col] ?? 110;
function offsets() {
  const a = [46];
  for (let c = 0; c < LIMITS.cols; c++) a.push(a.at(-1) + width(c));
  return a;
}
let columnOffsets = offsets();
function addr(r = anchor.row, c = anchor.col) {
  return book.addr(r, c);
}
function primary() {
  return bounds(anchor, focus);
}
function ranges() {
  return [...extras, primary()];
}
function message(text = "", bad = false) {
  $("message").textContent = text;
  $("message").classList.toggle("error", bad);
}
function save() {
  if (!savingAllowed) {
    $("save-status").textContent = "Autosave unavailable";
    return;
  }
  try {
    const text = JSON.stringify(book.snapshot({ widths, rowHeight }));
    // Dialogs can postpone the storage event; inspect the current value now.
    if (localStorage.getItem(STORAGE_KEY) !== savedText) {
      pauseStale();
      return;
    }
    localStorage.setItem(STORAGE_KEY, text);
    savedText = text;
    $("save-status").textContent = "Saved locally";
  } catch (e) {
    $("save-status").textContent = "Not saved";
    message(`Autosave failed: ${e.message}. Use Save backup.`, true);
  }
}
function repairActive() {
  if (book.engine.getSheetName(book.active) === undefined)
    book.active = book.engine.getSheetId(book.engine.getSheetNames()[0]);
}
function action(fn, record = true, notice = "") {
  if (editing && !commit()) return false;
  try {
    if (record) book.mutate(fn);
    else fn();
    repairActive();
    render();
    renderTabs();
    message(notice);
    save();
    return true;
  } catch (e) {
    message(e.message, true);
    return false;
  }
}
function scrollToCell(p) {
  const left = columnOffsets[p.col],
    right = columnOffsets[p.col + 1],
    top = (p.row + 1) * rowHeight,
    bottom = top + rowHeight;
  if (left < grid.scrollLeft + 46) grid.scrollLeft = Math.max(0, left - 46);
  else if (right > grid.scrollLeft + grid.clientWidth)
    grid.scrollLeft = right - grid.clientWidth;
  if (top < grid.scrollTop + rowHeight)
    grid.scrollTop = Math.max(0, top - rowHeight);
  else if (bottom > grid.scrollTop + grid.clientHeight)
    grid.scrollTop = bottom - grid.clientHeight;
}
function select(p, extend = false, add = false) {
  p = {
    row: Math.min(LIMITS.rows - 1, Math.max(0, p.row)),
    col: Math.min(LIMITS.cols - 1, Math.max(0, p.col)),
  };
  if (add) extras.push(primary());
  else if (!extend) extras = [];
  if (!extend) anchor = { ...p };
  focus = { ...p };
  scrollToCell(focus);
  paintSelection();
}
function paintSelection() {
  refreshFormulaHelp();
  const rs = ranges();
  for (const td of body.querySelectorAll("td[data-row]")) {
    const r = +td.dataset.row,
      c = +td.dataset.col;
    td.classList.toggle(
      "selected",
      rs.some(
        (b) => r >= b.top && r <= b.bottom && c >= b.left && c <= b.right,
      ),
    );
    td.classList.toggle("active", r === anchor.row && c === anchor.col);
    td.setAttribute("aria-selected", String(td.classList.contains("selected")));
  }
  const b = primary();
  if (document.activeElement !== $("address"))
    $("address").value =
      b.top === b.bottom && b.left === b.right
        ? addressLabel(anchor)
        : `${addressLabel({ row: b.top, col: b.left })}:${addressLabel({ row: b.bottom, col: b.right })}`;
  if (!editing) formula.value = String(book.raw(anchor.row, anchor.col));
  const nextStatsKey = JSON.stringify([
    book.active,
    book.revision,
    anchor,
    focus,
    extras,
  ]);
  if (statsKey !== nextStatsKey && !selectionQueued) {
    selectionQueued = true;
    requestAnimationFrame(() => {
      selectionQueued = false;
      statsKey = JSON.stringify([
        book.active,
        book.revision,
        anchor,
        focus,
        extras,
      ]);
      selectionStats();
    });
  }
}
function selectionStats() {
  const { height, width: w } = book.engine.getSheetDimensions(book.active);
  let sum = 0,
    count = 0,
    numericCount = 0,
    compensation = 0;
  const seen = extras.length ? new Set() : null;
  for (const b of ranges())
    for (let r = b.top; r <= Math.min(b.bottom, height - 1); r++)
      for (let c = b.left; c <= Math.min(b.right, w - 1); c++) {
        if (seen) {
          const key = r * LIMITS.cols + c;
          if (seen.has(key)) continue;
          seen.add(key);
        }
        const v = book.value(r, c);
        if (v !== null && v !== undefined && v !== "") count++;
        if (typeof v === "number") {
          numericCount++;
          const y = v - compensation,
            t = sum + y;
          compensation = t - sum - y;
          sum = t;
        }
      }
  $("selection-stats").textContent =
    `Count ${count}    Sum ${display(sum)}${numericCount ? `    Average ${display(sum / numericCount)}` : ""}`;
}
function render() {
  grid.querySelector("table").style.width = `${columnOffsets[LIMITS.cols]}px`;
  document.documentElement.style.setProperty("--row-height", `${rowHeight}px`);
  $("row-height").value = rowHeight;
  const startRow = Math.max(0, Math.floor(grid.scrollTop / rowHeight) - 2),
    endRow = Math.min(
      LIMITS.rows,
      startRow + Math.ceil(grid.clientHeight / rowHeight) + 5,
    );
  let startCol = 0;
  while (
    startCol < LIMITS.cols - 1 &&
    columnOffsets[startCol + 1] < grid.scrollLeft + 46
  )
    startCol++;
  startCol = Math.max(0, startCol - 1);
  let endCol = startCol;
  while (
    endCol < LIMITS.cols &&
    columnOffsets[endCol] < grid.scrollLeft + grid.clientWidth + 150
  )
    endCol++;
  const leftSpace = columnOffsets[startCol] - 46,
    rightSpace = columnOffsets[LIMITS.cols] - columnOffsets[endCol];
  const nextHeaderKey = JSON.stringify([startCol, endCol, columnOffsets]);
  if (headerKey !== nextHeaderKey) {
    headerKey = nextHeaderKey;
    const cols = document.createDocumentFragment();
    const addCol = (w) => {
      const col = document.createElement("col");
      col.style.width = `${w}px`;
      cols.append(col);
    };
    addCol(46);
    if (leftSpace) addCol(leftSpace);
    for (let c = startCol; c < endCol; c++) addCol(width(c));
    if (rightSpace) addCol(rightSpace);
    $("columns").replaceChildren(cols);
    const tr = document.createElement("tr");
    const corner = document.createElement("th");
    corner.className = "corner";
    corner.dataset.kind = "all";
    corner.title = "Select all";
    corner.textContent = "";
    tr.append(corner);
    if (leftSpace) {
      const th = document.createElement("th");
      th.className = "spacer";
      tr.append(th);
    }
    for (let c = startCol; c < endCol; c++) {
      const th = document.createElement("th");
      th.textContent = label(c);
      th.dataset.col = c;
      th.dataset.kind = "column";
      th.scope = "col";
      const handle = document.createElement("span");
      handle.className = "resize-handle";
      handle.dataset.resize = c;
      handle.title = "Drag to resize column";
      th.append(handle);
      tr.append(th);
    }
    if (rightSpace) {
      const th = document.createElement("th");
      th.className = "spacer";
      tr.append(th);
    }
    head.replaceChildren(tr);
  }
  const fragment = document.createDocumentFragment();
  const span =
    1 + (leftSpace ? 1 : 0) + (endCol - startCol) + (rightSpace ? 1 : 0);
  const spacer = (h) => {
    if (!h) return;
    const tr = document.createElement("tr"),
      td = document.createElement("td");
    td.colSpan = span;
    td.className = "spacer";
    td.style.height = `${h}px`;
    td.style.maxHeight = `${h}px`;
    tr.append(td);
    fragment.append(tr);
  };
  spacer(startRow * rowHeight);
  for (let r = startRow; r < endRow; r++) {
    const tr = document.createElement("tr");
    tr.setAttribute("aria-rowindex", r + 1);
    const th = document.createElement("th");
    th.className = "row-header";
    th.textContent = r + 1;
    th.dataset.row = r;
    th.dataset.kind = "row";
    th.scope = "row";
    tr.append(th);
    if (leftSpace) {
      const td = document.createElement("td");
      td.className = "spacer";
      tr.append(td);
    }
    for (let c = startCol; c < endCol; c++) {
      const td = document.createElement("td"),
        v = book.value(r, c);
      td.dataset.row = r;
      td.dataset.col = c;
      td.setAttribute("role", "gridcell");
      td.setAttribute("aria-label", `${label(c)}${r + 1}`);
      td.setAttribute("aria-colindex", c + 1);
      td.textContent = display(v);
      if (typeof v === "number") td.classList.add("numeric");
      if (v && typeof v === "object") {
        td.classList.add("error");
        td.title = `${v.value} ${v.message ?? ""}`;
      } else if (book.isSpill(r, c)) {
        td.classList.add("spill");
        td.title = "Array result — edit the top-left formula";
      } else td.title = String(book.raw(r, c));
      tr.append(td);
    }
    if (rightSpace) {
      const td = document.createElement("td");
      td.className = "spacer";
      tr.append(td);
    }
    fragment.append(tr);
  }
  spacer((LIMITS.rows - endRow) * rowHeight);
  body.replaceChildren(fragment);
  paintSelection();
  paintFormulaHelp();
  positionEditor();
  if (editing && !$("suggestions").hidden) paintSuggestions();
  $("undo").disabled = !book.canUndo();
  $("redo").disabled = !book.canRedo();
}
function scheduleRender() {
  if (!renderQueued) {
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }
}
grid.addEventListener("scroll", scheduleRender, { passive: true });
new ResizeObserver(scheduleRender).observe(grid);
function pointAt(e) {
  const rect = grid.getBoundingClientRect(),
    x = e.clientX - rect.left + grid.scrollLeft,
    y = e.clientY - rect.top + grid.scrollTop;
  let c = 0;
  while (c < LIMITS.cols - 1 && columnOffsets[c + 1] <= x) c++;
  return {
    row: Math.min(LIMITS.rows - 1, Math.max(0, Math.floor(y / rowHeight) - 1)),
    col: c,
  };
}
function pointerPoint(e) {
  const cell = e.target.closest("[data-row][data-col]");
  return cell ? { row: +cell.dataset.row, col: +cell.dataset.col } : pointAt(e);
}
grid.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const handle = e.target.closest("[data-resize]");
  if (handle) {
    e.preventDefault();
    resize = {
      col: +handle.dataset.resize,
      x: e.clientX,
      width: width(+handle.dataset.resize),
    };
    return;
  }
  const th = e.target.closest("th"),
    td = e.target.closest("td[data-row]");
  if (!th && !td) return;
  e.preventDefault();
  if (
    editing &&
    editing.input.value.startsWith("=") &&
    td &&
    referenceSpan(
      editing.input.value,
      editing.input.selectionStart,
      editing.input.selectionEnd,
      editing.ref,
    )
  ) {
    drag = { reference: true, start: pointerPoint(e), end: pointerPoint(e) };
    insertReference(drag.start, drag.end, true);
    return;
  }
  pointerSelecting = true;
  if (editing && !commit()) {
    pointerSelecting = false;
    return;
  }
  grid.focus({ preventScroll: true });
  const add = e.ctrlKey || e.metaKey;
  if (th?.dataset.kind === "all") {
    anchor = { row: 0, col: 0 };
    focus = { row: LIMITS.rows - 1, col: LIMITS.cols - 1 };
    extras = [];
    paintSelection();
    return;
  }
  if (th?.dataset.kind === "row") {
    const r = +th.dataset.row;
    if (add) extras.push(primary());
    else if (!e.shiftKey) extras = [];
    if (!e.shiftKey) anchor = { row: r, col: 0 };
    anchor.col = 0;
    focus = { row: r, col: LIMITS.cols - 1 };
    drag = { kind: "row" };
    paintSelection();
  } else if (th?.dataset.kind === "column") {
    const c = +th.dataset.col;
    if (add) extras.push(primary());
    else if (!e.shiftKey) extras = [];
    if (!e.shiftKey) anchor = { row: 0, col: c };
    anchor.row = 0;
    focus = { row: LIMITS.rows - 1, col: c };
    drag = { kind: "column" };
    paintSelection();
  } else if (td) {
    select(pointerPoint(e), e.shiftKey, add);
    drag = { kind: "cells" };
  }
});
document.addEventListener("pointermove", (e) => {
  if (resize) {
    widths[resize.col] = Math.min(
      500,
      Math.max(60, resize.width + e.clientX - resize.x),
    );
    columnOffsets = offsets();
    scheduleRender();
    return;
  }
  if (!drag) return;
  const rect = grid.getBoundingClientRect();
  if (e.clientY > rect.bottom - 12) grid.scrollTop += rowHeight;
  else if (e.clientY < rect.top + rowHeight) grid.scrollTop -= rowHeight;
  if (e.clientX > rect.right - 12) grid.scrollLeft += 30;
  else if (e.clientX < rect.left + 46) grid.scrollLeft -= 30;
  const p = pointAt(e);
  if (drag.reference) {
    drag.end = p;
    insertReference(drag.start, p, false);
    return;
  }
  focus =
    drag.kind === "row"
      ? { row: p.row, col: LIMITS.cols - 1 }
      : drag.kind === "column"
        ? { row: LIMITS.rows - 1, col: p.col }
        : p;
  paintSelection();
});
document.addEventListener("pointerup", () => {
  pointerSelecting = false;
  refreshFormulaHelp();
  if (resize) {
    resize = null;
    save();
  }
  drag = null;
});
grid.addEventListener("dblclick", (e) => {
  if (editing) return;
  const td = e.target.closest("td[data-row]");
  if (td) beginEdit(String(book.raw(anchor.row, anchor.col)), editor);
});
function beginEdit(text, input = editor) {
  if (book.isSpill(anchor.row, anchor.col)) {
    message("Array result: edit its top-left formula.", true);
    return;
  }
  scrollToCell(anchor);
  render();
  editing = { row: anchor.row, col: anchor.col, input, ref: null };
  input.value = text;
  formula.value = text;
  editor.value = text;
  editor.hidden = input !== editor;
  positionEditor();
  input.focus();
  input.setSelectionRange(text.length, text.length);
  message();
  updateSuggestions();
}
function positionEditor() {
  if (!editing || editing.input !== editor) return;
  const td = body.querySelector(
    `td[data-row="${editing.row}"][data-col="${editing.col}"]`,
  );
  const rect = td?.getBoundingClientRect();
  const viewport = grid.getBoundingClientRect();
  if (
    !rect ||
    rect.bottom > viewport.bottom ||
    rect.top < viewport.top + rowHeight ||
    rect.right < viewport.left + 46 ||
    rect.left > viewport.right
  ) {
    const start = editor.selectionStart,
      end = editor.selectionEnd,
      direction = editor.selectionDirection;
    formula.value = editor.value;
    editing.input = formula;
    editor.hidden = true;
    formula.focus({ preventScroll: true });
    formula.setSelectionRange(start, end, direction);
    return;
  }
  editor.hidden = false;
  Object.assign(editor.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${Math.max(110, rect.width)}px`,
    height: `${rect.height}px`,
  });
}
function commit() {
  if (!editing) return true;
  const { row, col, input } = editing;
  try {
    book.set(row, col, input.value);
    editing = null;
    editor.hidden = true;
    $("suggestions").hidden = true;
    render();
    save();
    return true;
  } catch (e) {
    message(e.message, true);
    return false;
  }
}
function cancelEdit() {
  refreshFormulaHelp();
  editing = null;
  editor.hidden = true;
  $("suggestions").hidden = true;
  formula.value = String(book.raw(anchor.row, anchor.col));
  grid.focus();
}
function insertReference(a, b, first) {
  if (!editing) return;
  const input = editing.input;
  if (first)
    editing.ref = referenceSpan(
      input.value,
      input.selectionStart,
      input.selectionEnd,
      editing.ref,
    );
  if (!editing.ref) return;
  const range = bounds(a, b),
    ref =
      range.top === range.bottom && range.left === range.right
        ? addressLabel(a)
        : `${addressLabel({ row: range.top, col: range.left })}:${addressLabel({ row: range.bottom, col: range.right })}`;
  const { start, end } = editing.ref;
  input.value = input.value.slice(0, start) + ref + input.value.slice(end);
  editing.ref.end = start + ref.length;
  input.focus();
  input.setSelectionRange(editing.ref.end, editing.ref.end);
  formula.value = input.value;
  editor.value = input.value;
  $("suggestions").hidden = true;
  refreshFormulaHelp();
}
formula.addEventListener("focus", () => {
  refreshFormulaHelp();
  if (!editing) {
    if (book.isSpill(anchor.row, anchor.col)) return;
    editing = { row: anchor.row, col: anchor.col, input: formula, ref: null };
  } else {
    formula.value = editing.input.value;
    editing.input = formula;
    editor.hidden = true;
  }
});
document.addEventListener("selectionchange", () => {
  if (editing && document.activeElement === editing.input) refreshFormulaHelp();
});
for (const input of [formula, editor]) {
  for (const event of ["click", "keyup", "select"])
    input.addEventListener(event, refreshFormulaHelp);
  input.addEventListener("input", () => {
    if (!editing) {
      if (book.isSpill(anchor.row, anchor.col)) {
        message("Array result: edit the top-left formula.", true);
        input.value = String(book.raw(anchor.row, anchor.col));
        return;
      }
      scrollToCell(anchor);
      render();
      editing = { row: anchor.row, col: anchor.col, input, ref: null };
    }
    editing.input = input;
    editing.ref = null;
    if (input === editor) formula.value = input.value;
    else editor.value = input.value;
    updateSuggestions();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
      return;
    }
    if (e.key === "F4") {
      e.preventDefault();
      const replacement = cycleReference(input.value, input.selectionStart);
      if (replacement) {
        input.setRangeText(
          replacement.text,
          replacement.start,
          replacement.end,
          "end",
        );
        formula.value = input.value;
        editor.value = input.value;
        refreshFormulaHelp();
      }
      return;
    }
    if (
      !$("suggestions").hidden &&
      ["ArrowDown", "ArrowUp", "Tab"].includes(e.key)
    ) {
      e.preventDefault();
      if (e.key === "Tab") {
        chooseSuggestion(suggestionItems[suggestionIndex]);
        return;
      }
      suggestionIndex =
        (suggestionIndex +
          (e.key === "ArrowDown" ? 1 : -1) +
          suggestionItems.length) %
        suggestionItems.length;
      paintSuggestions();
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const p = { ...anchor };
      if (commit()) {
        select({
          row: p.row + (e.key === "Enter" ? (e.shiftKey ? -1 : 1) : 0),
          col: p.col + (e.key === "Tab" ? (e.shiftKey ? -1 : 1) : 0),
        });
        grid.focus();
      }
    }
  });
}
function updateSuggestions() {
  refreshFormulaHelp();
  const input = editing?.input;
  if (!input || !input.value.startsWith("=")) {
    $("suggestions").hidden = true;
    return;
  }
  const before = input.value.slice(0, input.selectionStart),
    m = /([A-Z][A-Z0-9.]*)$/i.exec(before);
  if (!m || (before.match(/"/g) || []).length % 2) {
    $("suggestions").hidden = true;
    return;
  }
  suggestionItems = functionNames
    .filter((n) => n.startsWith(m[1].toUpperCase()))
    .slice(0, 12);
  suggestionIndex = 0;
  paintSuggestions();
}
function paintSuggestions() {
  const box = $("suggestions");
  box.replaceChildren();
  if (!suggestionItems.length) {
    box.hidden = true;
    return;
  }
  const rect = editing.input.getBoundingClientRect();
  Object.assign(box.style, {
    left: `${Math.min(rect.left, window.innerWidth - 260)}px`,
    top: `${rect.bottom}px`,
  });
  for (const [i, name] of suggestionItems.entries()) {
    const b = document.createElement("button");
    b.textContent = name;
    b.classList.toggle("chosen", i === suggestionIndex);
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      chooseSuggestion(name);
    });
    box.append(b);
  }
  box.hidden = false;
}
function chooseSuggestion(name) {
  if (!editing) return;
  const input = editing.input,
    caret = input.selectionStart,
    before = input.value.slice(0, caret),
    m = /[A-Z][A-Z0-9.]*$/i.exec(before);
  if (m) {
    input.setRangeText(`${name}(`, caret - m[0].length, caret, "end");
    formula.value = input.value;
    editor.value = input.value;
  }
  $("suggestions").hidden = true;
  input.focus();
  refreshFormulaHelp();
}
function jump(p, dr, dc) {
  const occupied = (q) => book.value(q.row, q.col) !== null;
  let q = { ...p };
  const limit = dr ? LIMITS.rows : LIMITS.cols,
    key = dr ? "row" : "col",
    step = dr || dc;
  if (q[key] + step < 0 || q[key] + step >= limit) return q;
  const next = { ...q, [key]: q[key] + step };
  if (occupied(q) && occupied(next)) {
    q = next;
    while (
      q[key] + step >= 0 &&
      q[key] + step < limit &&
      occupied({ ...q, [key]: q[key] + step })
    )
      q[key] += step;
  } else {
    q = next;
    while (q[key] + step >= 0 && q[key] + step < limit && !occupied(q))
      q[key] += step;
  }
  return q;
}
grid.addEventListener("keydown", (e) => {
  if (editing) return;
  const mod = e.ctrlKey || e.metaKey,
    key = e.key.toLowerCase();
  if (mod && ["c", "v", "x"].includes(key)) return;
  if (mod && key === "z") {
    e.preventDefault();
    action(() => (e.shiftKey ? book.redo() : book.undo()), false);
    return;
  }
  if (mod && key === "y") {
    e.preventDefault();
    action(() => book.redo(), false);
    return;
  }
  if (mod && (key === "d" || key === "r")) {
    e.preventDefault();
    action(() => book.fill(primary(), key === "d" ? "down" : "right"));
    return;
  }
  if (mod && key === "a") {
    e.preventDefault();
    anchor = { row: 0, col: 0 };
    focus = { row: LIMITS.rows - 1, col: LIMITS.cols - 1 };
    extras = [];
    paintSelection();
    return;
  }
  if (e.code === "Space" && (e.ctrlKey || e.shiftKey)) {
    e.preventDefault();
    extras = [];
    if (e.ctrlKey) {
      anchor.row = 0;
      focus = { row: LIMITS.rows - 1, col: anchor.col };
    } else {
      anchor.col = 0;
      focus = { row: anchor.row, col: LIMITS.cols - 1 };
    }
    paintSelection();
    return;
  }
  if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    action(() => book.clear(ranges()), false);
    return;
  }
  if (e.key === "F2") {
    e.preventDefault();
    beginEdit(String(book.raw(anchor.row, anchor.col)));
    return;
  }
  if (e.key === "Escape") {
    extras = [];
    focus = { ...anchor };
    paintSelection();
    return;
  }
  let dr = 0,
    dc = 0;
  if (e.key === "ArrowUp") dr = -1;
  if (e.key === "ArrowDown") dr = 1;
  if (e.key === "ArrowLeft") dc = -1;
  if (e.key === "ArrowRight") dc = 1;
  if (e.key === "Tab") dc = e.shiftKey ? -1 : 1;
  if (e.key === "Enter") dr = e.shiftKey ? -1 : 1;
  if (dr || dc) {
    e.preventDefault();
    const p = e.shiftKey && e.key.startsWith("Arrow") ? focus : anchor;
    select(
      mod ? jump(p, dr, dc) : { row: p.row + dr, col: p.col + dc },
      e.shiftKey && e.key.startsWith("Arrow"),
    );
    return;
  }
  if (e.key === "Home" || e.key === "End") {
    e.preventDefault();
    const d = book.engine.getSheetDimensions(book.active);
    select(
      e.key === "Home"
        ? { row: mod ? 0 : anchor.row, col: 0 }
        : {
            row: mod ? Math.max(0, d.height - 1) : anchor.row,
            col: Math.max(0, d.width - 1),
          },
      e.shiftKey,
    );
    return;
  }
  if (e.key === "PageDown" || e.key === "PageUp") {
    e.preventDefault();
    select(
      {
        row:
          focus.row +
          (e.key === "PageDown" ? 1 : -1) *
            Math.max(1, Math.floor(grid.clientHeight / rowHeight) - 2),
        col: focus.col,
      },
      e.shiftKey,
    );
    return;
  }
  if (e.key.length === 1 && !mod && !e.altKey) {
    e.preventDefault();
    beginEdit(e.key);
  }
});
const mime = "application/x-matrix-stats-calculator";
for (const kind of ["copy", "cut"])
  grid.addEventListener(kind, (e) => {
    if (editing) return;
    e.preventDefault();
    if (extras.length) {
      message("Copy one contiguous range at a time.", true);
      return;
    }
    try {
      const b = primary(),
        range = hfRange(book.active, b),
        values =
          kind === "cut" ? book.engine.cut(range) : book.engine.copy(range);
      const token = crypto.randomUUID();
      clipboard = {
        token,
        source: range,
        revision: book.revision,
        arrayFormula:
          kind === "copy" &&
          b.top === b.bottom &&
          b.left === b.right &&
          book.engine.isCellPartOfArray(range.start) &&
          book.engine.getCellFormula(range.start) !== undefined,
        rows: b.bottom - b.top + 1,
        cols: b.right - b.left + 1,
        cut: kind === "cut",
      };
      e.clipboardData.setData(
        "text/plain",
        toTSV(
          values.map((r) =>
            r.map((v) => (typeof v === "number" ? String(v) : display(v))),
          ),
        ),
      );
      e.clipboardData.setData(mime, token);
      const containsArray = values.some((row, r) =>
        row.some((_, c) =>
          book.engine.isCellPartOfArray(addr(b.top + r, b.left + c)),
        ),
      );
      message(
        kind === "cut"
          ? "Cut selected. Paste to move cells."
          : containsArray && !clipboard.arrayFormula
            ? "Copied array results as values. To copy a live formula, select only its top-left cell."
            : "Copied.",
      );
    } catch (err) {
      message(err.message, true);
    }
  });
grid.addEventListener("paste", (e) => {
  if (editing) return;
  e.preventDefault();
  if (extras.length) {
    message("Paste into one contiguous range.", true);
    return;
  }
  const token = e.clipboardData.getData(mime),
    text = e.clipboardData.getData("text/plain");
  if (!e.clipboardData.types.includes("text/plain") && !token) {
    message("Clipboard has no spreadsheet text to paste.", true);
    return;
  }
  try {
    const b = primary();
    if (clipboard && token === clipboard.token) {
      if (book.engine.isClipboardEmpty())
        throw new Error(
          "Clipboard was invalidated by undo or a workbook change. Copy the cells again.",
        );
      if (clipboard.arrayFormula && clipboard.revision !== book.revision)
        throw new Error("The source changed. Copy the array formula again.");
      if (
        b.top + clipboard.rows > LIMITS.rows ||
        b.left + clipboard.cols > LIMITS.cols
      )
        throw new Error("Paste would exceed the grid limits.");
      const target = addr(b.top, b.left);
      const sameCut =
        clipboard.cut &&
        clipboard.source.start.sheet === target.sheet &&
        clipboard.source.start.row === target.row &&
        clipboard.source.start.col === target.col;
      if (!sameCut) {
        for (let r = 0; r < clipboard.rows; r++)
          for (let c = 0; c < clipboard.cols; c++) {
            const destination = addr(b.top + r, b.left + c);
            const blocked = clipboard.arrayFormula
              ? book.isSpill(destination.row, destination.col)
              : book.engine.isCellPartOfArray(destination);
            if (blocked)
              throw new Error(
                "Paste overlaps an array result. Clear its anchor first.",
              );
          }
        if (
          clipboard.cut &&
          !book.engine.isItPossibleToMoveCells(clipboard.source, target)
        )
          throw new Error(
            "These cells cannot be moved here. Check for array results.",
          );
      }
      action(() => {
        book.pasteInternal(target, clipboard);
        if (clipboard.cut) clipboard = null;
      });
    } else {
      if (text.length > 2_000_000)
        throw new Error("Paste is too large for this scratchpad.");
      const values = parseTSV(text);
      // paste() validates before its own transaction; validation must not rebuild.
      action(() => book.paste(b.top, b.left, values), false);
    }
  } catch (err) {
    message(err.message, true);
  }
});
$("address").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  try {
    if (editing && !commit()) return;
    const parts = e.target.value.split(":");
    if (parts.length > 2) throw new Error("Use A1 or A1:C10.");
    const nextAnchor = parseAddress(parts[0]);
    const nextFocus = parseAddress(parts[1] ?? parts[0]);
    anchor = nextAnchor;
    focus = nextFocus;
    extras = [];
    scrollToCell(anchor);
    render();
    grid.focus();
  } catch (err) {
    message(err.message, true);
  }
});
$("apply").onclick = () => {
  if (commit()) grid.focus();
};
$("undo").onclick = () => action(() => book.undo(), false);
$("redo").onclick = () => action(() => book.redo(), false);
$("fill-down").onclick = () =>
  action(() => book.fill(primary(), "down"), false);
$("fill-right").onclick = () =>
  action(() => book.fill(primary(), "right"), false);
$("row-height").onchange = (e) => {
  rowHeight = Math.min(80, Math.max(22, Number(e.target.value) || 26));
  render();
  save();
};
for (const [id, method, axis, verb] of [
  ["insert-row", "addRows", "row", "Inserted"],
  ["delete-row", "removeRows", "row", "Deleted"],
  ["insert-col", "addColumns", "column", "Inserted"],
  ["delete-col", "removeColumns", "column", "Deleted"],
]) {
  $(id).onclick = () => {
    const b = primary();
    const start = axis === "row" ? b.top : b.left;
    const count = (axis === "row" ? b.bottom : b.right) - start + 1;
    if (
      action(
        () =>
          book.structural(() =>
            book.engine[method](book.active, [start, count]),
          ),
        false,
        `${verb} ${count} ${axis}${count === 1 ? "" : "s"} ${verb === "Inserted" ? (axis === "row" ? "above row" : "left of column") : "starting at"} ${axis === "row" ? start + 1 : label(start)}.`,
      )
    ) {
      grid.focus();
    }
  };
}
function renderTabs() {
  const tabs = $("tabs");
  tabs.replaceChildren();
  for (const name of book.engine.getSheetNames()) {
    const b = document.createElement("button"),
      id = book.engine.getSheetId(name);
    b.textContent = name;
    b.setAttribute("aria-selected", String(id === book.active));
    b.onclick = () => {
      if (editing && !commit()) return;
      book.active = id;
      anchor = { row: 0, col: 0 };
      focus = { ...anchor };
      extras = [];
      grid.scrollTo(0, 0);
      render();
      renderTabs();
      save();
      grid.focus();
    };
    tabs.append(b);
  }
}
$("new-sheet").onclick = () => {
  if (book.engine.getSheetNames().length >= 30) {
    message("Maximum 30 sheets.", true);
    return;
  }
  action(() => {
    let i = 1;
    while (book.engine.doesSheetExist(`Scratch ${i}`)) i++;
    const name = book.structural(() => book.engine.addSheet(`Scratch ${i}`));
    book.active = book.engine.getSheetId(name);
    anchor = { row: 0, col: 0 };
    focus = { ...anchor };
    extras = [];
    grid.scrollTo(0, 0);
  });
};
$("rename").onclick = () => {
  if (editing && !commit()) return;
  const name = prompt("Sheet name", book.engine.getSheetName(book.active));
  if (name?.trim())
    action(() =>
      book.structural(() => book.engine.renameSheet(book.active, name.trim())),
    );
};
$("delete-sheet").onclick = () => {
  if (book.engine.getSheetNames().length === 1) {
    message("Keep at least one sheet. Clear selected cells with Delete.");
    return;
  }
  if (
    confirm(
      `Delete “${book.engine.getSheetName(book.active)}”? You can undo this.`,
    )
  )
    action(() => book.structural(() => book.engine.removeSheet(book.active)));
};
function downloadBackup() {
  download(
    JSON.stringify(book.snapshot({ widths, rowHeight })),
    "matrix-stats-calculator.json",
    "application/json",
  );
}
$("export").onclick = () => {
  if (editing && !commit()) return;
  downloadBackup();
};
$("import").onclick = () => {
  if (editing && !commit()) return;
  $("file").click();
};
$("file").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    if (file.size > MAX_BACKUP_BYTES) throw new Error("Backup exceeds 64 MB.");
    const data = validateSave(JSON.parse(await file.text()));
    // A second window may save while the file read is pending.
    if (stale) return;
    if (
      !confirm(
        "Replace the current workbook with this backup? Save a backup first if needed.",
      )
    )
      return;
    if (localStorage.getItem(STORAGE_KEY) !== savedText) {
      pauseStale();
      return;
    }
    const replacement = new Workbook(data);
    book.destroy();
    book = replacement;
    statsKey = "";
    widths = {};
    if (data.widths && typeof data.widths === "object")
      for (const [col, w] of Object.entries(data.widths))
        if (/^\d+$/.test(col) && +col < LIMITS.cols && Number.isFinite(w))
          widths[col] = Math.min(500, Math.max(60, w));
    rowHeight = Number.isFinite(data.rowHeight)
      ? Math.min(80, Math.max(22, data.rowHeight))
      : 26;
    columnOffsets = offsets();
    clipboard = null;
    savingAllowed = true;
    anchor = { row: 0, col: 0 };
    focus = { ...anchor };
    extras = [];
    grid.scrollTo(0, 0);
    render();
    renderTabs();
    save();
    message("Backup opened.");
  } catch (err) {
    message(err.message, true);
  }
};
$("functions").onclick = () => {
  refreshFormulaHelp();
  $("function-panel").hidden = false;
  renderFunctions();
  $("function-search").focus();
};
$("close-functions").onclick = () => {
  refreshFormulaHelp();
  $("function-panel").hidden = true;
  grid.focus();
};
function renderFunctions() {
  const query = $("function-search").value.toUpperCase(),
    list = $("function-list");
  list.replaceChildren();
  const items = functionCatalog.filter((f) =>
    `${f.name} ${f.args} ${f.description} ${f.category}`
      .toUpperCase()
      .includes(query),
  );
  let category = "";
  for (const item of items) {
    if (item.category !== category) {
      category = item.category;
      const h = document.createElement("h3");
      h.textContent = category;
      list.append(h);
    }
    const button = document.createElement("button"),
      code = document.createElement("code"),
      desc = document.createElement("small");
    code.textContent = `${item.name}(${item.args})`;
    desc.textContent = item.description;
    button.append(code, desc);
    if (item.example) {
      const example = document.createElement("small");
      example.className = "function-example";
      const result = Array.isArray(item.result)
        ? `{${item.result.map((row) => row.map(display).join(", ")).join("; ")}}`
        : display(item.result);
      example.textContent = `${item.setup ? item.setup + " " : ""}Example: ${item.example} → ${result}`;
      button.append(example);
    }
    button.onclick = () => {
      $("function-panel").hidden = true;
      if (!editing) beginEdit(`=${item.name}(`);
      else {
        const input = editing.input;
        input.setRangeText(
          `${item.name}(`,
          input.selectionStart,
          input.selectionEnd,
          "end",
        );
        formula.value = input.value;
        editor.value = input.value;
        input.focus();
      }
      refreshFormulaHelp();
      message(item.description);
    };
    list.append(button);
  }
}
$("function-search").oninput = renderFunctions;
$("help").onclick = () => {
  $("help-dialog").showModal();
  refreshFormulaHelp();
};
$("help-dialog").addEventListener("close", refreshFormulaHelp);
window.addEventListener("pagehide", () => {
  if (editing) commit();
  else save();
});
// A sidebar can be open in more than one Chrome window. Pause stale views,
// retain their draft for export, and never save them during reload teardown.
function pauseStale() {
  if (stale) return;
  savingAllowed = false;
  stale = true;
  pointerSelecting = false;
  refreshFormulaHelp();
  drag = null;
  resize = null;
  if (editing) {
    conflictDraft = {
      sheet: book.engine.getSheetName(book.active),
      cell: addressLabel({ row: editing.row, col: editing.col }),
      text: editing.input.value,
    };
    $("save-draft").hidden = false;
  }
  $("function-panel").hidden = true;
  $("suggestions").hidden = true;
  editor.hidden = true;
  $("workspace").inert = true;
  $("conflict").hidden = false;
  $("save-status").textContent = "Changed in another window";
  $("help-dialog").close();
  $("reload-latest").focus();
}
window.addEventListener("storage", (e) => {
  if (
    e.storageArea === localStorage &&
    (e.key === STORAGE_KEY || e.key === null)
  )
    pauseStale();
});
$("conflict-backup").onclick = () => {
  if (editing) commit(); // Keep a valid pending edit; invalid drafts have their own download.
  downloadBackup();
};
$("save-draft").onclick = () => {
  if (!conflictDraft) return;
  const { sheet, cell, text } = conflictDraft;
  download(
    `${sheet}!${cell}\n\n${text}`,
    "matrix-stats-cell-draft.txt",
    "text/plain",
  );
};
$("reload-latest").onclick = () => {
  savingAllowed = false;
  if (
    editing &&
    !confirm(
      "Reload the latest saved workbook? Save this view as a backup first to keep your unfinished cell edit.",
    )
  )
    return;
  location.reload();
};
render();
renderTabs();
grid.focus();
$("save-status").textContent = savingAllowed
  ? "Saved locally"
  : "Autosave unavailable";
message(
  startupError || "Type = to enter a formula. Drag column edges to resize.",
);
