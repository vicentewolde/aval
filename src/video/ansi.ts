const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

export const stripAnsi = (s: string): string => s.replace(ANSI, "");

const escapeHtml = (s: string): string =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);

const COLORS: Record<number, string> = {
  31: "t-red",
  32: "t-green",
  33: "t-yellow",
  34: "t-blue",
  36: "t-cyan",
};

/** Renders one line of terminal output with its bold, dim and color codes as HTML spans. */
export function ansiToHtml(line: string): string {
  let out = "";
  let bold = false;
  let dim = false;
  let color = "";
  const parts = line.split(new RegExp(`(${ESC}\\[[0-9;]*m)`));
  for (const part of parts) {
    const m = new RegExp(`^${ESC}\\[([0-9;]*)m$`).exec(part);
    if (!m) {
      if (part === "") continue;
      const cls = [bold ? "t-bold" : "", dim ? "t-dim" : "", color].filter(Boolean).join(" ");
      out += cls ? `<span class="${cls}">${escapeHtml(part)}</span>` : escapeHtml(part);
      continue;
    }
    for (const code of (m[1] ?? "").split(";").map(Number)) {
      if (code === 0) {
        bold = false;
        dim = false;
        color = "";
      } else if (code === 1) bold = true;
      else if (code === 2) dim = true;
      else if (code === 22) {
        bold = false;
        dim = false;
      } else if (code === 39) color = "";
      else if (COLORS[code]) color = COLORS[code] as string;
    }
  }
  return out;
}
