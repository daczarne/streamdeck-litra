/**
 * The element at `index`, counted from the end when negative, like `Array.prototype.at`. Where that gives `undefined`
 * when the element is missing, this throws, so a test fails on the missing element itself rather than further on.
 */
export function at<T>(array: readonly T[], index: number): T {
  const element = array.at(index);
  if (element === undefined) {
    throw new Error(`No element at index ${index} of an array of ${array.length}`);
  }
  return element;
}
