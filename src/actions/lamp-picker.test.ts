import { beforeEach, describe, expect, it, vi } from "vitest";

import { findLamps, identifyLamp } from "../litra-manager";
import { logger } from "../logging";
import { at } from "../test-support/at";
import { answer, answerLampPickers } from "./lamp-picker";

//* Fakes

// The SDK's UI controller, which carries the messages between the settings pages and the plugin.
const ui = vi.hoisted(() => ({
  onSendToPlugin: vi.fn(),
  sendToPropertyInspector: vi.fn<(payload: unknown) => Promise<void>>(),
}));

vi.mock("@elgato/streamdeck", () => ({ default: { ui } }));

// The real logger writes to a logs/ folder.
vi.mock("../logging", () => import("../test-support/fake-logging"));

// The real litra-manager loads node-hid's native binary on import and talks to real lamps.
vi.mock("../litra-manager", () => ({
  findLamps: vi.fn(),
  identifyLamp: vi.fn(),
}));

const LAMPS = [
  { id: "lamp-1", label: "Beam - 1111" },
  { id: "lamp-2", label: "Beam LX - 2222" },
];

beforeEach(() => {
  ui.sendToPropertyInspector.mockResolvedValue();
  vi.mocked(findLamps).mockReturnValue(LAMPS);
  vi.mocked(identifyLamp).mockResolvedValue({ ok: true, deviceCount: 1, failures: 0 });
});

//* Tests

describe("the lamp picker's answers (#20)", () => {
  it("send a page that asks for the lamps the ones connected now, by id and label", async () => {
    await answer({ event: "lamps" });

    expect(findLamps).toHaveBeenCalledOnce();
    expect(ui.sendToPropertyInspector).toHaveBeenCalledExactlyOnceWith({ event: "lamps", lamps: LAMPS });
  });

  it("send an empty list when no lamp is connected", async () => {
    vi.mocked(findLamps).mockReturnValue([]);

    await answer({ event: "lamps" });

    expect(ui.sendToPropertyInspector).toHaveBeenCalledExactlyOnceWith({ event: "lamps", lamps: [] });
  });

  it("blink the lamp whose Identify button was pressed", async () => {
    await answer({ event: "identify", id: "lamp-2" });

    expect(identifyLamp).toHaveBeenCalledExactlyOnceWith("lamp-2");
    expect(ui.sendToPropertyInspector).not.toHaveBeenCalled();
  });

  it.each([
    ["another event", { event: "something" }],
    ["an identify without a lamp", { event: "identify" }],
    ["a message that isn't an object", "lamps"],
    ["an empty message", null],
  ])("ignore %s", async (_name, payload) => {
    await answer(payload);

    expect(findLamps).not.toHaveBeenCalled();
    expect(identifyLamp).not.toHaveBeenCalled();
    expect(ui.sendToPropertyInspector).not.toHaveBeenCalled();
  });

  it("log what the page asked for", async () => {
    await answer({ event: "lamps" });
    await answer({ event: "identify", id: "lamp-1" });

    expect(vi.mocked(logger.info).mock.calls).toEqual([
      [expect.stringContaining("asked for the lamps")],
      [expect.stringContaining("Identify")],
    ]);
  });

  it("are given every message the pages send, and log one that fails, with its error", async () => {
    answerLampPickers();
    const listener = at(ui.onSendToPlugin.mock.calls, 0)[0] as (ev: { payload: unknown }) => void;
    ui.sendToPropertyInspector.mockRejectedValue(new Error("Stream Deck is gone"));

    listener({ payload: { event: "lamps" } });
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledOnce());

    expect(logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ message: "Stream Deck is gone" }),
    );
  });
});
