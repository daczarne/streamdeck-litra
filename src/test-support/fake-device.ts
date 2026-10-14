import { DeviceType } from "litra";
import { vi } from "vitest";

type FakeDeviceOptions = {
  type: DeviceType;
  serialNumber?: string;
  /** Brightness the lamp reports when queried over HID. Defaults to a Beam's minimum. */
  brightnessInLumen?: number | undefined;
  /** Brightness the lamp can't go above, like a lamp on a low-power supply. None by default. */
  capInLumen?: number | undefined;
};

// Learned caps are kept by serial number, so every fake lamp gets its own.
let nextSerialNumber = 1;

/**
 * A Litra lamp without hardware: its HID handle records every call and answers brightness queries with the
 * response a real lamp sends (the value in bytes 4 and 5).
 *
 * The tests replace litra's setters, so writes don't reach the handle: a test routes them to `setBrightness`, which
 * changes what the lamp reports, up to its cap. Like a real lamp, a capped write also queues a change notice ahead of
 * the next reply. `queueReport` queues any other report, like the ACKs a real lamp sends unasked.
 */
export function createFakeDevice({
  type,
  serialNumber = `FAKE${String(nextSerialNumber++).padStart(4, "0")}`,
  brightnessInLumen = 30,
  capInLumen,
}: FakeDeviceOptions) {
  const featureIndex = type === DeviceType.LitraBeamLX ? 0x06 : 0x04;
  let brightness = brightnessInLumen;
  const queued: number[][] = [];
  const reply = (): number[] => [
    0x11,
    0xff,
    featureIndex,
    0x31,
    brightness >> 8,
    brightness & 0xff,
    ...Array(14).fill(0),
  ];

  return {
    type,
    serialNumber,
    hid: {
      write: vi.fn((values: number[] | Buffer) => values.length),
      readSync: vi.fn((): number[] => queued.shift() ?? reply()),
      readTimeout: vi.fn((_timeout: number): number[] => []),
      close: vi.fn(),
    },
    setBrightness(lumen: number): void {
      if (capInLumen === undefined || lumen <= capInLumen) {
        brightness = lumen;
        return;
      }
      brightness = capInLumen;
      queued.push([0x11, 0xff, featureIndex, 0x40, 0x01, brightness >> 8, brightness & 0xff, ...Array(13).fill(0)]);
    },
    queueReport(report: number[]): void {
      queued.push(report);
    },
  };
}

export type FakeDevice = ReturnType<typeof createFakeDevice>;
