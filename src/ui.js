export function display(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return value.value ?? "#ERROR!";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number")
    return Number.isInteger(value) && Math.abs(value) < 1e15
      ? String(value)
      : Number(value.toPrecision(12)).toString();
  return String(value);
}

export function download(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
