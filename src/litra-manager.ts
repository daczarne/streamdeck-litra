import streamDeck from "@elgato/streamdeck";
import {
  Device,
  DeviceType,
  findDevices,
  getAllowedTemperaturesInKelvinForDevice,
  getMaximumBrightnessInLumenForDevice,
  getMinimumBrightnessInLumenForDevice,
  getTemperatureInKelvin,
  isOn,
  setBrightnessPercentage,
  setTemperatureInKelvin,
  toggle,
  turnOff,
  turnOn,
} from "litra";

type ClosableHid = {
  write: (values: number[] | Buffer) => number;
  readSync: () => number[];
  readTimeout: (timeout: number) => number[];
  close: () => void;
};

export type BroadcastResult = {
  ok: boolean;
  deviceCount: number;
  failures: number;
  representativeBrightnessPercentage?: number;
  representativeTemperatureKelvin?: number;
};

const logger = streamDeck.logger;
const DIAL_DEBOUNCE_MS = 60;

function asHid(device: Device): ClosableHid {
  return device.hid as ClosableHid;
}

/**
 * litra write-only commands leave an ACK in the HID buffer. Without draining it,
 * the next readSync (isOn / getBrightness / getTemperature) can return the ACK
 * instead of the query response — especially on Beam LX.
 */
function drainAck(device: Device): void {
  try {
    asHid(device).readTimeout(50);
  } catch {
    // nothing pending
  }
}

/**
 * litra's Device.hid type omits close(); runtime is node-hid HID.
 */
function closeDevice(device: Device): void {
  try {
    asHid(device).close();
  } catch (error) {
    logger.warn(`Failed to close Litra HID handle: ${String(error)}`);
  }
}

function padRight(values: number[], length: number): number[] {
  if (values.length >= length) {
    return values;
  }
  return [...values, ...Array(length - values.length).fill(0)];
}

/**
 * Stock litra getBrightnessInLumen only returns data[5], which truncates Beam LX
 * above 255 lm. Mirror litra-rs / temperature parsing: data[4]*256 + data[5].
 */
export function getBrightnessInLumenSafe(device: Device): number {
  const bytes =
    device.type === DeviceType.LitraBeamLX
      ? padRight([0x11, 0xff, 0x06, 0x31], 20)
      : padRight([0x11, 0xff, 0x04, 0x31], 20);
  device.hid.write(bytes);
  const data = device.hid.readSync();
  return data[4] * 256 + data[5];
}

export function lumenToPercentage(lumen: number, min: number, max: number): number {
  if (max <= min) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(((lumen - min) / (max - min)) * 100)));
}

export function snapKelvin(value: number, allowed: number[]): number {
  if (allowed.length === 0) {
    return value;
  }
  let best = allowed[0];
  let bestDelta = Math.abs(value - best);
  for (const candidate of allowed) {
    const delta = Math.abs(value - candidate);
    if (delta < bestDelta) {
      best = candidate;
      bestDelta = delta;
    }
  }
  return best;
}

/**
 * Open devices, run fn per device, always close handles. Zero devices = failure.
 */
export function forEachDevice(fn: (device: Device) => void): BroadcastResult {
  let devices: Device[] = [];
  try {
    devices = findDevices();
  } catch (error) {
    logger.error(`findDevices failed: ${String(error)}`);
    return { ok: false, deviceCount: 0, failures: 1 };
  }

  if (devices.length === 0) {
    logger.warn("No Litra devices found");
    return { ok: false, deviceCount: 0, failures: 1 };
  }

  let failures = 0;
  for (const device of devices) {
    try {
      fn(device);
    } catch (error) {
      failures += 1;
      logger.error(`Litra device operation failed: ${String(error)}`);
    } finally {
      closeDevice(device);
    }
  }

  return {
    ok: failures === 0,
    deviceCount: devices.length,
    failures,
  };
}

export function turnOnAll(): BroadcastResult {
  return forEachDevice((device) => {
    turnOn(device);
    drainAck(device);
  });
}

export function turnOffAll(): BroadcastResult {
  return forEachDevice((device) => {
    turnOff(device);
    drainAck(device);
  });
}

export function toggleAll(): BroadcastResult {
  return forEachDevice((device) => {
    toggle(device);
    drainAck(device);
  });
}

