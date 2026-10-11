import { describe, expect, it, vi } from "vitest";

import { isOnAll, type LampStatus, readLampStatuses, toggleAll } from "../litra-manager";
import { createFakeDial, createFakeKey } from "../test-support/fake-stream-deck";
import { LampScreens } from "./lamp-screens";
import { PowerAction } from "./power";

//* Fakes

vi.mock("@elgato/streamdeck", () => import("../test-support/fake-stream-deck"));

// The real litra-manager loads node-hid's native binary on import and talks to real lamps.
vi.mock("../litra-manager", () => ({
  isOnAll: vi.fn(),
  readLampStatuses: vi.fn(),
  toggleAll: vi.fn(),
  turnOffAll: vi.fn(),
  turnOnAll: vi.fn(),
}));

const BEAM: LampStatus = {
  serialNumber: "A1",
  model: "Beam",
  on: true,
  brightnessLumen: 324,
  brightnessPercentage: 79,
  temperatureKelvin: 2700,
};

//* Tests

describe("PowerAction", () => {
  it("redraws the lamp screens after a key press, so they show whether each lamp is on", async () => {
    const key = createFakeKey();
    const dial = createFakeDial();
    const lampScreens = new LampScreens();
    vi.mocked(readLampStatuses).mockResolvedValue({ ok: true, lamps: [BEAM] });
    await lampScreens.tap(dial, async () => {});
    vi.mocked(toggleAll).mockReturnValue({ ok: true, deviceCount: 1, failures: 0 });
    vi.mocked(isOnAll).mockReturnValue({ ok: true, allOn: false, deviceCount: 1 });
    vi.mocked(readLampStatuses).mockResolvedValue({ ok: true, lamps: [{ ...BEAM, on: false }] });

    await new PowerAction(lampScreens).onKeyDown({ action: key, payload: { settings: {} } } as never);

    expect(dial.setFeedback).toHaveBeenLastCalledWith(expect.objectContaining({ power: "Off" }));
  });
});
