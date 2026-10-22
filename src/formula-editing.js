// Point only at an operand boundary; never join B3 onto a neighboring token.
export function referenceSpan(text, start, end, previous = null) {
  if (previous && start === end && end === previous.end) {
    start = previous.start;
  }
  const prefix = text.slice(0, start).trimEnd();
  const suffix = text.slice(end).trimStart();
  let quoted = false;
  for (let i = 0; i < start; i++) {
    if (text[i] !== '"') continue;
    if (quoted && text[i + 1] === '"') i++;
    else quoted = !quoted;
  }
  if (
    quoted ||
    !/[=+\-*/^&(<>,;:{]$/.test(prefix) ||
    (suffix && !/^[%+\-*/^&)=<>,;}:]/.test(suffix))
  )
    return null;
  return { start, end };
}

export function cycleReference(text, caret) {
  const pattern = /\$?[A-Z]{1,3}\$?[1-9]\d*/gi;
  let match;
  while ((match = pattern.exec(text))) {
    if (match.index <= caret && caret <= match.index + match[0].length) {
      // Avoid changing cell-like tokens inside strings or longer identifiers.
      if (
        (text.slice(0, match.index).match(/"/g) || []).length % 2 ||
        /[A-Z0-9_.]/i.test(text[match.index - 1] ?? "") ||
        /[A-Z0-9_(]/i.test(text[match.index + match[0].length] ?? "")
      )
        continue;
      const m = /^(\$?)([A-Z]+)(\$?)(\d+)$/i.exec(match[0]),
        state = (m[1] ? 2 : 0) + (m[3] ? 1 : 0),
        next = { 0: 3, 3: 1, 1: 2, 2: 0 }[state];
      const replacement = `${next & 2 ? "$" : ""}${m[2]}${next & 1 ? "$" : ""}${m[4]}`;
      return {
        start: match.index,
        end: match.index + match[0].length,
        text: replacement,
      };
    }
  }
  return null;
}

function quotedEnd(text, start, limit = text.length) {
  const quote = text[start];
  for (let i = start + 1; i < limit; i++) {
    if (quote === '"' && text[i] === "\\") {
      i++;
      continue;
    }
    if (text[i] !== quote) continue;
    if (text[i + 1] === quote) i++;
    else return i + 1;
  }
  return limit;
}

export function functionContext(text, caret) {
  if (!text.startsWith("=")) return null;
  const stack = [];
  for (let i = 1; i < Math.min(caret, text.length); i++) {
    const char = text[i];
    if (char === '"' || char === "'") {
      i = quotedEnd(text, i, caret) - 1;
    } else if (char === "(" || char === "{") {
      let end = i;
      while (end > 0 && /\s/.test(text[end - 1])) end--;
      let start = end;
      while (start > 0 && /[A-Z0-9_.]/i.test(text[start - 1])) start--;
      const token = text.slice(start, end);
      const name =
        char === "(" && /^[A-Z_][A-Z0-9_.]*$/i.test(token)
          ? token.toUpperCase()
          : null;
      stack.push({
        open: char,
        name,
        argument: 0,
      });
    } else if (char === ")" || char === "}") {
      if (stack.at(-1)?.open !== (char === ")" ? "(" : "{")) return null;
      stack.pop();
    } else if (char === "," && stack.at(-1)?.name) {
      stack.at(-1).argument++;
    }
  }
  const frame = stack.findLast((item) => item.name);
  return frame ? { name: frame.name, argument: frame.argument } : null;
}

export function formulaReferences(text, limits) {
  if (!text.startsWith("=")) return [];
  const references = [];
  const sheet = String.raw`(?:'((?:[^']|'')+)'|([A-Z_\u0080-\uffff][A-Z0-9_.\u0080-\uffff]*))!`;
  const endpoint = `(?:${sheet})?(\\$?[A-Z]{1,3}\\$?\\d+|\\$?[A-Z]{1,3}|\\$?\\d+)`;
  const pattern = new RegExp(`${endpoint}(?:\\s*:\\s*${endpoint})?`, "iy");
  const column = (letters) =>
    [...letters.toUpperCase()].reduce(
      (n, c) => n * 26 + c.charCodeAt(0) - 64,
      0,
    ) - 1;
  for (let i = 1; i < text.length;) {
    if (text[i] === '"') {
      i = quotedEnd(text, i);
      continue;
    }
    pattern.lastIndex = i;
    const match =
      !/[A-Z0-9_.$!\u0080-\uffff]/i.test(text[i - 1]) && pattern.exec(text);
    if (
      !match ||
      /[A-Z0-9_.$!\u0080-\uffff]/i.test(text[pattern.lastIndex] ?? "") ||
      /^\s*\(/.test(text.slice(pattern.lastIndex))
    ) {
      i = text[i] === "'" ? quotedEnd(text, i) : i + 1;
      continue;
    }
    const end = pattern.lastIndex;
    const sheetName = match[1]?.replaceAll("''", "'") ?? match[2] ?? null;
    const endSheet = match[4]?.replaceAll("''", "'") ?? match[5] ?? null;
    const parts = [match[3], ...(match[6] ? [match[6]] : [])].map((part) =>
      part.replaceAll("$", ""),
    );
    const cells = parts.map((part) => /^([A-Z]+)(\d+)$/i.exec(part));
    const valid =
      cells.every(Boolean) ||
      (parts.length === 2 &&
        (parts.every((part) => /^[A-Z]+$/i.test(part)) ||
          parts.every((part) => /^\d+$/.test(part))));
    if (
      !valid ||
      (endSheet !== null && endSheet.toUpperCase() !== sheetName?.toUpperCase())
    ) {
      i = end;
      continue;
    }
    let top, bottom, left, right;
    if (cells[0]) {
      const first = cells[0],
        last = cells.at(-1);
      top = Math.min(+first[2], +last[2]) - 1;
      bottom = Math.max(+first[2], +last[2]) - 1;
      left = Math.min(column(first[1]), column(last[1]));
      right = Math.max(column(first[1]), column(last[1]));
    } else if (/^[A-Z]+$/i.test(parts[0])) {
      top = 0;
      bottom = limits.rows - 1;
      left = Math.min(...parts.map(column));
      right = Math.max(...parts.map(column));
    } else {
      top = Math.min(...parts.map(Number)) - 1;
      bottom = Math.max(...parts.map(Number)) - 1;
      left = 0;
      right = limits.cols - 1;
    }
    if (top >= 0 && left >= 0 && bottom < limits.rows && right < limits.cols)
      references.push({
        start: i,
        end,
        text: match[0],
        sheet: sheetName,
        top,
        bottom,
        left,
        right,
      });
    i = end;
  }
  return references;
}
