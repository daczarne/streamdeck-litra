import type { DeviceType } from "litra";
import { vi } from "vitest";

type FakeDeviceOptions = {
  type: DeviceType;
  serialNumber?: string;
  /** Brightness the lamp reports when queried over HID. Defaults to a Beam's minimum. */
  brightnessInLumen?: number;
};

/**
 * A Litra lamp without hardware: its HID handle records every call and answers brightness queries with the
 * response a real lamp sends (the value in bytes 4 and 5).
 */
export function createFakeDevice({ type, serialNumber = "FAKE0001", brightnessInLumen = 30 }: FakeDeviceOptions) {
  const response = [0x11, 0xff, 0x04, 0x31, brightnessInLumen >> 8, brightnessInLumen & 0xff, ...Array(14).fill(0)];
  return {
    type,
    serialNumber,
    hid: {
      write: vi.fn((values: number[] | Buffer) => values.length),
      readSync: vi.fn((): number[] => response),
      readTimeout: vi.fn((_timeout: number): number[] => []),
      close: vi.fn(),
    },
  };
}

export type FakeDevice = ReturnType<typeof createFakeDevice>;
