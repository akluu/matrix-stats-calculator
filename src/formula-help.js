import { functionContext, formulaReferences } from "./formula-editing.js";

const colors = [
  "#1769c2",
  "#a34012",
  "#7a3db8",
  "#16735a",
  "#a82e68",
  "#596c12",
];

export function createFormulaHelp({ panel, grid, catalog, limits, getState }) {
  const functions = new Map(catalog.map((item) => [item.name, item]));
  let frame = null,
    lastText = null,
    references = [],
    panelKey = "";
  function paint() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    const state = getState();
    const input = state.editing?.input;
    const text =
      !state.hidden && input?.value.startsWith("=") ? input.value : "";
    const caret = input?.selectionStart ?? 0;
    if (text !== lastText) {
      lastText = text;
      const groups = new Map();
      references = formulaReferences(text, limits).map((ref) => {
        const key = JSON.stringify([
          ref.sheet?.toUpperCase() ?? null,
          ref.top,
          ref.bottom,
          ref.left,
          ref.right,
        ]);
        if (!groups.has(key))
          groups.set(key, colors[groups.size % colors.length]);
        return { ...ref, key, color: groups.get(key) };
      });
    }
    const context = functionContext(text, caret);
    const active = references.find(
      (ref) => caret >= ref.start && caret <= ref.end,
    );
    const keepSpace = state.keepSpace && !state.hidden && !panel.hidden;
    const key = JSON.stringify([text, context, active?.key, keepSpace]);
    if (key !== panelKey) {
      panelKey = key;
      panel.replaceChildren();
      if (context) {
        const signature = document.createElement("div");
        signature.className = "function-signature";
        const item = functions.get(context.name);
        const args = item?.args ? item.args.split(", ") : [];
        signature.append(`${context.name}(`);
        for (const [index, arg] of args.entries()) {
          if (index) signature.append(", ");
          const current =
            index === context.argument ||
            (arg === "…" && context.argument >= index);
          const part = document.createElement(current ? "strong" : "span");
          part.textContent = arg;
          if (current) part.setAttribute("aria-current", "true");
          signature.append(part);
        }
        signature.append(item ? ")" : `…) — argument ${context.argument + 1}`);
        if (item && context.argument >= args.length && args.at(-1) !== "…")
          signature.append(` — no argument ${context.argument + 1}`);
        panel.append(signature);
      }
      const seen = new Set();
      for (const ref of references) {
        if (seen.has(ref.key)) continue;
        seen.add(ref.key);
        const chip = document.createElement("span");
        chip.className = "reference-label";
        chip.textContent = ref.text;
        chip.style.color = ref.color;
        chip.classList.toggle("current-reference", active?.key === ref.key);
        panel.append(chip);
      }
      if (text && !panel.childNodes.length)
        panel.textContent = "Click or drag cells to insert a reference.";
      panel.hidden = !(text || keepSpace);
    }
    const visible = references.filter(
      (ref) =>
        ref.sheet === null ||
        ref.sheet.toUpperCase() === state.sheet.toUpperCase(),
    );
    if (active)
      visible.sort(
        (a, b) => Number(b.key === active.key) - Number(a.key === active.key),
      );
    for (const cell of grid.querySelectorAll("td[data-row]")) {
      const row = +cell.dataset.row,
        col = +cell.dataset.col;
      const ref = visible.find(
        (r) =>
          row >= r.top && row <= r.bottom && col >= r.left && col <= r.right,
      );
      cell.classList.toggle("formula-reference", !!ref);
      if (!ref) {
        cell.style.removeProperty("--reference-fill");
        cell.style.removeProperty("box-shadow");
        continue;
      }
      cell.style.setProperty("--reference-fill", `${ref.color}18`);
      const edges = [];
      if (row === ref.top) edges.push(`inset 0 2px ${ref.color}`);
      if (row === ref.bottom) edges.push(`inset 0 -2px ${ref.color}`);
      if (col === ref.left) edges.push(`inset 2px 0 ${ref.color}`);
      if (col === ref.right) edges.push(`inset -2px 0 ${ref.color}`);
      cell.style.boxShadow = edges.length ? edges.join(",") : "none";
    }
  }
  function refresh() {
    if (frame !== null) return;
    frame = requestAnimationFrame(paint);
  }
  return { refresh, paint };
}
