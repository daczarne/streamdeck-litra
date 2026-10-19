import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { JsonValue } from "@elgato/utils";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  brightnessSettings,
  lampSettings,
  parseSettings,
  powerSettings,
  sceneSettings,
  temperatureSettings,
} from "../src/actions/settings";
import { at } from "../src/test-support/at";
import { Chrome, type ExceptionDetails, type Page } from "./support/chrome";
import { FakeStreamDeck, type ListedLamp } from "./support/fake-stream-deck";

const pluginDir = path.resolve("com.daczarne.litra.sdPlugin");
const manifest = JSON.parse(readFileSync(path.join(pluginDir, "manifest.json"), "utf8")) as {
  Actions: { UUID: string; PropertyInspectorPath: string; Controllers: string[] }[];
};

type Controller = "Keypad" | "Encoder";

/** A slider: its setting, what it shows after its value, next to it, and a value to move it to. */
type Slider = { setting: string; suffix: string; value: string };

type Panel = {
  page: string;
  controller: Controller;
  /** The settings whose controls the panel shows, by their `setting` attribute. */
  settings: string[];
  /** A setting to change through its control, and the value Stream Deck should receive for it. */
  change: { setting: string; value: string; saved: unknown };
  sliders?: Slider[];
};

// What each settings page shows on each controller its action supports, as listed in manifest.json.
const PANELS: Panel[] = [
  {
    page: "ui/power.html",
    controller: "Keypad",
    settings: ["mode"],
    change: { setting: "mode", value: "off", saved: "off" },
  },
  {
    page: "ui/brightness.html",
    controller: "Keypad",
    settings: ["presetPercentage"],
    change: { setting: "presetPercentage", value: "40", saved: 40 },
    sliders: [{ setting: "presetPercentage", suffix: "%", value: "40" }],
  },
  {
    page: "ui/brightness.html",
    controller: "Encoder",
    settings: ["stepPercentage"],
    change: { setting: "stepPercentage", value: "20", saved: 20 },
    sliders: [{ setting: "stepPercentage", suffix: "%", value: "20" }],
  },
  {
    page: "ui/temperature.html",
    controller: "Keypad",
    settings: ["presetKelvin"],
    change: { setting: "presetKelvin", value: "5000", saved: 5000 },
    sliders: [{ setting: "presetKelvin", suffix: " K", value: "5000" }],
  },
  {
    page: "ui/temperature.html",
    controller: "Encoder",
    settings: ["stepKelvin"],
    change: { setting: "stepKelvin", value: "500", saved: "500" },
  },
  {
    page: "ui/scene.html",
    controller: "Keypad",
    settings: ["presetPercentage", "presetKelvin"],
    change: { setting: "presetKelvin", value: "5000", saved: 5000 },
    sliders: [
      { setting: "presetPercentage", suffix: "%", value: "40" },
      { setting: "presetKelvin", suffix: " K", value: "5000" },
    ],
  },
  {
    page: "ui/brightness-step.html",
    controller: "Keypad",
    settings: ["stepPercentage"],
    change: { setting: "stepPercentage", value: "20", saved: 20 },
    sliders: [{ setting: "stepPercentage", suffix: "%", value: "20" }],
  },
  {
    page: "ui/temperature-step.html",
    controller: "Keypad",
    settings: ["stepKelvin"],
    change: { setting: "stepKelvin", value: "500", saved: "500" },
  },
];

// What the plugin accepts for each setting, by its name, and the default it takes: settings.ts says these are what
// each page offers, and the pages' own defaults.
const SCHEMA = { ...powerSettings, ...brightnessSettings, ...temperatureSettings, ...sceneSettings, ...lampSettings };

/** The setting's schema in settings.ts, alone, as parseSettings takes it. */
function schemaOf(setting: string) {
  const schema = SCHEMA[setting as keyof typeof SCHEMA];
  if (schema === undefined) {
    throw new Error(`settings.ts has no setting ${setting}`);
  }
  return { [setting]: schema };
}

/** The setting's default in settings.ts. */
function defaultOf(setting: string): unknown {
  return at(Object.values(schemaOf(setting)), 0).default;
}

