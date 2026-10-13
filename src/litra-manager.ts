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
  turnOff,
  turnOn,
} from "litra";

import { logger as pluginLogger } from "./logging";

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
  /** Every lamp's brightness, in % of its range, for the lamps that could be read. */
  brightnessPercentages?: number[];
  representativeTemperatureKelvin?: number;
  representativeTemperaturePercentage?: number;
};

/** What a lamp screen shows about one lamp (#48). */
export type LampStatus = {
  serialNumber: string;
  model: string;
  on: boolean;
  brightnessLumen: number;
  brightnessPercentage: number;
  temperatureKelvin: number;
};

const logger = pluginLogger.createScope("Lamps");
const DIAL_DEBOUNCE_MS = 60;

// litra names each model "Logitech Litra …", too long for the touch strip.
const MODEL_BY_DEVICE_TYPE: Record<DeviceType, string> = {
  [DeviceType.LitraGlow]: "Glow",
  [DeviceType.LitraBeam]: "Beam",
  [DeviceType.LitraBeamLX]: "Beam LX",
};

// A capped lamp applies its cap within about 100 ms of a write, and until then reports the brightness it was sent.
const BRIGHTNESS_SETTLE_MS = 250;

// Long enough to see the lamp go off and back on, short enough not to disturb.
const IDENTIFY_BLINK_MS = 300;

// Reports a lamp sends unasked (ACKs, change notices, error reports) can arrive ahead of the reply to a query.
const MAX_SKIPPED_REPORTS = 10;

/**
 * The brightness each lamp on a low-power supply can reach, in lumens, by serial number. Learned when a lamp reaches
 * less than it was sent, and kept until the plugin restarts (#55).
 */
const brightnessCapsInLumen = new Map<string, number>();

/**
 * The last brightness change, or blink, queued by {@link oneBrightnessChangeAtATime}, which the next one waits for.
 */
let brightnessChanges: Promise<unknown> = Promise.resolve();

const lampsChangedListeners: Array<() => void | Promise<void>> = [];

/**
 * Registers a listener called after every operation that writes to the lamps, whichever action asked for it, so that
 * everything the Deck shows about the lamps can follow (#57). A brightness change calls it once it has settled and left
 * the queue. Returns a function that removes the listener.
 */
export function onLampsChanged(listener: () => void | Promise<void>): () => void {
  lampsChangedListeners.push(listener);
  return () => {
    const index = lampsChangedListeners.indexOf(listener);
    if (index !== -1) {
      lampsChangedListeners.splice(index, 1);
    }
  };
}

/**
 * Calls every listener once the current operation has returned, and its handles are closed. A failed operation is
 * announced too, since it may have written to some lamps, and finding none is news as well.
 */
function announceLampsChanged(): void {
  for (const listener of [...lampsChangedListeners]) {
    Promise.resolve()
      .then(listener)
      .catch((error: unknown) => {
        logger.error("Lamps changed listener failed", error);
      });
  }
}

/** Announces that the lamps changed, and passes on the result of the operation that changed them. */
function announced<T>(result: T): T {
  announceLampsChanged();
  return result;
}

/**
 * A lamp as the logs name it: its model and the end of its serial number, enough to tell lamps apart without writing
 * the whole serial to a file that may be shared (#41).
 */
function lampLabel(device: Device): string {
  return `${MODEL_BY_DEVICE_TYPE[device.type]} ${serialTail(device.serialNumber)}`;
}

function serialTail(serialNumber: string): string {
  return `…${serialNumber.slice(-4)}`;
}

/** Logs a lamp's part in an operation failing. The other lamps carry on. */
function logLampFailure(operation: string, device: Device, error: unknown): void {
  logger.error(`${operation}: ${lampLabel(device)} failed: ${String(error)}`);
}

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
    logger.warn(`Closing ${lampLabel(device)} failed: ${String(error)}`);
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

/**
 * Moves a value by a number of steps along the grid min, min + step, min + 2 × step, …, clamped to min–max, so a dial
 * stops on the same values going up as going down (#14, #16). From a value off the grid, such as a lamp's cap or a
 * clamped end, the first step goes to the grid's next value in the direction of the turn.
 */
