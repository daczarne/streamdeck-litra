/**
 * The order the plugin goes through the lamps in: every operation, and the lamp screens, one tap after the other. The
 * settings pages sort the lamps they list by the same last 4 characters, in their own scripts. It's in a module of its
 * own, which imports nothing, so the modules that order the lamps share it, and their tests run it as it is.
 */

/**
 * Orders two serial numbers, as every operation goes through the lamps: by their last 4 characters, as the settings
 * pages list the lamps, since that's all the global settings keep of them, then by the whole serial number when two
 * lamps share them.
 */
export function bySerialNumber(a: string, b: string): number {
  const [endA, endB] = [a.slice(-4), b.slice(-4)];
  if (endA !== endB) {
    return endA < endB ? -1 : 1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}
