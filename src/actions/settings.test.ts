import type { JsonValue } from "@elgato/utils";
import { assert, describe, expect, it, vi } from "vitest";

import { brightnessSettings, describeLamps, parseSettings, powerSettings, temperatureSettings } from "./settings";

//* Fakes

const logger = { warn: vi.fn() };

//* Tests

describe("parseSettings", () => {
  it.each([
    ["Power", powerSettings, { mode: "toggle", lamps: "all" }],
    ["Brightness", brightnessSettings, { presetPercentage: 0, stepPercentage: 10, lamps: "all" }],
    ["Temperature", temperatureSettings, { presetKelvin: 2700, stepKelvin: 300, lamps: "all" }],
  ])("gives %s's defaults for the settings that are missing, without a warning", (_action, schema, defaults) => {
    expect(parseSettings({}, schema, logger)).toEqual(defaults);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each([
    ["Power", powerSettings, { mode: "off", lamps: "all" }],
    ["Brightness", brightnessSettings, { presetPercentage: 40, stepPercentage: 20, lamps: "all" }],
    ["Temperature", temperatureSettings, { presetKelvin: 5000, stepKelvin: 500, lamps: "all" }],
  ])("keeps %s's valid settings", (_action, schema, settings) => {
    expect(parseSettings(settings, schema, logger)).toEqual(settings);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each([
    ["presetPercentage", brightnessSettings, [0, 100]],
    ["stepPercentage", brightnessSettings, [1, 25]],
    ["presetKelvin", temperatureSettings, [2700, 6500]],
  ])("keeps %s at either end of its range", (name, schema, ends) => {
    for (const end of ends) {
      expect(parseSettings({ [name]: end }, schema, logger)).toMatchObject({ [name]: end });
    }
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("reads text that is a number as the number, as a select saves it", () => {
    expect(parseSettings({ stepKelvin: "200" }, temperatureSettings, logger)).toMatchObject({ stepKelvin: 200 });
    expect(parseSettings({ presetPercentage: "40" }, brightnessSettings, logger)).toMatchObject({
      presetPercentage: 40,
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("keeps a preset temperature between the ones a lamp allows, which the lamps snap to the nearest", () => {
    expect(parseSettings({ presetKelvin: 4050 }, temperatureSettings, logger)).toMatchObject({ presetKelvin: 4050 });
  });

  describe("gives the default, with a warning naming the setting, its value and the default, for", () => {
    const invalid: [string, Parameters<typeof parseSettings>[1], JsonValue][] = [
      // Values Number() would read as 0 or 1.
      ["presetPercentage", brightnessSettings, ""],
      ["presetPercentage", brightnessSettings, " "],
      ["presetPercentage", brightnessSettings, null],
      ["presetPercentage", brightnessSettings, true],
      ["presetPercentage", brightnessSettings, false],
      ["presetPercentage", brightnessSettings, []],
      ["presetPercentage", brightnessSettings, "abc"],
      ["presetPercentage", brightnessSettings, {}],
      ["presetPercentage", brightnessSettings, "Infinity"],
      ["presetPercentage", brightnessSettings, -1],
      ["presetPercentage", brightnessSettings, 101],
      // A step of 0 would make the dial do nothing, and a negative one would turn it the other way.
      ["stepPercentage", brightnessSettings, 0],
      ["stepPercentage", brightnessSettings, -5],
      ["stepPercentage", brightnessSettings, 26],
      ["stepPercentage", brightnessSettings, 2.5],
      ["presetKelvin", temperatureSettings, "warm"],
      ["presetKelvin", temperatureSettings, 2600],
      ["presetKelvin", temperatureSettings, 6600],
      ["stepKelvin", temperatureSettings, 0],
      ["stepKelvin", temperatureSettings, -100],
      ["stepKelvin", temperatureSettings, 400],
      ["stepKelvin", temperatureSettings, "250"],
      ["mode", powerSettings, "blink"],
      ["mode", powerSettings, "On"],
      ["mode", powerSettings, ""],
      ["mode", powerSettings, 1],
      // A list of lamps holds each lamp's id and label, as the settings page saves them (#20).
      ["lamps", powerSettings, "every"],
      ["lamps", powerSettings, 1],
      ["lamps", powerSettings, { id: "0123456789abcdef" }],
      ["lamps", powerSettings, ["0123456789abcdef"]],
      ["lamps", powerSettings, [{ label: "Beam - 1234" }]],
      ["lamps", powerSettings, [{ id: 1, label: "Beam - 1234" }]],
    ];

    it.each(invalid)("%s set to %j", (name, schema, value) => {
      const setting = schema[name];
      assert.isDefined(setting, `${name} isn't a setting`);
      const fallback = setting.default;

      expect(parseSettings({ [name]: value }, schema, logger)).toMatchObject({ [name]: fallback });

      expect(logger.warn).toHaveBeenCalledOnce();
      const message = logger.warn.mock.calls[0]?.[0];
      expect(message).toContain(name);
      expect(message).toContain(JSON.stringify(value));
      expect(message).toContain(String(fallback));
    });
  });

  it("warns once for each setting that isn't valid, and keeps the others", () => {
    const parsed = parseSettings({ presetPercentage: "abc", stepPercentage: 20 }, brightnessSettings, logger);

    expect(parsed).toEqual({ presetPercentage: 0, stepPercentage: 20, lamps: "all" });
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("presetPercentage"));
  });

  describe("lamps (#20)", () => {
    it("takes the ids of the lamps the settings page saved, leaving their labels", () => {
      const lamps = [
        { id: "0123456789abcdef", label: "Beam - 1234" },
        { id: "fedcba9876543210", label: "Beam - 5678" },
      ];

      expect(parseSettings({ lamps }, powerSettings, logger)).toMatchObject({
        lamps: ["0123456789abcdef", "fedcba9876543210"],
      });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it.each([
      ["every lamp", "all"],
      ["no lamp", []],
    ])("takes %s", (_name, lamps) => {
      expect(parseSettings({ lamps }, powerSettings, logger)).toMatchObject({ lamps });
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});

describe("describeLamps", () => {
  it.each([
    ["all", "every lamp"],
    [["0123456789abcdef"], "1 lamp"],
    [["0123456789abcdef", "fedcba9876543210"], "2 lamps"],
    [[], "0 lamps"],
  ] as const)("describes %j as %s", (lamps, description) => {
    expect(describeLamps(lamps)).toBe(description);
  });
});