/** On only if at least one device and every device reports on. */
export function isOnAll(): { ok: boolean; allOn: boolean; deviceCount: number } {
  let devices: Device[] = [];
  try {
    devices = findDevices();
  } catch (error) {
    logger.error(`findDevices failed: ${String(error)}`);
    return { ok: false, allOn: false, deviceCount: 0 };
  }

  if (devices.length === 0) {
    return { ok: false, allOn: false, deviceCount: 0 };
  }

  let allOn = true;
  let failures = 0;
  for (const device of devices) {
    try {
      if (!isOn(device)) {
        allOn = false;
      }
    } catch (error) {
      failures += 1;
      allOn = false;
      logger.error(`isOn failed: ${String(error)}`);
    } finally {
      closeDevice(device);
    }
  }

  return { ok: failures === 0, allOn, deviceCount: devices.length };
}

/** Ensure the device is powered on before a brightness change is visible. */
function ensureOn(device: Device): void {
  if (!isOn(device)) {
    turnOn(device);
    drainAck(device);
  }
}

export function setBrightnessAllPercentage(percentage: number): BroadcastResult {
  const pct = Math.max(0, Math.min(100, percentage));
  let representative: number | undefined;
  const result = forEachDevice((device) => {
    ensureOn(device);
    setBrightnessPercentage(device, pct);
    drainAck(device);
    if (representative === undefined) {
      representative = pct;
    }
  });
  return { ...result, representativeBrightnessPercentage: representative };
}

export function adjustBrightnessAllByPercentageSteps(
  ticks: number,
  stepPercentage: number,
): BroadcastResult {
  let representative: number | undefined;
  const result = forEachDevice((device) => {
    ensureOn(device);
    const min = getMinimumBrightnessInLumenForDevice(device);
    const max = getMaximumBrightnessInLumenForDevice(device);
    const lumen = getBrightnessInLumenSafe(device);
    const currentPct = lumenToPercentage(lumen, min, max);
    const nextPct = Math.max(0, Math.min(100, currentPct + ticks * stepPercentage));
    setBrightnessPercentage(device, nextPct);
    drainAck(device);
    if (representative === undefined) {
      representative = nextPct;
    }
  });
  return { ...result, representativeBrightnessPercentage: representative };
}

export function readRepresentativeBrightnessPercentage(): BroadcastResult {
  let representative: number | undefined;
  const result = forEachDevice((device) => {
    if (representative !== undefined) {
      return;
    }
    const min = getMinimumBrightnessInLumenForDevice(device);
    const max = getMaximumBrightnessInLumenForDevice(device);
    representative = lumenToPercentage(getBrightnessInLumenSafe(device), min, max);
  });
  return { ...result, representativeBrightnessPercentage: representative };
}

export function setTemperatureAllInKelvin(kelvin: number): BroadcastResult {
  let representative: number | undefined;
  const result = forEachDevice((device) => {
    const allowed = getAllowedTemperaturesInKelvinForDevice(device);
    const snapped = snapKelvin(kelvin, allowed);
    setTemperatureInKelvin(device, snapped);
    drainAck(device);
    if (representative === undefined) {
      representative = snapped;
    }
  });
  return { ...result, representativeTemperatureKelvin: representative };
}

export function adjustTemperatureAllByKelvinSteps(ticks: number, stepKelvin: number): BroadcastResult {
  let representative: number | undefined;
  const result = forEachDevice((device) => {
    const current = getTemperatureInKelvin(device);
    const allowed = getAllowedTemperaturesInKelvinForDevice(device);
    const snapped = snapKelvin(current + ticks * stepKelvin, allowed);
    setTemperatureInKelvin(device, snapped);
    drainAck(device);
    if (representative === undefined) {
      representative = snapped;
    }
  });
  return { ...result, representativeTemperatureKelvin: representative };
}

export function readRepresentativeTemperatureKelvin(): BroadcastResult {
  let representative: number | undefined;
  const result = forEachDevice((device) => {
    if (representative !== undefined) {
      return;
    }
    representative = getTemperatureInKelvin(device);
  });
  return { ...result, representativeTemperatureKelvin: representative };
}

/** Coalesce dial ticks for a short window, then flush once. */
export function createDialDebouncer(
  flush: (ticks: number) => void | Promise<void>,
  delayMs = DIAL_DEBOUNCE_MS,
): (ticks: number) => void {
  let pending = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  return (ticks: number) => {
    pending += ticks;
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      const batch = pending;
      pending = 0;
      timer = undefined;
      void flush(batch);
    }, delayMs);
  };
}