/**
 * Reads a value as the plugin reads it from what Stream Deck sends: what it takes, and whether it was valid, as
 * opposed to replaced by the default with a warning.
 */
function read(setting: string, value: JsonValue): { value: unknown; valid: boolean } {
  const warn = vi.fn();
  const parsed = parseSettings({ [setting]: value }, schemaOf(setting), { warn });
  return { value: parsed[setting], valid: warn.mock.calls.length === 0 };
}

// Addresses on the internet that each kind of resource tries to reach. The policy blocks them before any request is
// sent, so the tests need no network.
const REMOTE = "https://example.com";

let chrome: Chrome;
let streamDeck: FakeStreamDeck;

beforeAll(async () => {
  [chrome, streamDeck] = await Promise.all([Chrome.launch(), FakeStreamDeck.start()]);
  // On a cold machine, such as a CI runner, Chrome's first page is slow too: once, about 9 s from launch to the end
  // of the first panel's load, against 100-350 ms for the next ones. Opening one panel here gets it out of the way
  // under the hook's timeout, so no test pays for it within its own.
  const { page } = await openPanel(at(PANELS, 0));
  await page.close();
});

afterAll(async () => {
  await Promise.all([chrome?.close(), streamDeck?.close()]);
});

type OpenedPanel = {
  page: Page;
  uuid: string;
  /** URLs the page requested, from the moment it started loading. */
  requests: string[];
  /** Errors in the console and uncaught exceptions, including the policy's own reports. */
  errors: string[];
};

/**
 * Opens a settings page the way Stream Deck does: loads it from the plugin folder, then calls the page's
 * `connectElgatoStreamDeckSocket` with the fake Stream Deck's port and the action's details, including its saved
 * settings.
 */
