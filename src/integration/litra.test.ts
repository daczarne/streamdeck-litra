import { beforeEach, describe, expect, it } from "vitest";

import { at } from "../test-support/at";
import { loadOnEmulatedLamps } from "../test-support/emulated-lamps";
import { EmulatedLitra, type LitraModel } from "../test-support/emulated-litra";

//* Fakes

let litra: typeof import("litra");
let manager: typeof import("../litra-manager");
let connect: (...lamps: EmulatedLitra[]) => void;

beforeEach(async () => {
  ({
    loaded: { litra, manager },
    connect,
  } = await loadOnEmulatedLamps(async () => ({
    litra: await import("litra"),
    manager: await import("../litra-manager"),
  })));
});

//* The protocol

// The bytes these tests expect come from litra-rs (github.com/timrogers/litra-rs, src/lib.rs at e05d931), not from
// litra, so that litra is checked against another account of the protocol.

/** A report as litra-rs builds it: the bytes given, padded with zeros to 20. */
function report(...bytes: number[]): number[] {
  return [...bytes, ...Array<number>(20 - bytes.length).fill(0)];
}

/** A 16-bit value as its two bytes, the most significant first. */
function bigEndian(value: number): [number, number] {
  return [value >> 8, value & 0xff];
}

/** Plugs in one emulated lamp, and opens it through litra. */
function plugIn(model: LitraModel, options: ConstructorParameters<typeof EmulatedLitra>[1] = {}) {
  const lamp = new EmulatedLitra(model, options);
  connect(lamp);
  return { lamp, device: at(litra.findDevices(), 0) };
}

// The types are litra's DeviceType values, written out since litra is imported afresh for each test, after the table.
const MODELS = [
  {
    name: "Glow",
    model: "Glow",
    productId: 0xc900,
    type: "litra_glow",
    feature: 0x04,
    minLumen: 20,
    maxLumen: 250,
  },
  {
    name: "Beam",
    model: "Beam",
    productId: 0xc901,
    type: "litra_beam",
    feature: 0x04,
    minLumen: 30,
    maxLumen: 400,
  },
  {
    name: "Beam as product 0xb901",
    model: "Beam",
    productId: 0xb901,
    type: "litra_beam",
    feature: 0x04,
    minLumen: 30,
    maxLumen: 400,
  },
  {
    name: "Beam LX",
    model: "Beam LX",
    productId: 0xc903,
    type: "litra_beam_lx",
    feature: 0x06,
    minLumen: 30,
    maxLumen: 400,
  },
] as const;

