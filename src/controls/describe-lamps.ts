import type { LampSelection } from "../lamps/selection";

/** The lamps a key acts on, as its log line says it. */
export function describeLamps(lamps: LampSelection): string {
  const count = (n: number): string => (n === 1 ? "1 lamp" : `${n} lamps`);
  if (lamps === "all") {
    return "every lamp";
  }
  if (lamps === "connected") {
    return "every lamp connected";
  }
  if ("except" in lamps) {
    return lamps.except.length === 0 ? "every lamp" : `every lamp but ${count(lamps.except.length)}`;
  }
  return count(lamps.length);
}