async function openPanel(
  { page: file, controller }: Panel,
  settings: Record<string, unknown> = {},
): Promise<OpenedPanel> {
  const page = await chrome.newPage();
  const uuid = randomUUID();
  const requests: string[] = [];
  const errors: string[] = [];
  page.on<{ request: { url: string } }>("Network.requestWillBeSent", ({ request }) => requests.push(request.url));
  page.on<{ entry: { level: string; text: string } }>(
    "Log.entryAdded",
    ({ entry }) => entry.level === "error" && errors.push(entry.text),
  );
  page.on<{ exceptionDetails: ExceptionDetails }>("Runtime.exceptionThrown", ({ exceptionDetails }) =>
    errors.push(exceptionDetails.exception?.description ?? exceptionDetails.text),
  );
  page.on<{ type: string; args: { value?: unknown; description?: string }[] }>(
    "Runtime.consoleAPICalled",
    ({ type, args }) => type === "error" && errors.push(args.map((arg) => arg.value ?? arg.description).join(" ")),
  );
  // Runs before the page's own scripts, so it records every violation of the policy from the start.
  await page.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      window.violations = [];
      document.addEventListener("securitypolicyviolation", (event) =>
        violations.push({ directive: event.effectiveDirective, blocked: event.blockedURI }));
    `,
  });

  await page.goto(pathToFileURL(path.join(pluginDir, file)).href);
  const action = manifest.Actions.find((a) => a.PropertyInspectorPath === file);
  if (action === undefined) throw new Error(`No action in manifest.json uses ${file}`);
  const info = {
    application: { language: "en", platform: "mac", version: "7.6" },
    plugin: { uuid: "com.daczarne.litra" },
  };
  const actionInfo = {
    action: action.UUID,
    context: randomUUID(),
    device: "device",
    payload: { controller, settings },
  };
  await page.evaluate(
    `connectElgatoStreamDeckSocket(${streamDeck.port}, "${uuid}", "registerPropertyInspector", ` +
      `${JSON.stringify(JSON.stringify(info))}, ${JSON.stringify(JSON.stringify(actionInfo))})`,
  );
  await streamDeck.waitFor((m) => m.event === "registerPropertyInspector" && "uuid" in m && m.uuid === uuid);
  return { page, uuid, requests, errors };
}

/** The `setting` of every control the page shows, leaving out those inside a hidden block. */
function visibleSettings(page: Page): Promise<string[]> {
  return page.evaluate(`
    [...document.querySelectorAll("[setting]")]
      .filter((control) => !control.closest("[hidden]"))
      .map((control) => control.getAttribute("setting"))
  `);
}

/** A control as the page declares it: its default, a slider's ends and step, a select's options. */
type Control = {
  tag: string;
  default: string | null;
  min: string | null;
  max: string | null;
  step: string | null;
  options: string[];
};

/** Reads the control of a setting from the page. */
function controlOf(page: Page, setting: string): Promise<Control> {
  return page.evaluate(`(() => {
    const control = document.querySelector('[setting="${setting}"]');
    const attribute = (name) => control.getAttribute(name);
    return {
      tag: control.tagName.toLowerCase(),
      default: attribute("default"),
      min: attribute("min"),
      max: attribute("max"),
      step: attribute("step"),
      options: [...control.querySelectorAll("option")].map((option) => option.value),
    };
  })()`);
}

/** A value as a control saves it: a slider as a number, a select as its option's text. */
function saved(control: Control, value: string): JsonValue {
  return control.tag === "sdpi-range" ? Number(value) : value;
}

/** The value shown next to the slider of a setting. */
function shownValue(page: Page, setting: string): Promise<string> {
  return page.evaluate(`
    document.querySelector('[setting="${setting}"]').closest(".range").querySelector("output").value
  `);
}

describe("settings pages", () => {
  it("cover every action and controller in the manifest", () => {
    // A page can serve several actions, such as the Up and Down keys of a step.
    const declared = new Set(
      manifest.Actions.flatMap((a) => a.Controllers.map((c) => `${a.PropertyInspectorPath} ${c}`)),
    );
    expect(PANELS.map((p) => `${p.page} ${p.controller}`).sort()).toEqual([...declared].sort());
    const pages = readdirSync(path.join(pluginDir, "ui"))
      .filter((f) => f.endsWith(".html"))
      .map((f) => `ui/${f}`);
    expect([...new Set(PANELS.map((p) => p.page))].sort()).toEqual(pages.sort());
  });

  describe.each(PANELS)("$page on $controller", (panel) => {
    it("loads only local files, without errors or policy violations", async () => {
      const { page, requests, errors } = await openPanel(panel);
      expect(errors).toEqual([]);
      expect(await page.evaluate("violations")).toEqual([]);
      expect(requests.filter((url) => !url.startsWith("file://") && !url.startsWith("data:"))).toEqual([]);
      await page.close();
    });

    it(`shows the ${panel.settings.join(", ")} controls only`, async () => {
      const { page } = await openPanel(panel);
      await expect.poll(() => visibleSettings(page)).toEqual(panel.settings);
      await page.close();
    });

    it(`sends a changed ${panel.change.setting} to Stream Deck`, async () => {
      const { page, uuid } = await openPanel(panel);
      const { setting, value, saved } = panel.change;
      await page.evaluate(`(async () => {
        const host = document.querySelector('[setting="${setting}"]');
        await host.updateComplete;
        const control = host.shadowRoot.querySelector("select, input");
        control.value = "${value}";
        control.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        control.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      })()`);
      const message = await streamDeck.waitFor((m) => m.event === "setSettings" && m.context === uuid);
      expect(message.payload).toEqual({ [setting]: saved });
      await page.close();
    });

    it("refuses remote scripts, styles, images and connections", async () => {
      const { page } = await openPanel(panel);
      await page.evaluate(`(async () => {
        const add = (tag, attributes) => document.head.append(Object.assign(document.createElement(tag), attributes));
        add("script", { src: "${REMOTE}/script.js" });
        add("link", { rel: "stylesheet", href: "${REMOTE}/style.css" });
        add("img", { src: "${REMOTE}/image.png" });
        new WebSocket("${REMOTE.replace("https", "wss")}");
        await fetch("${REMOTE}").catch(() => {});
        // Violations are reported asynchronously.
        await new Promise((resolve) => setTimeout(resolve, 100));
      })()`);
      const violations = await page.evaluate<{ directive: string; blocked: string }[]>("violations");
      expect(violations.map((v) => v.directive).sort()).toEqual(
        ["connect-src", "connect-src", "img-src", "script-src-elem", "style-src-elem"].sort(),
      );
      await page.close();
    });

    it("refuses inline scripts", async () => {
      const { page } = await openPanel(panel);
      const ran = await page.evaluate(`(async () => {
        window.inlineRan = false;
        document.head.append(Object.assign(document.createElement("script"), { textContent: "inlineRan = true" }));
        await new Promise((resolve) => setTimeout(resolve, 100));
        return inlineRan;
      })()`);
      expect(ran).toBe(false);
      expect(await page.evaluate("violations.map((v) => v.directive)")).toEqual(["script-src-elem"]);
      await page.close();
    });
  });

  describe.each(PANELS)("what $page on $controller offers", (panel) => {
    it.each(panel.settings)("defaults %s to its default in settings.ts", async (setting) => {
      const { page } = await openPanel(panel);
      const control = await controlOf(page, setting);
      await page.close();

      expect(control.default).not.toBeNull();
      expect(read(setting, saved(control, control.default ?? ""))).toEqual({ value: defaultOf(setting), valid: true });
    });

    it.each(panel.settings)("offers only values of %s that settings.ts accepts", async (setting) => {
      const { page } = await openPanel(panel);
      const control = await controlOf(page, setting);
      await page.close();

      const offered =
        control.tag === "sdpi-range"
          ? Array.from({ length: (Number(control.max) - Number(control.min)) / Number(control.step) + 1 }, (_, index) =>
              String(Number(control.min) + index * Number(control.step)),
            )
          : control.options;
      expect(offered.length).toBeGreaterThan(0);
      for (const value of offered) {
        expect(read(setting, saved(control, value)), `${setting} set to ${value}`).toMatchObject({ valid: true });
      }
    });
  });

  const sliders = PANELS.flatMap((panel) => (panel.sliders ?? []).map((slider) => ({ ...slider, panel })));
  describe.each(sliders)("the $setting slider of $panel.page on $panel.controller", (slider) => {
    const { panel, setting, suffix } = slider;

    it("ends where settings.ts does", async () => {
      const { page } = await openPanel(panel);
      const control = await controlOf(page, setting);
      await page.close();

      const [min, max, step] = [Number(control.min), Number(control.max), Number(control.step)];
      expect(read(setting, min - step).valid).toBe(false);
      expect(read(setting, max + step).valid).toBe(false);
    });

    it("shows its default value next to it", async () => {
      const { page } = await openPanel(panel);
      await expect.poll(() => shownValue(page, setting)).toBe(`${defaultOf(setting)}${suffix}`);
      await page.close();
    });

    it("shows the saved value next to it", async () => {
      const saved = Number(slider.value);
      const { page } = await openPanel(panel, { [setting]: saved });
      await expect.poll(() => shownValue(page, setting)).toBe(`${saved}${suffix}`);
      await page.close();
    });

    it("follows it while it's dragged, before it's released", async () => {
      const { page } = await openPanel(panel);
      const { value } = slider;
      await page.evaluate(`(async () => {
        const host = document.querySelector('[setting="${setting}"]');
        await host.updateComplete;
        const control = host.shadowRoot.querySelector("input");
        control.value = "${value}";
        control.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      })()`);
      expect(await shownValue(page, setting)).toBe(`${value}${suffix}`);
      await page.close();
    });
  });

  describe.each(PANELS)("the lamp picker of $page on $controller", (panel) => {
    const onKey = panel.controller === "Keypad";

    it(onKey ? "shows, and asks the plugin for the lamps" : "is left out, and asks the plugin for none", async () => {
      const { page, uuid } = await openPanel(panel);
      // Long enough for a request the page would send once connected.
      await new Promise((resolve) => setTimeout(resolve, 200));
      const shown = await page.evaluate(`(() => {
        const picker = document.getElementById("lamp-picker");
        return picker !== null && picker.closest("[hidden]") === null;
      })()`);
      await page.close();

      expect(shown).toBe(onKey);
      expect(streamDeck.messages.filter((m) => isLampsRequest(m, uuid))).toHaveLength(onKey ? 1 : 0);
    });
  });

  describe("the lamp picker (#20)", () => {
    const POWER = at(PANELS, 0);
    const FIRST: ListedLamp = { id: "0123456789abcdef", label: "Beam - 1111" };
    const SECOND: ListedLamp = { id: "fedcba9876543210", label: "Beam LX - 2222" };

    afterEach(() => {
      streamDeck.lamps = [];
    });

    /** Opens the Power key's page with the lamps the plugin finds and the key's saved settings, once it lists them. */
    async function openPicker(lamps: ListedLamp[], settings: Record<string, unknown> = {}) {
      streamDeck.lamps = lamps;
      const opened = await openPanel(POWER, settings);
      await expect.poll(() => pickerOf(opened.page)).toMatchObject({ all: expect.any(Boolean) });
      return opened;
    }

    /** The next settings the page saves. */
    async function nextSave(uuid: string, after = streamDeck.messages.length): Promise<unknown> {
      const message = await streamDeck.waitFor(
        (m) => m.event === "setSettings" && m.context === uuid && streamDeck.messages.indexOf(m) >= after,
      );
      return message.payload?.lamps;
    }

    it("lists every lamp found, with an Identify button, all checked for a key with no lamps saved", async () => {
      const { page } = await openPicker([FIRST, SECOND]);

      expect(await pickerOf(page)).toEqual({
        lamps: [
          { label: FIRST.label, checked: true, identify: true, missing: false },
          { label: SECOND.label, checked: true, identify: true, missing: false },
        ],
        all: true,
        notes: [],
      });
      // A key with no lamps saved acts on every lamp, settings.ts's default.
      expect(read("lamps", "all")).toEqual({ value: defaultOf("lamps"), valid: true });
      await page.close();
    });

    it("checks the lamps the key has saved, and leaves All unchecked", async () => {
      const { page } = await openPicker([FIRST, SECOND], { lamps: [SECOND] });

      expect(await pickerOf(page)).toMatchObject({
        lamps: [{ checked: false }, { checked: true }],
        all: false,
      });
      await page.close();
    });

    it("saves the lamps still checked when one is unchecked from All, which unchecks", async () => {
      const { page, uuid } = await openPicker([FIRST, SECOND]);

      const after = streamDeck.messages.length;
      await click(page, "sdpi-checkbox", FIRST.label);
      const saved = await nextSave(uuid, after);

      expect(saved).toEqual([SECOND]);
      expect(read("lamps", saved as JsonValue)).toEqual({ value: [SECOND.id], valid: true });
      expect(await pickerOf(page)).toMatchObject({ lamps: [{ checked: false }, { checked: true }], all: false });
      await page.close();
    });

    it("saves every lamp when All is checked, and checks them all", async () => {
      const { page, uuid } = await openPicker([FIRST, SECOND], { lamps: [FIRST] });

      const after = streamDeck.messages.length;
      await click(page, "sdpi-checkbox", "All");

      expect(await nextSave(uuid, after)).toBe("all");
      expect(await pickerOf(page)).toMatchObject({ lamps: [{ checked: true }, { checked: true }], all: true });
      await page.close();
    });

    it("saves no lamp when All is unchecked", async () => {
      const { page, uuid } = await openPicker([FIRST, SECOND]);

      const after = streamDeck.messages.length;
      await click(page, "sdpi-checkbox", "All");
      const saved = await nextSave(uuid, after);

      expect(saved).toEqual([]);
      expect(read("lamps", saved as JsonValue)).toEqual({ value: [], valid: true });
      await page.close();
    });

    it("saves the lamps checked one by one as a list, not as All, which would take in lamps plugged in later", async () => {
      const { page, uuid } = await openPicker([FIRST, SECOND], { lamps: [FIRST] });

      const after = streamDeck.messages.length;
      await click(page, "sdpi-checkbox", SECOND.label);

      expect(await nextSave(uuid, after)).toEqual([FIRST, SECOND]);
      expect(await pickerOf(page)).toMatchObject({ all: false });
      await page.close();
    });

    it("keeps a saved lamp that isn't connected, checked and marked as not found, so it can be unchecked", async () => {
      const { page, uuid } = await openPicker([FIRST], { lamps: [FIRST, SECOND] });

      expect(await pickerOf(page)).toMatchObject({
        lamps: [
          { label: FIRST.label, checked: true, identify: true, missing: false },
          { label: SECOND.label, checked: true, identify: false, missing: true },
        ],
      });

      const after = streamDeck.messages.length;
      await click(page, "sdpi-checkbox", SECOND.label);

      expect(await nextSave(uuid, after)).toEqual([FIRST]);
      await page.close();
    });

    it("says so when no lamp is found", async () => {
      const { page } = await openPicker([]);

      expect(await pickerOf(page)).toEqual({ lamps: [], all: true, notes: ["No lamps found"] });
      await page.close();
    });

    it("asks the plugin again on Find lamps, and lists the lamps plugged in since", async () => {
      const { page, uuid } = await openPicker([FIRST]);

      streamDeck.lamps = [FIRST, SECOND];
      await click(page, "sdpi-button", "Find lamps");

      await expect
        .poll(async () => (await pickerOf(page)).lamps.map((lamp) => lamp.label))
        .toEqual([FIRST.label, SECOND.label]);
      expect(streamDeck.messages.filter((m) => isLampsRequest(m, uuid))).toHaveLength(2);
      await page.close();
    });

    it("asks the plugin to blink a lamp on its Identify button", async () => {
      const { page, uuid } = await openPicker([FIRST, SECOND]);

      await click(page, "sdpi-button", "Identify", SECOND.label);
      const message = await streamDeck.waitFor(
        (m) => m.event === "sendToPlugin" && m.context === uuid && m.payload?.event === "identify",
      );

      expect(message.payload).toEqual({ event: "identify", id: SECOND.id });
      await page.close();
    });
  });
});

/** Whether a message is a page asking the plugin for the lamps. */
function isLampsRequest(message: { event: string; context?: string; payload?: Record<string, unknown> }, uuid: string) {
  return message.event === "sendToPlugin" && message.context === uuid && message.payload?.event === "lamps";
}

type PickerLamp = { label: string | null; checked: boolean; identify: boolean; missing: boolean };

/** What the lamp picker shows: each lamp's row, the All checkbox, if shown yet, and its notes. */
function pickerOf(page: Page): Promise<{ lamps: PickerLamp[]; all: boolean | undefined; notes: string[] }> {
  return page.evaluate(`(() => {
    const picker = document.getElementById("lamp-picker");
    const lamps = [...picker.querySelectorAll(".lamp")].map((row) => ({
      label: row.querySelector("sdpi-checkbox").getAttribute("label"),
      checked: row.querySelector("sdpi-checkbox").value === true,
      identify: row.querySelector("sdpi-button") !== null,
      missing: row.querySelector(".note") !== null,
    }));
    const all = [...picker.children].find((child) => child.localName === "sdpi-checkbox");
    return {
      lamps,
      all: all === undefined ? undefined : all.value === true,
      notes: [...picker.querySelectorAll(":scope > .note")].map((note) => note.textContent),
    };
  })()`);
}

/**
 * Clicks a checkbox of the lamp picker by its label, or a button by its text, in the row of the lamp labelled `row`
 * when given, as the user would: on the input or button inside the component.
 */
function click(page: Page, tag: "sdpi-checkbox" | "sdpi-button", name: string, row?: string): Promise<void> {
  return page.evaluate(`(async () => {
    const picker = document.getElementById("lamp-picker");
    const scope = ${row === undefined ? "picker" : `[...picker.querySelectorAll(".lamp")].find((r) => r.querySelector("sdpi-checkbox").getAttribute("label") === ${JSON.stringify(row)})`};
    const host = [...scope.querySelectorAll("${tag}")].find((element) =>
      (element.getAttribute("label") ?? element.textContent) === ${JSON.stringify(name)});
    await host.updateComplete;
    host.shadowRoot.querySelector("input, button").click();
  })()`);
}
