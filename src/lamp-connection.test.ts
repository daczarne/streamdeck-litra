import { beforeEach, describe, expect, it } from "vitest";
import { Lamp } from "./lamp";
import type { LampConnection } from "./lamp-connection";
import { at } from "./test-support/at";
import { loadOnEmulatedLamps } from "./test-support/emulated-lamps";
import { EmulatedLitra, type LitraModel } from "./test-support/emulated-litra";

//* Fakes

let Connection: typeof LampConnection;
let connect: (...lamps: EmulatedLitra[]) => void;

beforeEach(async () => {
  // A fresh module for every test, on emulated lamps.
  ({
    loaded: Connection,
    hid: { connect },
  } = await loadOnEmulatedLamps(async () => (await import("./lamp-connection")).LampConnection));
});

/** A Beam, on, at 4000 K, and at its lowest brightness unless the options say otherwise. */
function beam(options: ConstructorParameters<typeof EmulatedLitra>[1] = {}): EmulatedLitra {
  return new EmulatedLitra("Beam", { on: true, brightnessInLumen: 30, temperatureInKelvin: 4000, ...options });
}

/** Plugs a lamp in alone, opens it, and runs `use` on its connection, closing it afterwards. */
function withConnection<T>(lamp: EmulatedLitra, use: (found: LampConnection) => T): T {
  connect(lamp);
  const found = at(Connection.findAll(), 0);
  try {
    return use(found);
  } finally {
    found.close();
  }
}

/** The brightness a connection reads from its lamp. */
function readBrightness(found: LampConnection): number {
  return found.readBrightness();
}

//* HID parsing

describe("a connection's brightness read", () => {
  /** A notice a capped Beam sends unasked when it lowers its brightness to 244 lm. */
  const CHANGE_NOTICE = [0x11, 0xff, 0x04, 0x40, 0x01, 0x00, 0xf4, ...Array(13).fill(0)];

  it.each<[LitraModel, number]>([
    ["Glow", 0x04],
    ["Beam", 0x04],
    ["Beam LX", 0x06],
  ])("sends the brightness query for a %s as a 20-byte report", (model, featureIndex) => {
    const lamp = new EmulatedLitra(model);

    withConnection(lamp, readBrightness);

    expect(lamp.written).toEqual([[0x11, 0xff, featureIndex, 0x31, ...Array(16).fill(0)]]);
  });

  it("reads the brightness from two bytes, so values above 255 survive", () => {
    expect(withConnection(beam({ brightnessInLumen: 400 }), readBrightness)).toBe(400);
    expect(withConnection(beam({ brightnessInLumen: 30 }), readBrightness)).toBe(30);
  });

  it("skips the reports a lamp sends unasked, ahead of the reply", () => {
    const lamp = beam({ brightnessInLumen: 244 });

    const brightness = withConnection(lamp, (found) => {
      // A set-brightness ACK, a change notice and an error report, as a capped Beam sends them.
      lamp.send([0x11, 0xff, 0x04, 0x4c, ...Array(16).fill(0)]);
      lamp.send(CHANGE_NOTICE);
      lamp.send([0x11, 0xff, 0xff, 0x04, 0x4c, 0x02, ...Array(14).fill(0)]);
      return found.readBrightness();
    });

    expect(brightness).toBe(244);
  });

  it("skips a report too short to hold the brightness, even with the reply's header", () => {
    const lamp = beam({ brightnessInLumen: 244 });

    const brightness = withConnection(lamp, (found) => {
      lamp.send([0x11, 0xff, 0x04, 0x31, 0x00]);
      return found.readBrightness();
    });

    expect(brightness).toBe(244);
  });

  it("gives up when the reply doesn't come", () => {
    const lamp = beam();

    expect(() =>
      withConnection(lamp, (found) => {
        // More reports than it skips, ahead of the reply.
        for (let report = 0; report <= 10; report += 1) {
          lamp.send(CHANGE_NOTICE);
        }
        return found.readBrightness();
      }),
    ).toThrow("No brightness reply");
  });
});

//* A lamp's connection (#198)

describe("a lamp's connection", () => {
  it("names the lamp by its model and the id of the serial number its USB descriptor gives", () => {
    const lamp = beam();

    const named = withConnection(lamp, ({ isIdentified, id, model, label }) => ({ isIdentified, id, model, label }));

    expect(named).toEqual({
      isIdentified: true,
      id: Lamp.idOf(lamp.serialNumber),
      model: "Beam",
      label: `Beam - ${Lamp.idOf(lamp.serialNumber).slice(-4)}`,
    });
  });

  it("asks a Beam LX for the serial number it keeps, which its USB descriptor leaves out (#170)", () => {
    const lamp = new EmulatedLitra("Beam LX");

    const named = withConnection(lamp, (found) => {
      const before = { isIdentified: found.isIdentified, label: found.label };
      found.identify();
      return { before, id: found.id };
    });

    expect(named).toEqual({ before: { isIdentified: false, label: "Beam LX" }, id: Lamp.idOf(lamp.serialNumber) });
  });

  it("has no id for a lamp it can't identify", () => {
    const lamp = new EmulatedLitra("Beam LX");
    lamp.fail("identifying");

    withConnection(lamp, (found) => {
      expect(() => found.identify()).toThrow();
      expect(() => found.id).toThrow("Beam LX has no serial number to tell it by");
    });
  });

  it("gives the lamp's path and its range", () => {
    const lamp = beam();

    const { path, range } = withConnection(lamp, ({ path, range }) => ({ path, range }));

    expect(path).toBe(lamp.info.path);
    expect(range).toMatchObject({ minLumen: 30, maxLumen: 400 });
    expect([range.allowedKelvin.at(0), range.allowedKelvin.at(-1)]).toEqual([2700, 6500]);
  });

  it("writes the power, the brightness and the temperature, each read back on the same handle after its ACK", () => {
    const lamp = beam();

    const read = withConnection(lamp, (found) => {
      found.switchPower(false);
      const on = found.isOn();
      found.writeBrightness(324);
      const lumen = found.readBrightness();
      found.writeTemperature(6500);
      return [on, lumen, found.readTemperature()];
    });

    expect(read).toEqual([false, 324, 6500]);
    expect([lamp.writes("power"), lamp.writes("brightness"), lamp.writes("temperature")]).toEqual([[0], [324], [6500]]);
  });
});
