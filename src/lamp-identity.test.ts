import { describe, expect, it } from "vitest";

import { lampId, lampLabel, lampLogLabel } from "./lamp-identity";

describe("lampId", () => {
  it("is the first 16 hex characters of the serial number's SHA-256", () => {
    // printf '%s' 2325FE01ABCD | shasum -a 256
    expect(lampId("2325FE01ABCD")).toBe("912c77c6cebad870");
  });

  it("tells lamps apart", () => {
    expect(lampId("2541AB017K98")).not.toBe(lampId("2541AB027K99"));
  });
});

describe("a lamp's labels", () => {
  it("name it by its model and the end of its serial number, with a hyphen on the Deck and an ellipsis in the logs", () => {
    const identity = { model: "Beam LX", serialEnd: "7K98" };

    expect([lampLabel(identity), lampLogLabel(identity)]).toEqual(["Beam LX - 7K98", "Beam LX …7K98"]);
  });
});
