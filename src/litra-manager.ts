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
  setBrightnessInLumen,
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
  representativeBrightnessLumen?: number;
  representativeTemperatureKelvin?: number;
  representativeTemperaturePercentage?: number;
};

const logger = streamDeck.logger;
const DIAL_DEBOUNCE_MS = 60;

// A capped lamp applies its cap within about 100 ms of a write, and until then reports the brightness it was sent.
const BRIGHTNESS_SETTLE_MS = 250;

// Reports a lamp sends unasked (ACKs, change notices, error reports) can arrive ahead of the reply to a query.
const MAX_SKIPPED_REPORTS = 10;

/**
 * The brightness each lamp on a low-power supply can reach, in lumens, by serial number. Learned when a lamp reaches
 * less than it was sent, and kept until the plugin restarts (#55).
 */
const brightnessCapsInLumen = new Map<string, number>();

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
 *
 * It also takes the first report that arrives, which can be an ACK or a change notice instead of the reply, so this
 * skips every report that isn't the reply.
 */
export function getBrightnessInLumenSafe(device: Device): number {
  const featureIndex = device.type === DeviceType.LitraBeamLX ? 0x06 : 0x04;
  device.hid.write(padRight([0x11, 0xff, featureIndex, 0x31], 20));
  for (let skipped = 0; skipped <= MAX_SKIPPED_REPORTS; skipped += 1) {
    const data = device.hid.readSync();
    if (data[2] === featureIndex && data[3] === 0x31) {
      return data[4] * 256 + data[5];
    }
  }
  throw new Error(`No brightness reply after ${MAX_SKIPPED_REPORTS} other reports`);
}

/** Forgets every learned brightness cap. */
export function forgetBrightnessCaps(): void {
  brightnessCapsInLumen.clear();
}

/** The lumens to send a lamp: the ones asked for, or its cap if it has a lower one. */
function withinCap(device: Device, lumen: number): number {
  const cap = brightnessCapsInLumen.get(device.serialNumber);
  return cap === undefined ? lumen : Math.min(lumen, cap);
}

/** Where a value sits in a lamp's range, from 0 to 100, such as a brightness in lumens or a temperature in kelvin. */
export function percentageInRange(value: number, min: number, max: number): number {
  if (max <= min) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(((value - min) / (max - min)) * 100)));
}

/**
 * The lumens litra's setBrightnessPercentage sends for a percentage. Mirrors litra's percentageWithinRange, which
 * isn't exported.
 */
