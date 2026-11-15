import { describe, expect, it } from "vitest";

import { barFill } from "./brightness";

//* Tests

describe("barFill", () => {
  it("is plain white for one lamp", () => {
    expect(barFill([79])).toBe("white");
  });

  it("is plain white when every lamp is at the same level", () => {
    expect(barFill([50, 50])).toBe("white");
  });

  it("is plain white when no lamp is lit or none could be read", () => {
    expect(barFill([0, 0])).toBe("white");
    expect(barFill([])).toBe("white");
  });

  it("is white up to the dimmest lamp, then fainter up to the brightest, placed as shares of the brightest", () => {
    expect(barFill([79, 63])).toBe("0:#ffffff,0.797:#ffffff,0.798:#c0c0c0,1:#c0c0c0");
  });

  it("adds a fainter band for each level fewer lamps reach", () => {
    // Up to 25: all three lamps. Up to 50: two of them. Up to 100: one.
    expect(barFill([25, 50, 100])).toBe("0:#ffffff,0.25:#ffffff,0.251:#d5d5d5,0.5:#d5d5d5,0.501:#aaaaaa,1:#aaaaaa");
  });

  it("counts lamps at the same level together", () => {
    expect(barFill([40, 80, 80])).toBe("0:#ffffff,0.5:#ffffff,0.501:#d5d5d5,1:#d5d5d5");
  });

  it("is fainter from the start when a lamp is at 0%, since it lights none of the bar", () => {
    expect(barFill([0, 60])).toBe("0:#c0c0c0,1:#c0c0c0");
  });
});
