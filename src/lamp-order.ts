/**
 * The order the plugin goes through the lamps in: every operation, the lamp screens, one tap after the other, and the
 * settings pages, which sort the lamps they list the same way, in their own scripts. It's in a module of its own, which
 * imports nothing, so the modules that order the lamps share it, and their tests run it as it is.
 */

/**
 * Orders two lamps by their ids (see `Lamp.idOf`), which are the same on every start, so the lamps always come in the
 * same order, and the first one, whose temperature the dials show and step from, is always the same lamp.
 */
export function byId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