describe("litra", () => {
  describe("finding the lamps", () => {
    it("finds every Litra plugged in, in the order node-hid lists them", () => {
      const lamps = [new EmulatedLitra("Beam"), new EmulatedLitra("Glow"), new EmulatedLitra("Beam LX")];
      connect(...lamps);

      expect(litra.findDevices().map(({ type, serialNumber }) => ({ type, serialNumber }))).toEqual([
        { type: "litra_beam", serialNumber: at(lamps, 0).info.serialNumber },
        { type: "litra_glow", serialNumber: at(lamps, 1).info.serialNumber },
        { type: "litra_beam_lx", serialNumber: at(lamps, 2).info.serialNumber },
      ]);
    });

    it("opens each lamp it finds, and leaves the handles to the caller to close", () => {
      const lamps = [new EmulatedLitra("Beam"), new EmulatedLitra("Beam")];
      connect(...lamps);

      litra.findDevices();

      expect(lamps.map((lamp) => lamp.openHandles)).toEqual([1, 1]);
    });

    it.each([
      ["another vendor's device with a Litra's product id", { vendorId: 0x1234 }],
      ["another Logitech device", { productId: 0xc52b }],
      ["a Litra's other HID interfaces", { usagePage: 0x000c }],
    ])("skips %s, without opening it", (_name, options) => {
      const lamp = new EmulatedLitra("Beam");
      const other = new EmulatedLitra("Beam", options);
      connect(other, lamp);

      expect(litra.findDevices().map((device) => device.serialNumber)).toEqual([lamp.info.serialNumber]);
      expect(other.openHandles).toBe(0);
    });

    it("finds none when no Litra is plugged in", () => {
      expect(litra.findDevices()).toEqual([]);
      expect(litra.findDevice()).toBeNull();
    });

    it("finds the first Litra alone with findDevice", () => {
      const lamps = [new EmulatedLitra("Glow"), new EmulatedLitra("Beam")];
      connect(...lamps);

      expect(litra.findDevice()?.serialNumber).toBe(at(lamps, 0).info.serialNumber);
      expect(lamps.map((lamp) => lamp.openHandles)).toEqual([1, 0]);
    });
  });

  describe.each(MODELS)("on a $name", ({ model, productId, type, feature, minLumen, maxLumen }) => {
    it("knows its model from its product id", () => {
      const { device } = plugIn(model, { productId });

      expect(device.type).toBe(type);
    });

    describe("power", () => {
      it("turns it on", () => {
        const { lamp, device } = plugIn(model, { productId, on: false });

        litra.turnOn(device);

        expect(lamp.written).toEqual([report(0x11, 0xff, feature, 0x1c, 0x01)]);
        expect(lamp.on).toBe(true);
      });

      it("turns it off", () => {
        const { lamp, device } = plugIn(model, { productId, on: true });

        litra.turnOff(device);

        expect(lamp.written).toEqual([report(0x11, 0xff, feature, 0x1c, 0x00)]);
        expect(lamp.on).toBe(false);
      });

      it.each([true, false])("reads whether it's on, when on is %s", (on) => {
        const { lamp, device } = plugIn(model, { productId, on });

        expect(litra.isOn(device)).toBe(on);
        expect(lamp.written).toEqual([report(0x11, 0xff, feature, 0x01)]);
      });

      it.each([
        [true, 0x00],
        [false, 0x01],
      ])("toggles it, from on %s, by reading its power and writing the opposite", (on, written) => {
        const { lamp, device } = plugIn(model, { productId, on });

        litra.toggle(device);

        expect(lamp.written).toEqual([report(0x11, 0xff, feature, 0x01), report(0x11, 0xff, feature, 0x1c, written)]);
        expect(lamp.on).toBe(!on);
      });
    });

    describe("brightness", () => {
      it("has the range litra-rs gives it", () => {
        const { device } = plugIn(model, { productId });

        expect(litra.getMinimumBrightnessInLumenForDevice(device)).toBe(minLumen);
        expect(litra.getMaximumBrightnessInLumenForDevice(device)).toBe(maxLumen);
      });

      it.each([minLumen, maxLumen])("sets it in lumens, as two bytes, to %i lm", (lumen) => {
        const { lamp, device } = plugIn(model, { productId });

        litra.setBrightnessInLumen(device, lumen);

        expect(lamp.written).toEqual([report(0x11, 0xff, feature, 0x4c, ...bigEndian(lumen))]);
        expect(lamp.brightnessInLumen).toBe(lumen);
      });

      it.each([
        ["below its range", minLumen - 1],
        ["above its range", maxLumen + 1],
        ["that isn't whole", minLumen + 0.5],
      ])("refuses a brightness %s, without writing", (_name, lumen) => {
        const { lamp, device } = plugIn(model, { productId });

        expect(() => litra.setBrightnessInLumen(device, lumen)).toThrow();
        expect(lamp.written).toEqual([]);
      });

      it.each([
        [0, minLumen],
        [100, maxLumen],
        [50, Math.ceil((maxLumen - minLumen) / 2 + minLumen)],
      ])("sets %i% of its range as the lumens there, rounded up", (percentage, lumen) => {
        const { lamp, device } = plugIn(model, { productId });

        litra.setBrightnessPercentage(device, percentage);

        expect(lamp.written).toEqual([report(0x11, 0xff, feature, 0x4c, ...bigEndian(lumen))]);
      });

      it.each([-1, 101])("refuses %i%, without writing", (percentage) => {
        const { lamp, device } = plugIn(model, { productId });

        expect(() => litra.setBrightnessPercentage(device, percentage)).toThrow();
        expect(lamp.written).toEqual([]);
      });

      // A bug in litra, which the plugin works around with getBrightnessInLumenSafe. This test states what litra does,
      // not what it should do, so it starts failing when an upgrade of litra fixes the bug. When it does, check that
      // the fix reads both bytes, then decide whether the plugin still needs its own read, and rewrite this test.
      it("reads only the low byte of the brightness, so it is wrong above 255 lm", () => {
        const { lamp, device } = plugIn(model, { productId, brightnessInLumen: maxLumen });

        expect(litra.getBrightnessInLumen(device)).toBe(maxLumen & 0xff);
        expect(lamp.written).toEqual([report(0x11, 0xff, feature, 0x31)]);
      });
    });

    describe("temperature", () => {
      it("allows the multiples of 100 K from 2700 K to 6500 K", () => {
        const { device } = plugIn(model, { productId });

        expect(litra.getMinimumTemperatureInKelvinForDevice(device)).toBe(2700);
        expect(litra.getMaximumTemperatureInKelvinForDevice(device)).toBe(6500);
        expect(litra.getAllowedTemperaturesInKelvinForDevice(device)).toEqual(
          Array.from({ length: 39 }, (_, index) => 2700 + index * 100),
        );
      });

      it.each([2700, 6500])("sets it in kelvin, as two bytes, to %i K", (kelvin) => {
        const { lamp, device } = plugIn(model, { productId });

        litra.setTemperatureInKelvin(device, kelvin);

        expect(lamp.written).toEqual([report(0x11, 0xff, feature, 0x9c, ...bigEndian(kelvin))]);
        expect(lamp.temperatureInKelvin).toBe(kelvin);
      });

      it.each([
        ["below its range", 2600],
        ["above its range", 6600],
        ["that isn't a multiple of 100", 2750],
        ["that isn't whole", 2700.5],
      ])("refuses a temperature %s, without writing", (_name, kelvin) => {
        const { lamp, device } = plugIn(model, { productId });

        expect(() => litra.setTemperatureInKelvin(device, kelvin)).toThrow();
        expect(lamp.written).toEqual([]);
      });

      it.each([2700, 6500])("reads it from two bytes, at %i K", (kelvin) => {
        const { lamp, device } = plugIn(model, { productId, temperatureInKelvin: kelvin });

        expect(litra.getTemperatureInKelvin(device)).toBe(kelvin);
        expect(lamp.written).toEqual([report(0x11, 0xff, feature, 0x81)]);
      });
    });

    it("has its name", () => {
      const { device } = plugIn(model, { productId });

      expect(litra.getNameForDevice(device)).toBe(`Logitech Litra ${model}`);
    });
  });
});

//* What the plugin takes for granted

describe("what litra-manager assumes about litra", () => {
  describe.each(MODELS)("on a $name", ({ model, productId, minLumen, maxLumen }) => {
    it("percentageToLumen gives the lumens litra sends for every percentage", () => {
      const { lamp, device } = plugIn(model, { productId });

      for (let percentage = 0; percentage <= 100; percentage += 1) {
        litra.setBrightnessPercentage(device, percentage);
        expect(lamp.brightnessInLumen).toBe(manager.percentageToLumen(percentage, minLumen, maxLumen));
      }
    });

    it("getBrightnessInLumenSafe reads both bytes of the brightness, where litra reads one", () => {
      const { device } = plugIn(model, { productId, brightnessInLumen: maxLumen });

      expect(manager.getBrightnessInLumenSafe(device)).toBe(maxLumen);
    });
  });

  it("litra takes a write's ACK for the reply to the next query, which is why the plugin drains it", () => {
    const { device } = plugIn("Beam", { on: true });

    litra.setBrightnessInLumen(device, 100);

    expect(litra.isOn(device)).toBe(false);
  });
});
