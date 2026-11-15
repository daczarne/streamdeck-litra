import { describe, expect, it } from "vitest";

import { describeLamps } from "./describe-lamps";

//* Tests

describe("describeLamps", () => {
  it.each([
    ["all", "every lamp"],
    ["connected", "every lamp connected"],
    [["0123456789abcdef"], "1 lamp"],
    [["0123456789abcdef", "fedcba9876543210"], "2 lamps"],
    [[], "0 lamps"],
    [{ except: [] }, "every lamp"],
    [{ except: ["fedcba9876543210"] }, "every lamp but 1 lamp"],
    [{ except: ["0123456789abcdef", "fedcba9876543210"] }, "every lamp but 2 lamps"],
  ] as const)("describes %j as %s", (lamps, description) => {
    expect(describeLamps(lamps)).toBe(description);
  });
});
