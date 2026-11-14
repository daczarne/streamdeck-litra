/**
 * Which lamps an operation acts on, or a key or dial shows, among the ones the plugin knows: every one, the ones with
 * these ids (see `Lamp.id`, #20), every one but the ones with these ids, which takes in lamps added later (#147), or
 * every one that's connected. An operation acts only on the lamps it finds connected, and fails for a lamp it takes in
 * that isn't, except with `"connected"`, which takes in only the lamps found, as a dial's main screen does, since it
 * has no lamps of its own to pick.
 */
export type LampSelection = "all" | "connected" | readonly string[] | { readonly except: readonly string[] };

/** The lamps a key acts on, which are never every lamp connected, since a key picks lamps of its own (#20). */
export type KeyLampSelection = Exclude<LampSelection, "connected">;

/** Whether a selection takes in the lamp with this id, which `"connected"` leaves to the lamps found. */
export function selects(selection: LampSelection, id: string): boolean {
  if (selection === "all" || selection === "connected") {
    return true;
  }
  return "except" in selection ? !selection.except.includes(id) : selection.includes(id);
}
