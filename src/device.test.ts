import { beforeEach, describe, expect, it } from "vitest";

import type { Device } from "./device";
import { at } from "./test-support/at";
import { loadOnEmulatedLamps } from "./test-support/emulated-lamps";
import { EmulatedLitra, type LitraModel } from "./test-support/emulated-litra";

//* Fakes

let device: typeof import("./device");
let connect: (...lamps: EmulatedLitra[]) => void;

beforeEach(async () => {
  // A fresh module for every test, on emulated lamps.
  ({
    loaded: device,
    hid: { connect },
  } = await loadOnEmulatedLamps(() => import("./device")));
});

/** A Beam, on, at 4000 K, and at its lowest brightness unless the options say otherwise. */
function beam(options: ConstructorParameters<typeof EmulatedLitra>[1] = {}): EmulatedLitra {
  return new EmulatedLitra("Beam", { on: true, brightnessInLumen: 30, temperatureInKelvin: 4000, ...options });
}

/** Plugs a lamp in alone, finds it, and runs `use` on it, closing it afterwards. */
function withDevice<T>(lamp: EmulatedLitra, use: (found: Device) => T): T {
  connect(lamp);
  const found = at(device.findDevices(), 0);
  try {
    return use(found);
  } finally {
    device.closeDevice(found);
  }
}

//* HID parsing

describe("getBrightnessInLumenSafe", () => {
  /** A notice a capped Beam sends unasked when it lowers its brightness to 244 lm. */
  const CHANGE_NOTICE = [0x11, 0xff, 0x04, 0x40, 0x01, 0x00, 0xf4, ...Array(13).fill(0)];

  it.each<[LitraModel, number]>([
    ["Glow", 0x04],
    ["Beam", 0x04],
    ["Beam LX", 0x06],
  ])("sends the brightness query for a %s as a 20-byte report", (model, featureIndex) => {
    const lamp = new EmulatedLitra(model);

    withDevice(lamp, (found) => device.getBrightnessInLumenSafe(found));

    expect(lamp.written).toEqual([[0x11, 0xff, featureIndex, 0x31, ...Array(16).fill(0)]]);
  });

  it("reads the brightness from two bytes, so values above 255 survive", () => {
    expect(withDevice(beam({ brightnessInLumen: 400 }), device.getBrightnessInLumenSafe)).toBe(400);
    expect(withDevice(beam({ brightnessInLumen: 30 }), device.getBrightnessInLumenSafe)).toBe(30);
  });

  it("skips the reports a lamp sends unasked, ahead of the reply", () => {
    const lamp = beam({ brightnessInLumen: 244 });

    const brightness = withDevice(lamp, (found) => {
      // A set-brightness ACK, a change notice and an error report, as a capped Beam sends them.
      lamp.send([0x11, 0xff, 0x04, 0x4c, ...Array(16).fill(0)]);
      lamp.send(CHANGE_NOTICE);
      lamp.send([0x11, 0xff, 0xff, 0x04, 0x4c, 0x02, ...Array(14).fill(0)]);
      return device.getBrightnessInLumenSafe(found);
    });

    expect(brightness).toBe(244);
  });

  it("skips a report too short to hold the brightness, even with the reply's header", () => {
    const lamp = beam({ brightnessInLumen: 244 });

    const brightness = withDevice(lamp, (found) => {
      lamp.send([0x11, 0xff, 0x04, 0x31, 0x00]);
      return device.getBrightnessInLumenSafe(found);
    });

    expect(brightness).toBe(244);
  });

  it("gives up when the reply doesn't come", () => {
    const lamp = beam();

    expect(() =>
      withDevice(lamp, (found) => {
        // More reports than it skips, ahead of the reply.
        for (let report = 0; report <= 10; report += 1) {
          lamp.send(CHANGE_NOTICE);
        }
        return device.getBrightnessInLumenSafe(found);
      }),
    ).toThrow("No brightness reply");
  });
});
