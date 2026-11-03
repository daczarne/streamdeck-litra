import { describe, expect, it } from "vitest";

import { bySerialNumber } from "./lamp-order";

describe("bySerialNumber", () => {
  it("orders serial numbers by their last 4 characters, whatever comes before them", () => {
    const serialNumbers = ["2541AB02BBBB", "2419AB03CCCC", "2541AB01AAAA"];

    expect(serialNumbers.sort(bySerialNumber)).toEqual(["2541AB01AAAA", "2541AB02BBBB", "2419AB03CCCC"]);
  });

  it("orders serial numbers that end alike by the whole serial number", () => {
    expect(bySerialNumber("2541AB02AAAA", "2541AB01AAAA")).toBeGreaterThan(0);
    expect(bySerialNumber("2541AB01AAAA", "2541AB02AAAA")).toBeLessThan(0);
  });

  it("finds a serial number equal to itself", () => {
    expect(bySerialNumber("2541AB01AAAA", "2541AB01AAAA")).toBe(0);
  });
});
