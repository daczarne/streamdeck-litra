import { describe, expect, it } from "vitest";

import { byId } from "./lamp-order";

describe("byId", () => {
  it("orders lamps by their ids", () => {
    const ids = ["c870b1d2e3f40516", "0a9e4f2b7c1d3e58", "912c77c6cebad870"];

    expect(ids.sort(byId)).toEqual(["0a9e4f2b7c1d3e58", "912c77c6cebad870", "c870b1d2e3f40516"]);
  });

  it("finds an id equal to itself", () => {
    expect(byId("912c77c6cebad870", "912c77c6cebad870")).toBe(0);
  });
});