export function percentageToLumen(percentage: number, min: number, max: number): number {
  return Math.ceil((percentage / 100) * (max - min) + min);
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

/** Where a temperature sits between the lowest and the highest allowed for a lamp, from 0 to 100. */
function temperaturePercentage(kelvin: number, allowed: number[]): number {
  if (allowed.length === 0) {
    return 0;
  }
  return percentageInRange(kelvin, allowed[0], allowed[allowed.length - 1]);
}

/** Opens every connected lamp. Returns none when no lamp is connected or finding them fails. */
function openDevices(): Device[] {
  let devices: Device[];
  try {
    devices = findDevices();
  } catch (error) {
    logger.error(`findDevices failed: ${String(error)}`);
    return [];
  }
  if (devices.length === 0) {
    logger.warn("No Litra devices found");
  }
  return devices;
}

/**
 * Open devices, run fn per device, always close handles. Zero devices = failure.
 */
export function forEachDevice(fn: (device: Device) => void): BroadcastResult {
  const devices = openDevices();
  if (devices.length === 0) {
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

function brightnessPercentage(device: Device, lumen: number): number {
  return percentageInRange(
    lumen,
    getMinimumBrightnessInLumenForDevice(device),
    getMaximumBrightnessInLumenForDevice(device),
  );
}

function brightnessLumen(device: Device, percentage: number): number {
  return percentageToLumen(
    percentage,
    getMinimumBrightnessInLumenForDevice(device),
    getMaximumBrightnessInLumenForDevice(device),
  );
}

/**
 * Sets every lamp to the percentage, or to its cap when it has a lower one. Reports the percentage asked for: a key
 * shows its preset, not what the lamps reached.
 */
export function setBrightnessAllPercentage(percentage: number): BroadcastResult {
  const pct = Math.max(0, Math.min(100, percentage));
  let representative: number | undefined;
  let representativeLumen: number | undefined;
  const result = forEachDevice((device) => {
    ensureOn(device);
    const lumen = brightnessLumen(device, pct);
    setBrightnessInLumen(device, withinCap(device, lumen));
    drainAck(device);
    if (representative === undefined) {
      representativeLumen = lumen;
      representative = pct;
    }
  });
  return {
    ...result,
    representativeBrightnessPercentage: representative,
    representativeBrightnessLumen: representativeLumen,
  };
}

/**
 * Moves every lamp to one target, stepped from the brightest lamp, and reports the brightest lamp once they've settled.
 * Each lamp is sent the target or its cap, whichever is lower, and a lamp that reaches less than it was sent has its
 * cap learned. The lamps stay open from the first read to the last, so calls mustn't overlap: the dial's debouncer
 * runs them one at a time.
 */
export async function adjustBrightnessAllByPercentageSteps(
  ticks: number,
  stepPercentage: number,
  settleMs = BRIGHTNESS_SETTLE_MS,
): Promise<BroadcastResult> {
  const devices = openDevices();
  if (devices.length === 0) {
    return { ok: false, deviceCount: 0, failures: 1 };
  }

  // A lamp that fails one stage is left out of the next ones and counted once.
  const failed = new Set<Device>();
  const attempt = (device: Device, fn: () => void): void => {
    if (failed.has(device)) {
      return;
    }
    try {
      fn();
    } catch (error) {
      failed.add(device);
      logger.error(`Litra device operation failed: ${String(error)}`);
    }
  };

  try {
    let brightest: number | undefined;
    for (const device of devices) {
      attempt(device, () => {
        ensureOn(device);
        const pct = brightnessPercentage(device, getBrightnessInLumenSafe(device));
        brightest = Math.max(brightest ?? pct, pct);
      });
    }

    const sent = new Map<Device, number>();
    if (brightest !== undefined) {
      const target = Math.max(0, Math.min(100, brightest + ticks * stepPercentage));
      for (const device of devices) {
        attempt(device, () => {
          const lumen = withinCap(device, brightnessLumen(device, target));
          setBrightnessInLumen(device, lumen);
          drainAck(device);
          sent.set(device, lumen);
        });
      }
      await new Promise((resolve) => setTimeout(resolve, settleMs));
    }

    let representative: number | undefined;
    let representativeLumen: number | undefined;
    for (const [device, lumen] of sent) {
      attempt(device, () => {
        const reached = getBrightnessInLumenSafe(device);
        if (reached < lumen) {
          brightnessCapsInLumen.set(device.serialNumber, reached);
        }
        const pct = brightnessPercentage(device, reached);
        if (representative === undefined || pct > representative) {
          representative = pct;
          representativeLumen = reached;
        }
      });
    }

    return {
      ok: failed.size === 0,
      deviceCount: devices.length,
      failures: failed.size,
      representativeBrightnessPercentage: representative,
      representativeBrightnessLumen: representativeLumen,
    };
  } finally {
    for (const device of devices) {
      closeDevice(device);
    }
  }
}

/** Reads every lamp and reports the brightest. */
export function readRepresentativeBrightnessPercentage(): BroadcastResult {
  let representative: number | undefined;
  let representativeLumen: number | undefined;
  const result = forEachDevice((device) => {
    const lumen = getBrightnessInLumenSafe(device);
    const pct = brightnessPercentage(device, lumen);
    if (representative === undefined || pct > representative) {
      representative = pct;
      representativeLumen = lumen;
    }
  });
  return {
    ...result,
    representativeBrightnessPercentage: representative,
    representativeBrightnessLumen: representativeLumen,
  };
}

export function setTemperatureAllInKelvin(kelvin: number): BroadcastResult {
  let representative: number | undefined;
  let representativePercentage: number | undefined;
  const result = forEachDevice((device) => {
    const allowed = getAllowedTemperaturesInKelvinForDevice(device);
    const snapped = snapKelvin(kelvin, allowed);
    setTemperatureInKelvin(device, snapped);
    drainAck(device);
    if (representative === undefined) {
      representative = snapped;
      representativePercentage = temperaturePercentage(snapped, allowed);
    }
  });
  return {
    ...result,
    representativeTemperatureKelvin: representative,
    representativeTemperaturePercentage: representativePercentage,
  };
}

export function adjustTemperatureAllByKelvinSteps(ticks: number, stepKelvin: number): BroadcastResult {
  let representative: number | undefined;
  let representativePercentage: number | undefined;
  const result = forEachDevice((device) => {
    const current = getTemperatureInKelvin(device);
    const allowed = getAllowedTemperaturesInKelvinForDevice(device);
    const snapped = snapKelvin(current + ticks * stepKelvin, allowed);
    setTemperatureInKelvin(device, snapped);
    drainAck(device);
    if (representative === undefined) {
      representative = snapped;
      representativePercentage = temperaturePercentage(snapped, allowed);
    }
  });
  return {
    ...result,
    representativeTemperatureKelvin: representative,
    representativeTemperaturePercentage: representativePercentage,
  };
}

export function readRepresentativeTemperatureKelvin(): BroadcastResult {
  let representative: number | undefined;
  let representativePercentage: number | undefined;
  const result = forEachDevice((device) => {
    if (representative !== undefined) {
      return;
    }
    representative = getTemperatureInKelvin(device);
    representativePercentage = temperaturePercentage(representative, getAllowedTemperaturesInKelvinForDevice(device));
  });
  return {
    ...result,
    representativeTemperatureKelvin: representative,
    representativeTemperaturePercentage: representativePercentage,
  };
}

/**
 * Coalesce dial ticks for a short window, then flush once. A flush waits for the previous one to finish, since both
 * would use the lamps, and takes every tick received until it starts.
 */
export function createDialDebouncer(
  flush: (ticks: number) => void | Promise<void>,
  delayMs = DIAL_DEBOUNCE_MS,
): (ticks: number) => void {
  let pending = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();

  const run = async (): Promise<void> => {
    const batch = pending;
    pending = 0;
    // A flush that was still running when this one was due has already taken these ticks.
    if (batch === 0) {
      return;
    }
    await flush(batch);
  };

  return (ticks: number) => {
    pending += ticks;
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      running = running.then(run).catch((error: unknown) => {
        logger.error(`Dial flush failed: ${String(error)}`);
      });
    }, delayMs);
  };
}
