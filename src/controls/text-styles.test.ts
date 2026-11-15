import { describe, expect, it } from "vitest";

import { textStyle, textStylesOf } from "./text-styles";

//* Tests

describe("textStyle", () => {
  it.each([
    ["normal", 400],
    ["bold", 700],
  ] as const)("gives a layout's text the %s weight as %i", (weight, number) => {
    expect(textStyle({ color: "#ffcc00", weight, size: 20 })).toEqual({
      color: "#ffcc00",
      font: { size: 20, weight: number },
    });
  });
});

describe("textStylesOf", () => {
  it("turns each of the lamp screens' text styles into a layout's text look", () => {
    expect(
      textStylesOf({
        primary: { color: "#ffffff", weight: "normal", size: 18 },
        secondary: { color: "#202020", weight: "normal", size: 16 },
        accent: { color: "#4dd0e1", weight: "bold", size: 20 },
        alert: { color: "#ff6b6b", weight: "bold", size: 22 },
      }),
    ).toEqual({
      primary: { color: "#ffffff", font: { size: 18, weight: 400 } },
      secondary: { color: "#202020", font: { size: 16, weight: 400 } },
      accent: { color: "#4dd0e1", font: { size: 20, weight: 700 } },
      alert: { color: "#ff6b6b", font: { size: 22, weight: 700 } },
    });
  });
});