export function stepOnGrid(value: number, ticks: number, step: number, min: number, max: number): number {
  const clamp = (x: number): number => Math.max(min, Math.min(max, x));
  if (ticks === 0 || !(step > 0)) {
    return clamp(value);
  }
  const position = (value - min) / step;
  const index = ticks > 0 ? Math.floor(position) + ticks : Math.ceil(position) + ticks;
  return clamp(min + index * step);
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

/**
 * Opens every connected lamp for an operation, named in the logs. Returns none when no lamp is connected or finding
 * them fails.
 */
function openDevices(operation: string): Device[] {
  let devices: Device[];
  try {
    devices = findDevices();
  } catch (error) {
    logger.error(`${operation}: finding the lamps failed: ${String(error)}`);
    return [];
  }
  if (devices.length === 0) {
    logger.warn(`${operation}: no lamps found`);
  }
  return devices;
}

/**
 * Open devices, run fn per device, always close handles. Zero devices = failure. The operation names the call in the
 * logs, and fn logs what it did to each lamp.
 */
export function forEachDevice(operation: string, fn: (device: Device) => void): BroadcastResult {
  const devices = openDevices(operation);
  if (devices.length === 0) {
    return { ok: false, deviceCount: 0, failures: 1 };
  }

  let failures = 0;
  for (const device of devices) {
    try {
      fn(device);
    } catch (error) {
      failures += 1;
      logLampFailure(operation, device, error);
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
  const operation = "turn on";
  return announced(
    forEachDevice(operation, (device) => {
      turnOn(device);
      drainAck(device);
      logger.info(`${operation}: ${lampLabel(device)} turned on`);
    }),
  );
}

export function turnOffAll(): BroadcastResult {
  const operation = "turn off";
  return announced(
    forEachDevice(operation, (device) => {
      turnOff(device);
      drainAck(device);
      logger.info(`${operation}: ${lampLabel(device)} turned off`);
    }),
  );
}

/**
 * Turns every lamp off if every lamp is on, and on otherwise, so lamps out of sync end up in sync (#23). That's the
 * opposite of what {@link isOnAll} reports, which the Power key shows. A lamp that can't be read counts as off, as in
 * {@link isOnAll}, and is still sent the command.
 */
export function toggleAll(): BroadcastResult {
  const operation = "toggle";
  const devices = openDevices(operation);
  if (devices.length === 0) {
    return announced({ ok: false, deviceCount: 0, failures: 1 });
  }

  // A lamp that fails both stages is counted once.
  const failed = new Set<Device>();
  const attempt = <T>(device: Device, fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch (error) {
      failed.add(device);
      logLampFailure(operation, device, error);
      return fallback;
    }
  };

  try {
    const allOn = devices.map((device) => attempt(device, () => isOn(device), false)).every(Boolean);
    for (const device of devices) {
      attempt(
        device,
        () => {
          if (allOn) {
            turnOff(device);
          } else {
            turnOn(device);
          }
          drainAck(device);
          logger.info(`${operation}: ${lampLabel(device)} turned ${allOn ? "off" : "on"}`);
        },
        undefined,
      );
    }
    return announced({ ok: failed.size === 0, deviceCount: devices.length, failures: failed.size });
  } finally {
    for (const device of devices) {
      closeDevice(device);
    }
  }
}

/**
 * On only if at least one device and every device reports on. Waits for the brightness change in progress, if any,
 * which holds the lamps open until it has read them back.
 */
export async function isOnAll(): Promise<{ ok: boolean; allOn: boolean; deviceCount: number }> {
  await brightnessChanges;
  const operation = "read power";
  const devices = openDevices(operation);
  if (devices.length === 0) {
    return { ok: false, allOn: false, deviceCount: 0 };
  }

  let allOn = true;
  let failures = 0;
  for (const device of devices) {
    try {
      const on = isOn(device);
      logger.debug(`${operation}: ${lampLabel(device)} is ${on ? "on" : "off"}`);
      if (!on) {
        allOn = false;
      }
    } catch (error) {
      failures += 1;
      allOn = false;
      logLampFailure(operation, device, error);
    } finally {
      closeDevice(device);
    }
  }

  return { ok: failures === 0, allOn, deviceCount: devices.length };
}

/** Ensure the device is powered on before a brightness change is visible. */
function ensureOn(operation: string, device: Device): void {
  if (!isOn(device)) {
    turnOn(device);
    drainAck(device);
    logger.info(`${operation}: ${lampLabel(device)} turned on`);
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
 * Sets every lamp to the percentage, and reports the brightest lamp once they've settled, as
 * {@link moveBrightnessAll} does. A lamp at its cap stays there, so the report can be lower than the percentage.
 */
export function setBrightnessAllPercentage(
  percentage: number,
  settleMs = BRIGHTNESS_SETTLE_MS,
): Promise<BroadcastResult> {
  return oneBrightnessChangeAtATime(() => moveBrightnessAll("set brightness", percentage, settleMs)).finally(
    announceLampsChanged,
  );
}

/**
 * Moves every lamp to one target, stepped from the brightest lamp along the multiples of the step, as
 * {@link moveBrightnessAll} does.
 */
export function adjustBrightnessAllByPercentageSteps(
  ticks: number,
  stepPercentage: number,
  settleMs = BRIGHTNESS_SETTLE_MS,
): Promise<BroadcastResult> {
  return oneBrightnessChangeAtATime(() =>
    moveBrightnessAll(
      "adjust brightness",
      (brightest) => stepOnGrid(brightest, ticks, stepPercentage, 0, 100),
      settleMs,
    ),
  ).finally(announceLampsChanged);
}

/**
 * Runs brightness changes one at a time, in the order they were asked for. A change holds the lamps open while they
 * settle, and its read-back would take a later change's lower write for a cap. {@link identifyLamp} goes through it
 * too, since it holds a lamp open during its blink.
 */
function oneBrightnessChangeAtATime(change: () => Promise<BroadcastResult>): Promise<BroadcastResult> {
  const result = brightnessChanges.then(change);
  brightnessChanges = result.catch(() => undefined);
  return result;
}

/**
 * Moves every lamp to one target and reports the brightest lamp once they've settled. The target is a percentage, or
 * a function of the brightest lamp's percentage, which is then read first. Each lamp is sent the target or its cap,
 * whichever is lower, and a lamp that reaches less than it was sent has its cap learned. The lamps stay open from the
 * first read to the last, so calls mustn't overlap: they go through {@link oneBrightnessChangeAtATime}.
 */
async function moveBrightnessAll(
  operation: string,
  target: number | ((brightest: number) => number),
  settleMs: number,
): Promise<BroadcastResult> {
  const devices = openDevices(operation);
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
      logLampFailure(operation, device, error);
    }
  };

  try {
    let brightest: number | undefined;
    for (const device of devices) {
      attempt(device, () => {
        ensureOn(operation, device);
        if (typeof target === "function") {
          const pct = brightnessPercentage(device, getBrightnessInLumenSafe(device));
          brightest = Math.max(brightest ?? pct, pct);
        }
      });
    }

    const targetPercentage =
      typeof target === "number" ? target : brightest === undefined ? undefined : target(brightest);
    const sent = new Map<Device, number>();
    if (targetPercentage !== undefined) {
      const pct = Math.max(0, Math.min(100, targetPercentage));
      for (const device of devices) {
        attempt(device, () => {
          const lumen = withinCap(device, brightnessLumen(device, pct));
          setBrightnessInLumen(device, lumen);
          drainAck(device);
          sent.set(device, lumen);
        });
      }
      await new Promise((resolve) => setTimeout(resolve, settleMs));
    }

    let representative: number | undefined;
    let representativeLumen: number | undefined;
    const percentages: number[] = [];
    for (const [device, lumen] of sent) {
      attempt(device, () => {
        const reached = getBrightnessInLumenSafe(device);
        const pct = brightnessPercentage(device, reached);
        logger.info(`${operation}: ${lampLabel(device)} sent ${lumen} lm, reached ${reached} lm (${pct}%)`);
        if (reached < lumen) {
          brightnessCapsInLumen.set(device.serialNumber, reached);
          logger.info(`${operation}: ${lampLabel(device)} capped at ${reached} lm`);
        }
        percentages.push(pct);
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
      brightnessPercentages: percentages,
    };
  } finally {
    for (const device of devices) {
      closeDevice(device);
    }
  }
}

/** Reads every lamp and reports the brightest, and every lamp's percentage. */
export function readRepresentativeBrightnessPercentage(): BroadcastResult {
  let representative: number | undefined;
  let representativeLumen: number | undefined;
  const percentages: number[] = [];
  const operation = "read brightness";
  const result = forEachDevice(operation, (device) => {
    const lumen = getBrightnessInLumenSafe(device);
    const pct = brightnessPercentage(device, lumen);
    logger.debug(`${operation}: ${lampLabel(device)} at ${lumen} lm (${pct}%)`);
    percentages.push(pct);
    if (representative === undefined || pct > representative) {
      representative = pct;
      representativeLumen = lumen;
    }
  });
  return {
    ...result,
    representativeBrightnessPercentage: representative,
    representativeBrightnessLumen: representativeLumen,
    brightnessPercentages: percentages,
  };
}

/**
 * Reads every lamp for the lamp screens, sorted by serial number, since findDevices lists them in no fixed order. A
 * lamp that can't be read is left out. Waits for the brightness change in progress, if any, which holds the lamps open
 * until it has read them back.
 */
export async function readLampStatuses(): Promise<{ ok: boolean; lamps: LampStatus[] }> {
  await brightnessChanges;
  const lamps: LampStatus[] = [];
  const operation = "read lamp status";
  const result = forEachDevice(operation, (device) => {
    const on = isOn(device);
    const temperatureKelvin = getTemperatureInKelvin(device);
    const brightnessLumen = getBrightnessInLumenSafe(device);
    const percentage = brightnessPercentage(device, brightnessLumen);
    logger.debug(
      `${operation}: ${lampLabel(device)} is ${on ? "on" : "off"}, at ${brightnessLumen} lm (${percentage}%) ` +
        `and ${temperatureKelvin} K`,
    );
    lamps.push({
      serialNumber: device.serialNumber,
      model: MODEL_BY_DEVICE_TYPE[device.type],
      on,
      brightnessLumen,
      brightnessPercentage: percentage,
      temperatureKelvin,
    });
  });
  lamps.sort((a, b) => (a.serialNumber < b.serialNumber ? -1 : a.serialNumber > b.serialNumber ? 1 : 0));
  return { ok: result.ok, lamps };
}

/**
 * Blinks one lamp, so the user can tell which one it is (#48): switches it off and back on, or on and back off when
 * it's off. A blink writes no brightness, so it shows at any brightness and leaves learned caps alone, and the lamp ends
 * as it started. Fails when the lamp isn't connected.
 */
export function identifyLamp(serialNumber: string, blinkMs = IDENTIFY_BLINK_MS): Promise<BroadcastResult> {
  return oneBrightnessChangeAtATime(async () => {
    const operation = "identify";
    const devices = openDevices(operation);
    try {
      const device = devices.find((candidate) => candidate.serialNumber === serialNumber);
      if (device === undefined) {
        logger.warn(`${operation}: lamp ${serialTail(serialNumber)} not connected`);
        return { ok: false, deviceCount: 0, failures: 1 };
      }
      const setPower = (on: boolean): void => {
        if (on) {
          turnOn(device);
        } else {
          turnOff(device);
        }
        drainAck(device);
      };
      try {
        const wasOn = isOn(device);
        setPower(!wasOn);
        await new Promise((resolve) => setTimeout(resolve, blinkMs));
        setPower(wasOn);
        logger.info(`${operation}: ${lampLabel(device)} blinked`);
        return { ok: true, deviceCount: 1, failures: 0 };
      } catch (error) {
        logLampFailure(operation, device, error);
        return { ok: false, deviceCount: 1, failures: 1 };
      }
    } finally {
      for (const device of devices) {
        closeDevice(device);
      }
    }
  });
}

export function setTemperatureAllInKelvin(kelvin: number): BroadcastResult {
  let representative: number | undefined;
  let representativePercentage: number | undefined;
  const operation = "set temperature";
  const result = forEachDevice(operation, (device) => {
    const allowed = getAllowedTemperaturesInKelvinForDevice(device);
    const snapped = snapKelvin(kelvin, allowed);
    setTemperatureInKelvin(device, snapped);
    drainAck(device);
    logger.info(`${operation}: ${lampLabel(device)} set to ${snapped} K`);
    if (representative === undefined) {
      representative = snapped;
      representativePercentage = temperaturePercentage(snapped, allowed);
    }
  });
  return announced({
    ...result,
    representativeTemperatureKelvin: representative,
    representativeTemperaturePercentage: representativePercentage,
  });
}

/**
 * Moves every lamp to one target, stepped from the first lamp's temperature (the one the dial shows) along the grid
 * lowest + k × step. When the first lamp can't be read, the next one becomes the starting point.
 */
export function adjustTemperatureAllByKelvinSteps(ticks: number, stepKelvin: number): BroadcastResult {
  let target: number | undefined;
  let representative: number | undefined;
  let representativePercentage: number | undefined;
  const operation = "adjust temperature";
  const result = forEachDevice(operation, (device) => {
    const allowed = getAllowedTemperaturesInKelvinForDevice(device);
    target ??= stepOnGrid(
      getTemperatureInKelvin(device),
      ticks,
      stepKelvin,
      allowed[0],
      allowed[allowed.length - 1],
    );
    const snapped = snapKelvin(target, allowed);
    setTemperatureInKelvin(device, snapped);
    drainAck(device);
    logger.info(`${operation}: ${lampLabel(device)} set to ${snapped} K`);
    if (representative === undefined) {
      representative = snapped;
      representativePercentage = temperaturePercentage(snapped, allowed);
    }
  });
  return announced({
    ...result,
    representativeTemperatureKelvin: representative,
    representativeTemperaturePercentage: representativePercentage,
  });
}

export function readRepresentativeTemperatureKelvin(): BroadcastResult {
  let representative: number | undefined;
  let representativePercentage: number | undefined;
  const operation = "read temperature";
  const result = forEachDevice(operation, (device) => {
    if (representative !== undefined) {
      return;
    }
    representative = getTemperatureInKelvin(device);
    logger.debug(`${operation}: ${lampLabel(device)} at ${representative} K`);
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
        logger.error("Dial flush failed", error);
      });
    }, delayMs);
  };
}
