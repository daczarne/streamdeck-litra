/**
 * Which lamps an operation acts on, or a key or dial shows, among the ones the plugin knows: every one connected, the
 * ones with these ids (see `Lamp.id`, #20), or every one connected but the ones with these ids, which takes in lamps
 * added later (#147).
 */
export type LampSelection = "all" | readonly string[] | { readonly except: readonly string[] };

/** Whether a selection takes in the lamp with this id. */
export function selects(lamps: LampSelection, id: string): boolean {
  if (lamps === "all") {
    return true;
  }
  return "except" in lamps ? !lamps.except.includes(id) : lamps.includes(id);
}
