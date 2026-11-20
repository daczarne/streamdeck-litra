import type { JsonValue } from "@elgato/utils";
import { assert, describe, expect, it, vi } from "vitest";
import { at } from "../test-support/at";

import {
  brightnessDialSettingsSchema,
  brightnessSettingsSchema,
  parseSettings,
  powerSettingsSchema,
  temperatureDialSettingsSchema,
  temperatureSettingsSchema,
} from "./schemas";

//* Fakes

const logger = { warn: vi.fn() };

//* Tests

describe("parseSettings", () => {
  it.each([
    ["Power", powerSettingsSchema, { mode: "toggle", lamps: "all", leftOutLamps: [] }],
    ["Set Brightness", brightnessSettingsSchema, { presetPercentage: 0, lamps: "all", leftOutLamps: [] }],
    ["Set Temperature", temperatureSettingsSchema, { presetKelvin: 2700, lamps: "all", leftOutLamps: [] }],
    ["Brightness", brightnessDialSettingsSchema, { stepPercentage: 10 }],
    ["Temperature", temperatureDialSettingsSchema, { stepKelvin: 300 }],
  ])("gives %s's defaults for the settings that are missing, without a warning", (_action, schema, defaults) => {
    expect(parseSettings({}, schema, logger)).toEqual(defaults);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each([
    ["Power", powerSettingsSchema, { mode: "off", lamps: "all", leftOutLamps: [] }],
    ["Set Brightness", brightnessSettingsSchema, { presetPercentage: 40, lamps: "all", leftOutLamps: [] }],
    ["Set Temperature", temperatureSettingsSchema, { presetKelvin: 5000, lamps: "all", leftOutLamps: [] }],
    ["Brightness", brightnessDialSettingsSchema, { stepPercentage: 20 }],
    ["Temperature", temperatureDialSettingsSchema, { stepKelvin: 500 }],
  ])("keeps %s's valid settings", (_action, schema, settings) => {
    expect(parseSettings(settings, schema, logger)).toEqual(settings);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each([
    ["presetPercentage", brightnessSettingsSchema, [0, 100]],
    ["stepPercentage", brightnessDialSettingsSchema, [1, 25]],
    ["presetKelvin", temperatureSettingsSchema, [2700, 6500]],
    ["stepKelvin", temperatureDialSettingsSchema, [100, 500]],
  ])("keeps %s at either end of its range", (name, schema, ends) => {
    for (const end of ends) {
      expect(parseSettings({ [name]: end }, schema, logger)).toMatchObject({ [name]: end });
    }
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("keeps every step of the temperature's step, 400 included, as its number field offers them (#195)", () => {
    for (const step of [100, 200, 300, 400, 500]) {
      expect(parseSettings({ stepKelvin: step }, temperatureDialSettingsSchema, logger)).toMatchObject({
        stepKelvin: step,
      });
    }
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("reads text that is a number as the number, as a select saves it", () => {
    expect(parseSettings({ stepKelvin: "200" }, temperatureDialSettingsSchema, logger)).toMatchObject({
      stepKelvin: 200,
    });
    expect(parseSettings({ presetPercentage: "40" }, brightnessSettingsSchema, logger)).toMatchObject({
      presetPercentage: 40,
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("keeps a preset temperature between the ones a lamp allows, which the lamps snap to the nearest", () => {
    expect(parseSettings({ presetKelvin: 4050 }, temperatureSettingsSchema, logger)).toMatchObject({
      presetKelvin: 4050,
    });
  });

  describe("gives the default, with a warning naming the setting, its value and the default, for", () => {
    const invalid: [string, Parameters<typeof parseSettings>[1], JsonValue][] = [
      // Values Number() would read as 0 or 1.
      ["presetPercentage", brightnessSettingsSchema, ""],
      ["presetPercentage", brightnessSettingsSchema, " "],
      ["presetPercentage", brightnessSettingsSchema, null],
      ["presetPercentage", brightnessSettingsSchema, true],
      ["presetPercentage", brightnessSettingsSchema, false],
      ["presetPercentage", brightnessSettingsSchema, []],
      ["presetPercentage", brightnessSettingsSchema, "abc"],
      ["presetPercentage", brightnessSettingsSchema, {}],
      ["presetPercentage", brightnessSettingsSchema, "Infinity"],
      ["presetPercentage", brightnessSettingsSchema, -1],
      ["presetPercentage", brightnessSettingsSchema, 101],
      // A step of 0 would make the dial do nothing, and a negative one would turn it the other way.
      ["stepPercentage", brightnessDialSettingsSchema, 0],
      ["stepPercentage", brightnessDialSettingsSchema, -5],
      ["stepPercentage", brightnessDialSettingsSchema, 26],
      ["stepPercentage", brightnessDialSettingsSchema, 2.5],
      ["presetKelvin", temperatureSettingsSchema, "warm"],
      ["presetKelvin", temperatureSettingsSchema, 2600],
      ["presetKelvin", temperatureSettingsSchema, 6600],
      ["stepKelvin", temperatureDialSettingsSchema, 0],
      ["stepKelvin", temperatureDialSettingsSchema, -100],
      ["stepKelvin", temperatureDialSettingsSchema, 600],
      ["stepKelvin", temperatureDialSettingsSchema, 150],
      ["stepKelvin", temperatureDialSettingsSchema, "250"],
      ["mode", powerSettingsSchema, "blink"],
      ["mode", powerSettingsSchema, "On"],
      ["mode", powerSettingsSchema, ""],
      ["mode", powerSettingsSchema, 1],
      // A list of lamps holds their ids, as the settings page saves them (#194).
      ["lamps", powerSettingsSchema, "every"],
      ["lamps", powerSettingsSchema, 1],
      ["lamps", powerSettingsSchema, "0123456789abcdef"],
      ["lamps", powerSettingsSchema, [{ id: "0123456789abcdef", label: "Beam - 1234" }]],
      ["lamps", powerSettingsSchema, ["0123456789abcdef", 1]],
      // The lamps a key's page left out are a list too, never every lamp (#147).
      ["leftOutLamps", powerSettingsSchema, "all"],
      ["leftOutLamps", powerSettingsSchema, [{ id: "0123456789abcdef" }]],
    ];

    it.each(invalid)("%s set to %j", (name, schema, value) => {
      const setting = schema[name];
      assert.isDefined(setting, `${name} isn't a setting`);
      const fallback = setting.default;

      expect(parseSettings({ [name]: value }, schema, logger)).toMatchObject({ [name]: fallback });

      expect(logger.warn).toHaveBeenCalledOnce();
      const [message] = at(logger.warn.mock.calls, 0);
      expect(message).toContain(name);
      expect(message).toContain(JSON.stringify(value));
      expect(message).toContain(JSON.stringify(fallback));
    });
  });

  it("warns once for each setting that isn't valid, and keeps the others", () => {
    const parsed = parseSettings(
      { presetPercentage: "abc", lamps: ["0123456789abcdef"] },
      brightnessSettingsSchema,
      logger,
    );

    expect(parsed).toEqual({ presetPercentage: 0, lamps: ["0123456789abcdef"], leftOutLamps: [] });
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("presetPercentage"));
  });

  describe("lamps (#20)", () => {
    it("takes the ids of the lamps the settings page saved (#194)", () => {
      const lamps = ["0123456789abcdef", "fedcba9876543210"];

      expect(parseSettings({ lamps }, powerSettingsSchema, logger)).toMatchObject({ lamps });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it.each([
      ["every lamp", "all"],
      ["no lamp", []],
    ])("takes %s", (_name, lamps) => {
      expect(parseSettings({ lamps }, powerSettingsSchema, logger)).toMatchObject({ lamps });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("takes the ids of the lamps the settings page left out (#147)", () => {
      const leftOutLamps = ["fedcba9876543210"];

      expect(parseSettings({ leftOutLamps }, powerSettingsSchema, logger)).toMatchObject({ leftOutLamps });
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});
