/**
 * Who a lamp is, as the plugin names it: its id and its labels, from what the global settings keep of it (#194). It's in
 * a module of its own, which imports nothing of the plugin's, so the modules that name a lamp share it: `Lamp`, which
 * stands for a lamp the plugin knows, and `src/device.ts`, which names a lamp found, the ones the plugin doesn't know
 * included.
 */

import { createHash } from "node:crypto";

/**
 * What identifies a lamp as the global settings keep it (#194): its id, its model, such as "Beam", the last 4
 * characters of its serial number, and the name given to it, if any (#146).
 */
export type LampIdentity = {
  readonly id: string;
  readonly model: string;
  readonly serialEnd: string;
  readonly name?: string | undefined;
};

/**
 * A lamp's id: the first 16 hex characters of its serial number's SHA-256. It tells lamps apart wherever the plugin
 * names a lamp outside its own process, such as a key's settings, which travel with an exported profile, without
 * revealing the serial (#20).
 */
export function lampId(serialNumber: string): string {
  return createHash("sha256").update(serialNumber).digest("hex").slice(0, 16);
}

/**
 * A lamp as the logs name it, such as "Beam …7K98": enough to tell lamps apart without writing the whole serial to a
 * file that may be shared (#41).
 */
export function lampLogLabel({ model, serialEnd }: Pick<LampIdentity, "model" | "serialEnd">): string {
  return `${model} …${serialEnd}`;
}

/**
 * A lamp as the Deck and the settings pages name it, such as "Beam - 7K98", with a hyphen rather than the logs' "…",
 * which reads poorly there (#20).
 */
export function lampLabel({ model, serialEnd }: Pick<LampIdentity, "model" | "serialEnd">): string {
  return `${model} - ${serialEnd}`;
}
