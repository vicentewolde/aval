/**
 * Terminal color with the same meaning as the web pages: green is proof, amber is something to settle,
 * red is a block, blue is what was said. Off when piped, when NO_COLOR is set, or when the terminal
 * is not interactive; FORCE_COLOR turns it on (useful for a screen recording).
 */
const on = (): boolean =>
  process.env.NO_COLOR ? false : process.env.FORCE_COLOR ? true : process.stdout.isTTY === true;
const wrap =
  (open: number, close: number) =>
  (s: string): string =>
    on() ? `\u001b[${open}m${s}\u001b[${close}m` : s;

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const blue = wrap(34, 39);
export const cyan = wrap(36, 39);

/** A status word colored by what it means. */
export function statusColor(status: string): (s: string) => string {
  if (["clear", "agreed", "VALID", "met"].includes(status)) return green;
  if (["blocked", "INVALID", "walked_away", "closed"].includes(status)) return red;
  if (["needs_attention", "incomplete", "open", "unconfirmed"].includes(status)) return yellow;
  return (s) => s;
}
