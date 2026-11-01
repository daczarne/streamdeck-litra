import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { JsonValue } from "@elgato/utils";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  brightnessSettings,
  globalSettings,
  LAMP_SCREEN_ITEMS,
  lampScreenItemOptions,
  lampSettings,
  parseSettings,
  powerSettings,
  sceneGroupSettings,
  sceneSettings,
  temperatureSettings,
} from "../src/actions/settings";
import { at } from "../src/test-support/at";
import { Chrome, type ExceptionDetails, type Page } from "./support/chrome";
import { FakeStreamDeck, type KnownLamp, type ListedLamp } from "./support/fake-stream-deck";

const pluginDir = path.resolve("com.daczarne.litra.sdPlugin");
const manifest = JSON.parse(readFileSync(path.join(pluginDir, "manifest.json"), "utf8")) as {
  Actions: { UUID: string; PropertyInspectorPath: string; Controllers: string[] }[];
};

type Controller = "Keypad" | "Encoder";

/** A number field (#195): its setting, the unit it shows inside it, after its value, and a value to set it to. */
type NumberSetting = { setting: string; unit: string; value: string };

type Panel = {
  page: string;
  controller: Controller;
  /** The settings whose controls the panel shows, by their `setting` attribute. */
  settings: string[];
  /** A setting to change through its control, and the value Stream Deck should receive for it. */
  change: { setting: string; value: string; saved: unknown };
  numbers?: NumberSetting[];
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
    numbers: [{ setting: "presetPercentage", unit: "%", value: "40" }],
  },
  {
    page: "ui/brightness.html",
    controller: "Encoder",
    settings: ["stepPercentage"],
    change: { setting: "stepPercentage", value: "20", saved: 20 },
    numbers: [{ setting: "stepPercentage", unit: "%", value: "20" }],
  },
  {
    page: "ui/temperature.html",
    controller: "Keypad",
    settings: ["presetKelvin"],
    change: { setting: "presetKelvin", value: "5000", saved: 5000 },
    numbers: [{ setting: "presetKelvin", unit: "K", value: "5000" }],
  },
  {
    page: "ui/temperature.html",
    controller: "Encoder",
    settings: ["stepKelvin"],
    change: { setting: "stepKelvin", value: "400", saved: 400 },
    numbers: [{ setting: "stepKelvin", unit: "K", value: "400" }],
  },
  {
    page: "ui/scene.html",
    controller: "Keypad",
    settings: ["power", "presetPercentage", "presetKelvin"],
    change: { setting: "presetKelvin", value: "5000", saved: 5000 },
    numbers: [
      { setting: "presetPercentage", unit: "%", value: "40" },
      { setting: "presetKelvin", unit: "K", value: "5000" },
    ],
  },
  {
    page: "ui/brightness-step.html",
    controller: "Keypad",
    settings: ["stepPercentage"],
    change: { setting: "stepPercentage", value: "20", saved: 20 },
    numbers: [{ setting: "stepPercentage", unit: "%", value: "20" }],
  },
  {
    page: "ui/temperature-step.html",
    controller: "Keypad",
    settings: ["stepKelvin"],
    change: { setting: "stepKelvin", value: "400", saved: 400 },
    numbers: [{ setting: "stepKelvin", unit: "K", value: "400" }],
  },
];

// The global checkboxes of sdpi-components the plugin settings show, on every page, which every dial and key shares
// (#145, #146), the lists of the lamp screens' cells, in the order the cells are read (#177), the controls of their text
// styles (#153), and every global setting they show through sdpi-components, in their order: the lamps' first, the
// blink's length (#171) last among them, then the lamp screens'.
const PLUGIN_SETTINGS_CHECKBOXES = ["keepBrightnessDifference", "keepTemperatureDifference"];
const LAMP_SCREEN_LISTS = [
  "lampScreenTopLeft",
  "lampScreenTopRight",
  "lampScreenMiddleLeft",
  "lampScreenMiddleRight",
  "lampScreenBottomLeft",
  "lampScreenBottomRight",
];
// The text styles, by the start of their settings' names, with their default colors and weights.
const TEXT_STYLES = {
  lampScreenPrimary: { color: "#ffffff", weight: "normal" },
  lampScreenSecondary: { color: "#202020", weight: "normal" },
  lampScreenAccent: { color: "#4dd0e1", weight: "normal" },
  lampScreenAlert: { color: "#ff6b6b", weight: "bold" },
};
const TEXT_STYLE_CONTROLS = Object.keys(TEXT_STYLES).flatMap((style) =>
  ["Color", "Weight", "Size"].map((part) => `${style}${part}`),
);
const PLUGIN_SETTINGS_GLOBALS = [
  ...PLUGIN_SETTINGS_CHECKBOXES,
  "identifyBlinkMs",
  ...LAMP_SCREEN_LISTS,
  ...TEXT_STYLE_CONTROLS,
];

// What the plugin accepts for each setting, by its name, and the default it takes: settings.ts says these are what
// each page offers, and the pages' own defaults. A key's or dial's settings and the global ones are apart, as the
// plugin reads them, since a name can be in both, such as `lamps`: a key's, and the ones the plugin knows (#194).
const SCHEMAS = {
  action: { ...powerSettings, ...brightnessSettings, ...temperatureSettings, ...sceneSettings, ...lampSettings },
  global: globalSettings,
};

type Scope = keyof typeof SCHEMAS;

/**
 * The setting's schema in settings.ts, alone, as parseSettings takes it: a key's or dial's, or a global one. A name in
 * both needs its scope, so a test can't read one against the other's schema.
 */
function schemaOf(setting: string, scope?: Scope) {
  const found = (Object.keys(SCHEMAS) as Scope[]).filter(
    (candidate) => (scope === undefined || candidate === scope) && setting in SCHEMAS[candidate],
  );
  if (found.length > 1) {
    throw new Error(`settings.ts has a setting ${setting} for an action and a global one: name its scope`);
  }
  const [where] = found;
  if (where === undefined) {
    throw new Error(`settings.ts has no setting ${setting}`);
  }
  return { [setting]: SCHEMAS[where][setting as keyof (typeof SCHEMAS)[typeof where]] };
}

/** The setting's default in settings.ts. */
function defaultOf(setting: string, scope?: Scope): unknown {
  return at(Object.values(schemaOf(setting, scope)), 0).default;
}

/**
 * Reads a value as the plugin reads it from what Stream Deck sends: what it takes, and whether it was valid, as
 * opposed to replaced by the default with a warning.
 */
function read(setting: string, value: JsonValue, scope?: Scope): { value: unknown; valid: boolean } {
  const warn = vi.fn();
  const parsed = parseSettings({ [setting]: value }, schemaOf(setting, scope), { warn });
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
  /** The id of the action whose page this is, as the plugin knows it. */
  context: string;
  /** URLs the page requested, from the moment it started loading. */
  requests: string[];
  /** Errors in the console and uncaught exceptions, including the policy's own reports. */
  errors: string[];
};

/**
 * Opens a settings page the way Stream Deck does: loads it from the plugin folder, then calls the page's
 * `connectElgatoStreamDeckSocket` with the fake Stream Deck's port and the action's details, including its saved
 * settings and its id, `context`, a new one unless given.
 */
async function openPanel(
  { page: file, controller }: Panel,
  settings: Record<string, unknown> = {},
  context = randomUUID().replaceAll("-", ""),
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
    context,
    device: "device",
    payload: { controller, settings },
  };
  await page.evaluate(
    `connectElgatoStreamDeckSocket(${streamDeck.port}, "${uuid}", "registerPropertyInspector", ` +
      `${JSON.stringify(JSON.stringify(info))}, ${JSON.stringify(JSON.stringify(actionInfo))})`,
  );
  await streamDeck.waitFor((m) => m.event === "registerPropertyInspector" && "uuid" in m && m.uuid === uuid);
  return { page, uuid, context, requests, errors };
}

/**
 * The `setting` of every control the page shows, leaving out those inside a hidden block: the action's own, or the
 * plugin's global ones, which sdpi-components saves apart.
 */
function visibleSettings(page: Page, { global = false } = {}): Promise<string[]> {
  return page.evaluate(`
    [...document.querySelectorAll("[setting]")]
      .filter((control) => !control.closest("[hidden]") && control.hasAttribute("global") === ${global})
      .map((control) => control.getAttribute("setting"))
  `);
}

/** A control as the page declares it: its default, a number field's ends and step, a select's options. */
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

/** A value as a control saves it: a number field as a number, a select as its option's text. */
function saved(control: Control, value: string): JsonValue {
  return control.tag === "litra-number" ? Number(value) : value;
}

/** Reads what a number field shows (#195): its value, then its unit, apart. */
const NUMBER_SHOWN = `(field) => field.querySelector("input").value + " " + field.querySelector(".unit").textContent`;

/** What the number field of a setting shows, its value and its unit. */
function shownValue(page: Page, setting: string): Promise<string> {
  return page.evaluate(`(${NUMBER_SHOWN})(document.querySelector('[setting="${setting}"]'))`);
}

/**
 * Sets a control to `value`, as the user would: a list's choice, or a value typed into a number field and taken with
 * Enter (#195).
 */
function setControl(page: Page, selector: string, value: string): Promise<void> {
  return page.evaluate(`(async () => {
    const host = ${selector};
    if (host.localName === "litra-number") {
      const input = host.querySelector("input");
      input.focus();
      input.value = ${JSON.stringify(value)};
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      return;
    }
    await host.updateComplete;
    const control = host.shadowRoot.querySelector("select, input");
    control.value = ${JSON.stringify(value)};
    control.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    control.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  })()`);
}

/** Presses and lets go of a number field's − or + button, as a pointer does, after holding it for `holdMs`. */
function pressNumberButton(page: Page, selector: string, label: "Lower" | "Raise", holdMs = 0): Promise<void> {
  return page.evaluate(`(async () => {
    const button = ${selector}.querySelector('button[aria-label="${label}"]');
    button.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, ${holdMs}));
    button.dispatchEvent(new PointerEvent("pointerup", { button: 0, bubbles: true }));
  })()`);
}

/** Whether a number field's − and + buttons are greyed out. */
function numberButtonsOf(page: Page, selector: string): Promise<{ lower: boolean; raise: boolean }> {
  return page.evaluate(`(() => {
    const field = ${selector};
    const disabled = (label) => field.querySelector('button[aria-label="' + label + '"]').disabled;
    return { lower: disabled("Lower"), raise: disabled("Raise") };
  })()`);
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
      await expect.poll(() => visibleSettings(page, { global: true })).toEqual([]);
      await page.close();
    });

    it(`sends a changed ${panel.change.setting} to Stream Deck`, async () => {
      const { page, uuid } = await openPanel(panel);
      const { setting, value, saved } = panel.change;
      await setControl(page, `document.querySelector('[setting="${setting}"]')`, value);
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
        control.tag === "litra-number"
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

  const numbers = PANELS.flatMap((panel) => (panel.numbers ?? []).map((number) => ({ ...number, panel })));
  describe.each(numbers)("the $setting number field of $panel.page on $panel.controller (#195)", (number) => {
    const { panel, setting, unit } = number;
    const FIELD = `document.querySelector('[setting="${setting}"]')`;

    /** The values the page saved for the setting after the `after`th message. */
    function savesOf(uuid: string, after: number) {
      return streamDeck.messages
        .slice(after)
        .filter((m) => m.event === "setSettings" && m.context === uuid && m.payload?.[setting] !== undefined)
        .map((m) => m.payload?.[setting]);
    }

    it("ends where settings.ts does", async () => {
      const { page } = await openPanel(panel);
      const control = await controlOf(page, setting);
      await page.close();

      const [min, max, step] = [Number(control.min), Number(control.max), Number(control.step)];
      expect(read(setting, min - step).valid).toBe(false);
      expect(read(setting, max + step).valid).toBe(false);
    });

    it("shows its default value, with its unit inside the field", async () => {
      const { page } = await openPanel(panel);
      await expect.poll(() => shownValue(page, setting)).toBe(`${defaultOf(setting)} ${unit}`);
      await page.close();
    });

    it("shows the saved value", async () => {
      const value = Number(number.value);
      const { page } = await openPanel(panel, { [setting]: value });
      await expect.poll(() => shownValue(page, setting)).toBe(`${value} ${unit}`);
      await page.close();
    });

    it("steps by its step on − and +, greyed out at the ends of its range, and saves once the clicks stop", async () => {
      const { page, uuid } = await openPanel(panel);
      const control = await controlOf(page, setting);
      const [min, max, step] = [Number(control.min), Number(control.max), Number(control.step)];
      await setControl(page, FIELD, String(min));
      await expect.poll(() => numberButtonsOf(page, FIELD)).toEqual({ lower: true, raise: false });

      const after = streamDeck.messages.length;
      await pressNumberButton(page, FIELD, "Raise");
      await pressNumberButton(page, FIELD, "Raise");
      await pressNumberButton(page, FIELD, "Lower");
      await pressNumberButton(page, FIELD, "Raise");

      await expect.poll(() => savesOf(uuid, after)).toEqual([min + 2 * step]);
      expect(await shownValue(page, setting)).toBe(`${min + 2 * step} ${unit}`);

      await setControl(page, FIELD, String(max));
      await expect.poll(() => numberButtonsOf(page, FIELD)).toEqual({ lower: false, raise: true });
      await page.close();
    });

    it("takes a typed value on Enter, snapped to its step and kept within its range", async () => {
      const { page, uuid } = await openPanel(panel);
      const control = await controlOf(page, setting);
      const [min, max, step] = [Number(control.min), Number(control.max), Number(control.step)];

      // A value other than the default, which a field already showing it wouldn't save again.
      const target = min + 2 * step === Number(control.default) ? min + 3 * step : min + 2 * step;
      let after = streamDeck.messages.length;
      await setControl(page, FIELD, String(target + 0.4 * step));
      await expect.poll(() => savesOf(uuid, after)).toEqual([target]);

      after = streamDeck.messages.length;
      await setControl(page, FIELD, String(max + 10 * step));
      await expect.poll(() => savesOf(uuid, after)).toEqual([max]);

      after = streamDeck.messages.length;
      await setControl(page, FIELD, "abc");
      // Long enough for a save, which there mustn't be.
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(savesOf(uuid, after)).toEqual([]);
      expect(await shownValue(page, setting)).toBe(`${max} ${unit}`);
      await page.close();
    });
  });

  describe("a number field held down (#195)", () => {
    const BRIGHTNESS = at(PANELS, 1);
    const FIELD = `document.querySelector('[setting="presetPercentage"]')`;

    it("repeats its step while held, and saves once it's let go", async () => {
      const { page, uuid } = await openPanel(BRIGHTNESS, { presetPercentage: 10 });
      await expect.poll(() => shownValue(page, "presetPercentage")).toBe("10 %");

      const after = streamDeck.messages.length;
      // One step on the press, then one every 80 ms from 400 ms on.
      await pressNumberButton(page, FIELD, "Raise", 700);

      const saves = () =>
        streamDeck.messages
          .slice(after)
          .filter((m) => m.event === "setSettings" && m.context === uuid)
          .map((m) => m.payload?.presetPercentage);
      await expect.poll(() => saves().length).toBe(1);
      const value = Number(at(saves(), 0));
      expect(value).toBeGreaterThanOrEqual(14);
      expect(value).toBeLessThanOrEqual(17);
      expect(await shownValue(page, "presetPercentage")).toBe(`${value} %`);
      await page.close();
    });
  });

  // Every checkbox of sdpi-components that saves a global setting itself, in the plugin settings, on a key's page and a
  // dial's (#145, #146).
  const globalCheckboxes = [at(PANELS, 0), at(PANELS, 2)].flatMap((panel) =>
    PLUGIN_SETTINGS_CHECKBOXES.map((setting) => ({ panel, setting })),
  );
  describe.each(globalCheckboxes)(
    "the global $setting in the plugin settings on $panel.page on $panel.controller",
    ({ panel, setting }) => {
      afterEach(() => {
        streamDeck.globalSettings = {};
      });

      /** Whether the setting's checkbox is checked. */
      function isChecked(page: Page): Promise<boolean> {
        return page.evaluate(`(async () => {
        const host = document.querySelector('[setting="${setting}"]');
        await host.updateComplete;
        return host.shadowRoot.querySelector("input").checked;
      })()`);
      }

      /**
       * Waits for the page to have the global settings, not only to have asked for them: sdpi-components' getter answers
       * once they've arrived, by when the checkboxes show them. Checking a box before then would race the answer, which
       * sdpi-components applies over the click, so the page would save again, late enough to reach the next test.
       */
      async function globalSettingsRead(page: Page): Promise<void> {
        await page.evaluate(`SDPIComponents.useGlobalSettings("${setting}")[0]()`);
      }

      /** Checks the setting's checkbox, as the user would, and returns the global settings the page saves. */
      async function check(page: Page, uuid: string): Promise<unknown> {
        await clickInPluginSettings(page, "Plugin settings");
        await page.evaluate(`(async () => {
        const host = document.querySelector('[setting="${setting}"]');
        await host.updateComplete;
        host.shadowRoot.querySelector("input").click();
      })()`);
        const message = await streamDeck.waitFor((m) => m.event === "setGlobalSettings" && m.context === uuid);
        return message.payload;
      }

      it("shows the default in settings.ts when nothing is saved", async () => {
        const { page } = await openPanel(panel);
        await globalSettingsRead(page);
        const checked = await isChecked(page);
        await page.close();

        expect(checked).toBe(defaultOf(setting));
      });

      it("shows what the global settings hold, whatever the action saved", async () => {
        streamDeck.globalSettings = { [setting]: true };
        const { page } = await openPanel(panel, { [setting]: false });
        await globalSettingsRead(page);
        await expect.poll(() => isChecked(page)).toBe(true);
        await page.close();
      });

      it("saves to the global settings, as settings.ts takes it, and leaves the action's own alone", async () => {
        const { page, uuid } = await openPanel(panel);
        await globalSettingsRead(page);
        const saved = await check(page, uuid);
        // Long enough for a save of the action's own settings to arrive, which there mustn't be.
        await new Promise((resolve) => setTimeout(resolve, 300));
        await page.close();

        expect(saved).toEqual({ [setting]: true });
        expect(read(setting, true)).toEqual({ value: true, valid: true });
        expect(streamDeck.messages.filter((m) => m.event === "setSettings" && m.context === uuid)).toEqual([]);
      });

      it("keeps the other global settings when it saves", async () => {
        const other = Object.keys(globalSettings).find((name) => name !== setting) ?? "";
        streamDeck.globalSettings = { [other]: true };
        const { page, uuid } = await openPanel(panel);
        await globalSettingsRead(page);
        const saved = await check(page, uuid);
        await page.close();

        expect(saved).toEqual({ [other]: true, [setting]: true });
      });
    },
  );

  // What each cell of the lamp screens shows, a list per cell in the plugin settings, on a key's page and a dial's (#177).
  const lampScreenLists = [at(PANELS, 0), at(PANELS, 2)].flatMap((panel) =>
    LAMP_SCREEN_LISTS.map((setting) => ({ panel, setting })),
  );
  describe.each(lampScreenLists)(
    "the global $setting in the plugin settings on $panel.page on $panel.controller",
    ({ panel, setting }) => {
      afterEach(() => {
        streamDeck.globalSettings = {};
      });

      /** Waits for the page to have the global settings, which the list shows once they've arrived. */
      async function globalSettingsRead(page: Page): Promise<void> {
        await page.evaluate(`SDPIComponents.useGlobalSettings("${setting}")[0]()`);
      }

      /** The option the list shows as chosen. */
      function chosen(page: Page): Promise<string> {
        return page.evaluate(`(async () => {
        const host = document.querySelector('[setting="${setting}"]');
        await host.updateComplete;
        return host.shadowRoot.querySelector("select").value;
      })()`);
      }

      it("defaults to its default in settings.ts, and offers every choice it accepts, and only those", async () => {
        const { page } = await openPanel(panel);
        const control = await controlOf(page, setting);
        await globalSettingsRead(page);
        const shown = await chosen(page);
        await page.close();

        expect(read(setting, control.default ?? "")).toEqual({ value: defaultOf(setting), valid: true });
        expect(shown).toBe(defaultOf(setting));
        expect(control.options).toEqual([...LAMP_SCREEN_ITEMS]);
      });

      it("shows what the global settings hold", async () => {
        streamDeck.globalSettings = { [setting]: "none" };
        const { page } = await openPanel(panel);
        await globalSettingsRead(page);
        await expect.poll(() => chosen(page)).toBe("none");
        await page.close();
      });

      it("saves to the global settings, as settings.ts takes it, keeping the others and the action's own", async () => {
        streamDeck.globalSettings = { blinkOnLampScreen: true };
        const { page, uuid } = await openPanel(panel);
        await globalSettingsRead(page);
        await clickInPluginSettings(page, "Plugin settings");
        await page.evaluate(`(async () => {
        const host = document.querySelector('[setting="${setting}"]');
        await host.updateComplete;
        const control = host.shadowRoot.querySelector("select");
        control.value = "power";
        control.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      })()`);
        const message = await streamDeck.waitFor((m) => m.event === "setGlobalSettings" && m.context === uuid);
        // Long enough for a save of the action's own settings to arrive, which there mustn't be.
        await new Promise((resolve) => setTimeout(resolve, 300));
        await page.close();

        expect(message.payload).toEqual({ blinkOnLampScreen: true, [setting]: "power" });
        expect(read(setting, "power")).toEqual({ value: "power", valid: true });
        expect(streamDeck.messages.filter((m) => m.event === "setSettings" && m.context === uuid)).toEqual([]);
      });
    },
  );

  // The lamp screens' text styles in the plugin settings, each style's color, weight and size (#153), with a value each
  // control can save other than its default.
  describe.each(
    Object.keys(TEXT_STYLES).flatMap((style) => [
      { setting: `${style}Color`, value: "#00aaff" },
      { setting: `${style}Weight`, value: "bold" },
      { setting: `${style}Size`, value: "22" },
    ]),
  )("the global $setting in the plugin settings on ui/power.html", ({ setting, value }) => {
    const panel = at(PANELS, 0);

    afterEach(() => {
      streamDeck.globalSettings = {};
    });

    it("defaults to its default in settings.ts, and offers only choices it accepts", async () => {
      const { page } = await openPanel(panel);
      const control = await controlOf(page, setting);
      await page.close();

      expect(read(setting, control.default ?? "")).toEqual({ value: defaultOf(setting), valid: true });
      for (const choice of control.options) {
        expect(read(setting, choice), `${setting} set to ${choice}`).toMatchObject({ valid: true });
      }
    });

    it("saves to the global settings, as settings.ts takes it, keeping the others", async () => {
      streamDeck.globalSettings = { blinkOnLampScreen: true };
      const { page, uuid } = await openPanel(panel);
      await page.evaluate(`SDPIComponents.useGlobalSettings("${setting}")[0]()`);
      await clickInPluginSettings(page, "Plugin settings");
      await page.evaluate(`(async () => {
        const host = document.querySelector('[setting="${setting}"]');
        await host.updateComplete;
        const control = host.shadowRoot.querySelector("select, input");
        control.value = ${JSON.stringify(value)};
        control.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      })()`);
      const message = await streamDeck.waitFor((m) => m.event === "setGlobalSettings" && m.context === uuid);
      await page.close();

      expect(message.payload).toEqual({ blinkOnLampScreen: true, [setting]: value });
      expect(read(setting, value)).toMatchObject({ valid: true });
    });
  });

  it.each(
    Object.entries(TEXT_STYLES).map(([style, { color, weight }]) => ({
      style,
      other: style === "lampScreenPrimary" ? "lampScreenSecondary" : "lampScreenPrimary",
      color,
      weight,
    })),
  )(
    "a text style's Reset saves $style's defaults, and keeps another style (#153)",
    async ({ style, other, color, weight }) => {
      const saved = (name: string) => ({
        [`${name}Color`]: "#ff8800",
        [`${name}Weight`]: "bold",
        [`${name}Size`]: "22",
      });
      streamDeck.globalSettings = { ...saved(style), ...saved(other) };
      const { page } = await openPanel(at(PANELS, 0));
      await page.evaluate(`SDPIComponents.useGlobalSettings("${style}Color")[0]()`);
      await clickInPluginSettings(page, "Plugin settings");
      await page.evaluate(`(async () => {
      const host = document.querySelector('sdpi-button[data-style="${style}"]');
      await host.updateComplete;
      host.shadowRoot.querySelector("button").click();
    })()`);
      await expect
        .poll(() => streamDeck.globalSettings)
        .toEqual({ ...saved(other), [`${style}Color`]: color, [`${style}Weight`]: weight, [`${style}Size`]: "18" });
      await page.close();
      streamDeck.globalSettings = {};

      for (const [setting, value] of Object.entries({ Color: color, Weight: weight, Size: "18" })) {
        expect(read(`${style}${setting}`, value)).toEqual({ value: defaultOf(`${style}${setting}`), valid: true });
      }
    },
  );

  // The editor of each cell's options, which Configure shows in place of the plugin settings (#177).
  describe("the lamp screens' cell editor in the plugin settings on ui/power.html", () => {
    const panel = at(PANELS, 0);

    afterEach(() => {
      streamDeck.globalSettings = {};
    });

    /** Opens the plugin settings, once the global settings have arrived, and the editor of a cell. */
    async function openEditor(cell: string): Promise<OpenedPanel> {
      const opened = await openPanel(panel);
      await opened.page.evaluate(`SDPIComponents.useGlobalSettings("lampScreenOptions")[0]()`);
      await clickInPluginSettings(opened.page, "Plugin settings");
      await opened.page.evaluate(`(async () => {
        const host = document.querySelector('sdpi-button[data-cell="${cell}"]');
        await host.updateComplete;
        host.shadowRoot.querySelector("button").click();
      })()`);
      return opened;
    }

    /** What the page shows: the plugin settings' view, the editor, or neither, and the editor's rows by label. */
    function shown(page: Page): Promise<{ view: boolean; editor: boolean; rows: string[] }> {
      return page.evaluate(`(() => {
        const container = document.getElementById("plugin-settings");
        const [, view, editor] = container.children;
        return {
          view: !view.hidden,
          editor: !editor.hidden,
          rows: [...editor.querySelectorAll("sdpi-item")].map((row) => row.getAttribute("label") ?? ""),
        };
      })()`);
    }

    /** Each option the editor shows, by key, with its value and, for a list, its choices. */
    function optionsShown(page: Page): Promise<Record<string, { value: unknown; choices: string[] }>> {
      return page.evaluate(`(async () => {
        const controls = [...document.querySelectorAll(".cell-editor [data-option]")];
        await Promise.all(controls.map((control) => control.updateComplete));
        return Object.fromEntries(controls.map((control) => [
          control.dataset.option,
          { value: control.value, choices: [...control.querySelectorAll("option")].map((option) => option.value) },
        ]));
      })()`);
    }

    /** Sets an option's control to `value`, as the user would. */
    async function setOption(page: Page, key: string, value: string | boolean): Promise<void> {
      await page.evaluate(`(async () => {
        const host = document.querySelector('.cell-editor [data-option="${key}"]');
        await host.updateComplete;
        const control = host.shadowRoot.querySelector("select, input");
        if (control.type === "checkbox") {
          control.click();
        } else {
          control.value = ${JSON.stringify(value)};
          control.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        }
      })()`);
    }

    /** Reads an item's option as the plugin reads it, and whether it was valid. */
    function readOption(item: keyof typeof lampScreenItemOptions, key: string, value: JsonValue) {
      const schema = lampScreenItemOptions[item] as Record<string, unknown>;
      const warn = vi.fn();
      const parsed = parseSettings({ [key]: value }, { [key]: schema[key] } as never, { warn }) as Record<
        string,
        unknown
      >;
      return { value: parsed[key], valid: warn.mock.calls.length === 0 };
    }

    it("shows in place of the plugin settings, and gives way to them again on Back", async () => {
      const { page } = await openEditor("topLeft");

      expect(await shown(page)).toEqual({
        view: false,
        editor: true,
        rows: ["Cell", "First part", "Second part", "Trim", "Font style", ""],
      });

      await clickInPluginSettings(page, "Back");

      expect(await shown(page)).toMatchObject({ view: true, editor: false });
      await page.close();
    });

    it.each(LAMP_SCREEN_ITEMS.filter((item) => item !== "none"))(
      "offers the options of %s that settings.ts takes, at their defaults",
      async (item) => {
        streamDeck.globalSettings = { lampScreenTopLeft: item };
        const { page } = await openEditor("topLeft");
        const options = await optionsShown(page);
        await page.close();

        const schema = lampScreenItemOptions[item] as Record<string, { default: unknown }>;
        expect(Object.keys(options).sort()).toEqual(Object.keys(schema).sort());
        for (const [key, { value, choices }] of Object.entries(options)) {
          expect(readOption(item, key, value as JsonValue), `${item}'s ${key}`).toEqual({
            value: schema[key]?.default,
            valid: true,
          });
          for (const choice of choices) {
            expect(readOption(item, key, choice), `${item}'s ${key} set to ${choice}`).toMatchObject({ valid: true });
          }
        }
      },
    );

    it("greys out the counter's format for a lamp's number alone, and brings it back for a count", async () => {
      streamDeck.globalSettings = { lampScreenTopRight: "counter" };
      const { page } = await openEditor("topRight");
      const formatDisabled = () =>
        page.evaluate<boolean>(`document.querySelector('.cell-editor [data-option="format"]').disabled`);

      expect(await formatDisabled()).toBe(false);

      await setOption(page, "count", "count");

      await expect.poll(formatDisabled).toBe(true);

      await setOption(page, "count", "countByModel");

      await expect.poll(formatDisabled).toBe(false);
      await page.close();
    });

    it("greys out a power state's color and weight unless its font style is Custom (#153)", async () => {
      streamDeck.globalSettings = { lampScreenTopLeft: "power" };
      const { page } = await openEditor("topLeft");
      const disabled = () =>
        page.evaluate<Record<string, boolean>>(`Object.fromEntries(
          [...document.querySelectorAll(".cell-editor [data-option]")].map((control) => [
            control.dataset.option,
            control.disabled,
          ]),
        )`);

      expect(await disabled()).toEqual({
        onLabel: false,
        onStyle: false,
        onColor: true,
        onWeight: true,
        offLabel: false,
        offStyle: false,
        offColor: true,
        offWeight: true,
      });

      await setOption(page, "offStyle", "custom");

      await expect.poll(disabled).toMatchObject({ onColor: true, onWeight: true, offColor: false, offWeight: false });
      await page.close();
    });

    it("shows that a cell set to None has nothing to configure, and no Reset", async () => {
      streamDeck.globalSettings = { lampScreenMiddleLeft: "none" };
      const { page } = await openEditor("middleLeft");

      expect((await shown(page)).rows).toEqual(["Cell", ""]);
      expect(await optionsShown(page)).toEqual({});
      await page.close();
    });

    it("saves a change to the cell's options for its item, keeping the other cells' and items' options", async () => {
      const others = { topRight: { counter: { count: "count" } }, topLeft: { counter: { format: "slash" } } };
      streamDeck.globalSettings = { blinkOnLampScreen: true, lampScreenOptions: others };
      const { page, uuid } = await openEditor("topLeft");

      await setOption(page, "trim", true);
      const message = await streamDeck.waitFor((m) => m.event === "setGlobalSettings" && m.context === uuid);
      await page.close();

      expect(message.payload).toEqual({
        blinkOnLampScreen: true,
        lampScreenOptions: {
          ...others,
          topLeft: {
            counter: { format: "slash" },
            identification: { first: "model", second: "id", trim: true, style: "primary" },
          },
        },
      });
    });

    it("shows the options saved, and Reset takes them away, keeping the other items' options", async () => {
      streamDeck.globalSettings = {
        lampScreenTopLeft: "power",
        lampScreenOptions: { topLeft: { power: { onLabel: "●", onColor: "#ff8800" }, counter: { count: "count" } } },
      };
      const { page, uuid } = await openEditor("topLeft");

      expect(await optionsShown(page)).toMatchObject({ onLabel: { value: "●" }, onColor: { value: "#ff8800" } });

      await clickInPluginSettings(page, "Reset");
      const message = await streamDeck.waitFor((m) => m.event === "setGlobalSettings" && m.context === uuid);

      expect(message.payload).toEqual({
        lampScreenTopLeft: "power",
        lampScreenOptions: { topLeft: { counter: { count: "count" } } },
      });
      await expect.poll(async () => (await optionsShown(page)).onLabel?.value).toBe("ON");
      await page.close();
    });
  });

  // How long a blink lasts, a number field in the plugin settings (#171, #195), on a page without number fields of its
  // own and on one with them.
  describe.each([at(PANELS, 0), at(PANELS, 2)])(
    "the blink's length in the plugin settings on $page on $controller",
    (panel) => {
      const SETTING = "identifyBlinkMs";

      afterEach(() => {
        streamDeck.globalSettings = {};
      });

      /** Waits for the page to have the global settings, which the field shows once they've arrived. */
      async function globalSettingsRead(page: Page): Promise<void> {
        await page.evaluate(`SDPIComponents.useGlobalSettings("${SETTING}")[0]()`);
      }

      it("defaults to its default in settings.ts, and shows it", async () => {
        const { page } = await openPanel(panel);
        const control = await controlOf(page, SETTING);
        await globalSettingsRead(page);
        const shown = await shownValue(page, SETTING);
        await page.close();

        expect(read(SETTING, saved(control, control.default ?? ""))).toEqual({
          value: defaultOf(SETTING),
          valid: true,
        });
        expect(shown).toBe(`${defaultOf(SETTING)} ms`);
      });

      it("offers only values that settings.ts accepts, and ends where it does", async () => {
        const { page } = await openPanel(panel);
        const control = await controlOf(page, SETTING);
        await page.close();

        const [min, max, step] = [Number(control.min), Number(control.max), Number(control.step)];
        for (let value = min; value <= max; value += step) {
          expect(read(SETTING, value), `${SETTING} set to ${value}`).toMatchObject({ valid: true });
        }
        expect(read(SETTING, min - step).valid).toBe(false);
        expect(read(SETTING, max + step).valid).toBe(false);
      });

      it("shows what the global settings hold", async () => {
        streamDeck.globalSettings = { [SETTING]: 1000 };
        const { page } = await openPanel(panel);
        await globalSettingsRead(page);
        await expect.poll(() => shownValue(page, SETTING)).toBe("1000 ms");
        await page.close();
      });

      it("saves to the global settings, as settings.ts takes it, keeping the others and the action's own", async () => {
        streamDeck.globalSettings = { blinkOnLampScreen: true };
        const { page, uuid } = await openPanel(panel);
        await globalSettingsRead(page);
        await clickInPluginSettings(page, "Plugin settings");
        await setControl(page, `document.querySelector('[setting="${SETTING}"]')`, "900");
        const message = await streamDeck.waitFor((m) => m.event === "setGlobalSettings" && m.context === uuid);
        // Long enough for a save of the action's own settings to arrive, which there mustn't be.
        await new Promise((resolve) => setTimeout(resolve, 300));
        await page.close();

        expect(message.payload).toEqual({ blinkOnLampScreen: true, [SETTING]: 900 });
        expect(read(SETTING, 900)).toEqual({ value: 900, valid: true });
        expect(streamDeck.messages.filter((m) => m.event === "setSettings" && m.context === uuid)).toEqual([]);
      });
    },
  );

  describe.each(PANELS)("the lamp picker of $page on $controller", (panel) => {
    const onKey = panel.controller === "Keypad";

    it(
      onKey ? "shows, and asks the plugin for no lamps (#194)" : "is left out, and asks the plugin for none",
      async () => {
        const { page, uuid } = await openPanel(panel);
        // Long enough for a request the page would send once connected.
        await new Promise((resolve) => setTimeout(resolve, 200));
        const shown = await page.evaluate(`(() => {
        const picker = document.getElementById("lamp-picker");
        return picker !== null && picker.closest("[hidden]") === null;
      })()`);
        await page.close();

        expect(shown).toBe(onKey);
        expect(streamDeck.messages.filter((m) => isLampsRequest(m, uuid))).toHaveLength(0);
      },
    );
  });

  const FIRST: ListedLamp = { id: "0123456789abcdef", label: "Beam - 1111", model: "Beam", serialEnd: "1111" };
  const SECOND: ListedLamp = { id: "fedcba9876543210", label: "Beam LX - 2222", model: "Beam LX", serialEnd: "2222" };

  /** A lamp as a key saves it: its id (#194). */
  function savedLamp({ id }: ListedLamp) {
    return id;
  }

  describe("the lamp picker (#20)", () => {
    const POWER = at(PANELS, 0);

    afterEach(() => {
      streamDeck.lamps = [];
      streamDeck.globalSettings = {};
    });

    /**
     * Opens the Power key's page with the lamps the plugin knows (#194), besides the ones a test gave the global
     * settings, such as named ones, and the key's saved settings, once it lists them.
     */
    async function openPicker(lamps: ListedLamp[], settings: Record<string, unknown> = {}) {
      const given = (streamDeck.globalSettings.lamps as Record<string, KnownLamp> | undefined) ?? {};
      streamDeck.globalSettings = { ...streamDeck.globalSettings, lamps: { ...knowing(...lamps), ...given } };
      const opened = await openPanel(POWER, settings);
      await expect.poll(() => pickerOf(opened.page)).toMatchObject({ all: expect.any(Boolean) });
      return opened;
    }

    /**
     * The lamps the page saves next: the ones checked and the ones left out, which it saves one after the other, so the
     * second save holds both (#147).
     */
    async function nextSave(uuid: string, after = streamDeck.messages.length) {
      const saves = () =>
        streamDeck.messages.filter(
          (m) => m.event === "setSettings" && m.context === uuid && streamDeck.messages.indexOf(m) >= after,
        );
      await expect.poll(() => saves().length).toBeGreaterThanOrEqual(2);
      const payload = at(saves(), -1).payload ?? {};
      return { lamps: payload.lamps, leftOutLamps: payload.leftOutLamps };
    }

    it("lists every lamp the plugin knows, by its label, all checked for a key with no lamps saved", async () => {
      const { page } = await openPicker([FIRST, SECOND]);

      expect(await pickerOf(page)).toEqual({
        lamps: [
          { label: FIRST.label, checked: true },
          { label: SECOND.label, checked: true },
        ],
        all: true,
        notes: [],
        buttons: [],
      });
      // A key with no lamps saved acts on every lamp, settings.ts's default.
      expect(read("lamps", "all", "action")).toEqual({ value: defaultOf("lamps", "action"), valid: true });
      await page.close();
    });

    it("checks the lamps the key has saved, leaves the ones it left out unchecked, and All unchecked", async () => {
      const { page } = await openPicker([FIRST, SECOND], {
        lamps: [savedLamp(SECOND)],
        leftOutLamps: [savedLamp(FIRST)],
      });

      expect(await pickerOf(page)).toMatchObject({
        lamps: [{ checked: false }, { checked: true }],
        all: false,
      });
      await page.close();
    });

    it.each([
      [true, {}],
      [false, { addNewLamps: false }],
    ])(
      "shows a lamp the key hasn't listed yet checked only for a key that adds new lamps (%s, #147)",
      async (adds, globals) => {
        streamDeck.globalSettings = globals;
        const { page } = await openPicker([FIRST, SECOND], { lamps: [savedLamp(SECOND)] });

        await expect.poll(async () => (await pickerOf(page)).lamps.map((lamp) => lamp.checked)).toEqual([adds, true]);
        await page.close();
      },
    );

    it("saves the lamps still checked, and the one left out, when one is unchecked from All", async () => {
      const { page, uuid } = await openPicker([FIRST, SECOND]);

      const after = streamDeck.messages.length;
      await clickInPicker(page, FIRST.label);
      const saved = await nextSave(uuid, after);

      expect(saved).toEqual({ lamps: [savedLamp(SECOND)], leftOutLamps: [savedLamp(FIRST)] });
      expect(read("lamps", saved.lamps as JsonValue, "action")).toEqual({ value: [SECOND.id], valid: true });
      expect(read("leftOutLamps", saved.leftOutLamps as JsonValue)).toEqual({ value: [FIRST.id], valid: true });
      expect(await pickerOf(page)).toMatchObject({ lamps: [{ checked: false }, { checked: true }], all: false });
      await page.close();
    });

    it("saves every lamp listed, and none left out, when All is checked, and checks them all", async () => {
      const { page, uuid } = await openPicker([FIRST, SECOND], {
        lamps: [savedLamp(FIRST)],
        leftOutLamps: [savedLamp(SECOND)],
      });

      const after = streamDeck.messages.length;
      await clickInPicker(page, "All");

      expect(await nextSave(uuid, after)).toEqual({
        lamps: [savedLamp(FIRST), savedLamp(SECOND)],
        leftOutLamps: [],
      });
      expect(await pickerOf(page)).toMatchObject({ lamps: [{ checked: true }, { checked: true }], all: true });
      await page.close();
    });

    it("saves no lamp, and every lamp listed as left out, when All is unchecked", async () => {
      const { page, uuid } = await openPicker([FIRST, SECOND]);

      const after = streamDeck.messages.length;
      await clickInPicker(page, "All");

      expect(await nextSave(uuid, after)).toEqual({
        lamps: [],
        leftOutLamps: [savedLamp(FIRST), savedLamp(SECOND)],
      });
      await page.close();
    });

    it("checks All once every lamp is checked one by one", async () => {
      const { page, uuid } = await openPicker([FIRST, SECOND], {
        lamps: [savedLamp(FIRST)],
        leftOutLamps: [savedLamp(SECOND)],
      });

      const after = streamDeck.messages.length;
      await clickInPicker(page, SECOND.label);

      expect(await nextSave(uuid, after)).toEqual({
        lamps: [savedLamp(FIRST), savedLamp(SECOND)],
        leftOutLamps: [],
      });
      expect(await pickerOf(page)).toMatchObject({ all: true });
      await page.close();
    });

    it("leaves out a saved lamp the plugin doesn't know, and keeps it checked in what it saves (#194)", async () => {
      const { page, uuid } = await openPicker([FIRST], { lamps: [savedLamp(FIRST), savedLamp(SECOND)] });

      expect(await pickerOf(page)).toMatchObject({ lamps: [{ label: FIRST.label, checked: true }], all: true });

      const after = streamDeck.messages.length;
      await clickInPicker(page, FIRST.label);

      expect(await nextSave(uuid, after)).toEqual({ lamps: [savedLamp(SECOND)], leftOutLamps: [savedLamp(FIRST)] });
      await page.close();
    });

    it("leaves out a lamp the plugin doesn't know that the key left out, and keeps it left out (#147, #194)", async () => {
      const { page, uuid } = await openPicker([FIRST], {
        lamps: [savedLamp(FIRST)],
        leftOutLamps: [savedLamp(SECOND)],
      });

      expect(await pickerOf(page)).toMatchObject({ lamps: [{ label: FIRST.label, checked: true }], all: true });

      const after = streamDeck.messages.length;
      await clickInPicker(page, FIRST.label);

      expect(await nextSave(uuid, after)).toEqual({ lamps: [], leftOutLamps: [savedLamp(FIRST), savedLamp(SECOND)] });
      await page.close();
    });

    it("says so when the plugin knows no lamp", async () => {
      const { page } = await openPicker([]);

      expect(await pickerOf(page)).toEqual({ lamps: [], all: true, notes: ["No lamps found"], buttons: [] });
      await page.close();
    });

    it("shows a named lamp by its name, and saves it by its id (#146)", async () => {
      streamDeck.globalSettings = {
        lamps: { [FIRST.id]: known(FIRST, "Left"), [SECOND.id]: known(SECOND, "Key light") },
      };
      const { page, uuid } = await openPicker([], {
        lamps: [savedLamp(SECOND)],
        leftOutLamps: [savedLamp(FIRST)],
      });

      expect(await pickerOf(page)).toMatchObject({
        lamps: [
          { label: "Left", checked: false },
          { label: "Key light", checked: true },
        ],
      });

      const after = streamDeck.messages.length;
      await clickInPicker(page, "Left");

      expect(await nextSave(uuid, after)).toEqual({
        lamps: [savedLamp(FIRST), savedLamp(SECOND)],
        leftOutLamps: [],
      });
      await page.close();
    });

    it("shows a lamp by its label when its saved name isn't text", async () => {
      streamDeck.globalSettings = {
        lamps: { [FIRST.id]: { model: FIRST.model, serialEnd: FIRST.serialEnd, name: 7 } },
      };
      const { page } = await openPicker([FIRST]);

      await expect.poll(async () => (await pickerOf(page)).lamps.map((lamp) => lamp.label)).toEqual([FIRST.label]);
      await page.close();
    });
  });

  describe.each(PANELS)("the lamp screens' blink on $page on $controller (#144)", (panel) => {
    const onDial = panel.controller === "Encoder";

    it(onDial ? "shows the dial's own checkbox" : "shows no dial's checkbox", async () => {
      const { page } = await openPanel(panel);
      // Long enough for the page to know where its action sits.
      await new Promise((resolve) => setTimeout(resolve, 200));
      const shown = await dialBlinkOf(page);
      await page.close();

      expect(shown).toMatchObject(
        onDial ? { shown: true, label: "Blink each lamp as it's shown, on this dial" } : { shown: false },
      );
    });
  });

  describe.each(PANELS)("whether a key adds new lamps, on $page on $controller (#147)", (panel) => {
    const onKey = panel.controller === "Keypad";

    it(onKey ? "shows the key's own checkbox, under its lamps" : "shows no key's checkbox", async () => {
      const { page } = await openPanel(panel);
      // Long enough for the page to know where its action sits.
      await new Promise((resolve) => setTimeout(resolve, 200));
      const shown = await keyNewLampsOf(page);
      await page.close();

      expect(shown).toMatchObject(
        onKey ? { shown: true, label: "Add new lamps automatically, on this key" } : { shown: false },
      );
    });
  });

  describe("whether keys add new lamps (#147)", () => {
    const KEY = at(PANELS, 0);
    const NEW_CONTEXT = "0123456789abcdef0123456789abcdef";
    const EVERY_KEY = "Add new lamps automatically, on every key";

    afterEach(() => {
      streamDeck.lamps = [];
      streamDeck.globalSettings = {};
    });

    /** Opens a key's page, with its saved settings, once it shows whether the key adds new lamps. */
    async function openKey(context?: string, settings: Record<string, unknown> = {}) {
      const opened = await openPanel(KEY, settings, context);
      await opened.page.evaluate(`Promise.all([
        SDPIComponents.useGlobalSettings("addNewLamps")[0](),
        SDPIComponents.useGlobalSettings("addNewLampsExceptions")[0](),
      ])`);
      await expect.poll(() => keyNewLampsOf(opened.page)).toMatchObject({ shown: true });
      return opened;
    }

    it.each([
      ["checked, settings.ts's default, when nothing is saved", {}, undefined, true],
      ["the plugin's setting, for a key that made no choice of its own", { addNewLamps: false }, undefined, false],
      [
        "the opposite of the plugin's setting, for a key that chose otherwise",
        { addNewLampsExceptions: [NEW_CONTEXT] },
        NEW_CONTEXT,
        false,
      ],
    ])("shows a key's own %s", async (_, saved, context, checked) => {
      streamDeck.globalSettings = saved;
      const { page } = await openKey(context);

      await expect.poll(() => keyNewLampsOf(page)).toMatchObject({ checked });
      expect(read("addNewLamps", true)).toEqual({ value: defaultOf("addNewLamps"), valid: true });
      await page.close();
    });

    it("saves a click on a key's own as the key's choice, keeping the other global settings, and not the key's", async () => {
      streamDeck.globalSettings = { keepBrightnessDifference: true };
      const { page, uuid, context } = await openKey();

      await clickKeyNewLamps(page);

      await expect
        .poll(() => streamDeck.globalSettings)
        .toEqual({ keepBrightnessDifference: true, addNewLampsExceptions: [context] });
      expect(await keyNewLampsOf(page)).toMatchObject({ checked: false });
      expect(read("addNewLampsExceptions", [context])).toEqual({ value: [context], valid: true });
      expect(streamDeck.messages.filter((m) => m.event === "setSettings" && m.context === uuid)).toEqual([]);
      await page.close();
    });

    it.each([
      ["checked, settings.ts's default, when nothing is saved", {}, "true"],
      ["indeterminate when a key differs", { addNewLampsExceptions: ["a-key"] }, "mixed"],
    ])("shows every key's in the plugin settings %s", async (_, saved, shown) => {
      streamDeck.globalSettings = saved;
      const { page } = await openKey();
      await clickInPluginSettings(page, "Plugin settings");

      expect(await page.evaluate(`${triState(EVERY_KEY)}.getAttribute("aria-checked")`)).toBe(shown);
      await page.close();
    });

    it("saves a click on every key's, which turns it off for every key from checked", async () => {
      streamDeck.globalSettings = { addNewLampsExceptions: [] };
      const { page } = await openKey();
      await clickInPluginSettings(page, "Plugin settings");

      await page.evaluate(`${triState(EVERY_KEY)}.click()`);

      await expect.poll(() => streamDeck.globalSettings).toEqual({ addNewLamps: false, addNewLampsExceptions: [] });
      await page.close();
    });

    it("unchecks a lamp the key hasn't listed yet in the lamp picker once the key's own is unchecked", async () => {
      streamDeck.globalSettings = { lamps: knowing(FIRST, SECOND) };
      const { page } = await openKey(undefined, { lamps: [savedLamp(SECOND)] });
      await expect.poll(async () => (await pickerOf(page)).lamps.map((lamp) => lamp.checked)).toEqual([true, true]);

      await clickKeyNewLamps(page);

      await expect.poll(async () => (await pickerOf(page)).lamps.map((lamp) => lamp.checked)).toEqual([false, true]);
      await page.close();
    });
  });

  describe("the scene's groups (#174)", () => {
    const SCENE = PANELS.find((panel) => panel.page === "ui/scene.html") as Panel;
    const NEW_GROUP = { power: "on", presetPercentage: 0, presetKelvin: 2700, lamps: [] };
    // A first group that holds none of the lamps, which leaves them free for the groups added after it.
    const FIRST_HOLDS_NONE = { lamps: [], leftOutLamps: [savedLamp(FIRST), savedLamp(SECOND)] };

    afterEach(() => {
      streamDeck.lamps = [];
      streamDeck.globalSettings = {};
    });

    /** Opens the Scene key's page with the lamps the plugin knows and the key's saved settings, once it lists them. */
    async function openScene(settings: Record<string, unknown> = {}) {
      streamDeck.globalSettings = { ...streamDeck.globalSettings, lamps: knowing(FIRST, SECOND) };
      const opened = await openPanel(SCENE, settings);
      await expect.poll(() => pickerOf(opened.page)).toMatchObject({ all: expect.any(Boolean) });
      await opened.page.evaluate(`SDPIComponents.useSettings("addedGroups")[0]()`);
      return opened;
    }

    /** The groups the page saves next, once a change is made after `after`. */
    async function nextGroups(uuid: string, after: number) {
      const saves = () =>
        streamDeck.messages.filter(
          (m) =>
            m.event === "setSettings" &&
            m.context === uuid &&
            streamDeck.messages.indexOf(m) >= after &&
            m.payload?.addedGroups !== undefined,
        );
      await expect.poll(() => saves().length).toBeGreaterThanOrEqual(1);
      return at(saves(), -1).payload?.addedGroups as Record<string, unknown>[];
    }

    /** Reads a group as the plugin reads it, and whether every one of its settings was valid. */
    function readGroup(group: Record<string, unknown>) {
      const warn = vi.fn();
      return {
        value: parseSettings(group as never, sceneGroupSettings, { warn }),
        valid: warn.mock.calls.length === 0,
      };
    }

    it("shows the first group alone, without a heading, and a button that adds a group, for a key with none added", async () => {
      const { page } = await openScene();

      expect(await groupsOf(page)).toEqual({ firstHeading: false, firstPresets: true, groups: [], add: true });
      expect(read("addedGroups", [])).toEqual({ value: defaultOf("addedGroups"), valid: true });
      await page.close();
    });

    it.each([
      ["on", true],
      ["off", false],
    ])("shows the first group's presets only while it turns its lamps on (%s)", async (power, shown) => {
      const { page } = await openScene({ power });

      await expect.poll(async () => (await groupsOf(page)).firstPresets).toBe(shown);
      expect(await visibleSettings(page)).toEqual(shown ? ["power", "presetPercentage", "presetKelvin"] : ["power"]);
      await page.close();
    });

    it("adds a group, on at settings.ts's defaults with no lamps, saves it, and numbers it after the first", async () => {
      const { page, uuid } = await openScene();

      const after = streamDeck.messages.length;
      await clickInGroups(page, "Add a group");
      const saved = await nextGroups(uuid, after);

      expect(saved).toEqual([NEW_GROUP]);
      expect(readGroup(at(saved, 0))).toEqual({
        value: { power: "on", presetPercentage: 0, presetKelvin: 2700, lamps: [] },
        valid: true,
      });
      expect(Object.values(sceneGroupSettings).map((setting) => setting.default)).toEqual(["on", 0, 2700, []]);
      expect(await groupsOf(page)).toMatchObject({
        firstHeading: true,
        groups: [{ heading: "Group 2", power: "on", presets: true, remove: "Remove group 2" }],
      });
      await page.close();
    });

    it("shows a saved group's power and lamps, and hides its presets while it turns its lamps off", async () => {
      const { page } = await openScene({
        ...FIRST_HOLDS_NONE,
        addedGroups: [{ power: "off", presetPercentage: 40, presetKelvin: 5000, lamps: [savedLamp(SECOND)] }],
      });

      await expect
        .poll(async () => (await groupsOf(page)).groups)
        .toEqual([
          {
            heading: "Group 2",
            power: "off",
            presets: false,
            brightness: "40 %",
            temperature: "5000 K",
            lamps: [
              { label: FIRST.label, checked: false, disabled: false, note: null },
              { label: SECOND.label, checked: true, disabled: false, note: null },
            ],
            remove: "Remove group 2",
          },
        ]);
      await page.close();
    });

    it("saves a group's power and presets as settings.ts takes them", async () => {
      const { page, uuid } = await openScene({ addedGroups: [NEW_GROUP] });

      let after = streamDeck.messages.length;
      await setGroupControl(page, 2, "Power", "off");
      expect(await nextGroups(uuid, after)).toEqual([{ ...NEW_GROUP, power: "off" }]);
      await expect.poll(async () => at((await groupsOf(page)).groups, 0).presets).toBe(false);

      await setGroupControl(page, 2, "Power", "on");
      after = streamDeck.messages.length;
      await setGroupControl(page, 2, "Brightness", "40");
      await nextGroups(uuid, after);
      after = streamDeck.messages.length;
      await setGroupControl(page, 2, "Temperature", "5000");
      const saved = await nextGroups(uuid, after);

      expect(saved).toEqual([{ ...NEW_GROUP, presetPercentage: 40, presetKelvin: 5000 }]);
      expect(readGroup(at(saved, 0))).toMatchObject({ valid: true });
      expect(await groupsOf(page)).toMatchObject({ groups: [{ brightness: "40 %", temperature: "5000 K" }] });
      await page.close();
    });

    it("keeps a group's controls in place when one changes, so the page doesn't scroll as new ones are drawn", async () => {
      const { page, uuid } = await openScene({ ...FIRST_HOLDS_NONE, addedGroups: [NEW_GROUP] });
      await page.evaluate(`document.querySelector("#added-groups .group litra-number").dataset.kept = "yes"`);

      for (const [label, value] of [
        ["Brightness", "40"],
        ["Power", "off"],
      ] as const) {
        const after = streamDeck.messages.length;
        await setGroupControl(page, 2, label, value);
        await nextGroups(uuid, after);
      }
      const after = streamDeck.messages.length;
      await clickInGroups(page, FIRST.label, 2);
      await nextGroups(uuid, after);
      // Long enough for the saved groups to come back from Stream Deck, which mustn't draw them again either.
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(await page.evaluate(`document.querySelector("#added-groups .group litra-number").dataset.kept`)).toBe(
        "yes",
      );
      await page.close();
    });

    it("saves a lamp checked in a group, and greys it out in the first group's lamp picker, with its group", async () => {
      const { page, uuid } = await openScene({ ...FIRST_HOLDS_NONE, addedGroups: [NEW_GROUP] });

      const after = streamDeck.messages.length;
      await clickInGroups(page, FIRST.label, 2);
      const saved = await nextGroups(uuid, after);

      expect(saved).toEqual([{ ...NEW_GROUP, lamps: [savedLamp(FIRST)] }]);
      expect(readGroup(at(saved, 0)).value.lamps).toEqual([FIRST.id]);
      await expect
        .poll(() => pickerRowsOf(page))
        .toEqual([
          { label: FIRST.label, checked: false, disabled: true, note: "in group 2" },
          { label: SECOND.label, checked: false, disabled: false, note: null },
        ]);
      await page.close();
    });

    it("greys out the first group's lamps in the groups added after it, and frees one once it's unchecked there", async () => {
      const { page } = await openScene({ lamps: [savedLamp(FIRST), savedLamp(SECOND)], addedGroups: [NEW_GROUP] });

      await expect
        .poll(async () => at((await groupsOf(page)).groups, 0).lamps)
        .toEqual([
          { label: FIRST.label, checked: false, disabled: true, note: "in group 1" },
          { label: SECOND.label, checked: false, disabled: true, note: "in group 1" },
        ]);

      await clickInPicker(page, FIRST.label);

      await expect
        .poll(async () => at((await groupsOf(page)).groups, 0).lamps)
        .toEqual([
          { label: FIRST.label, checked: false, disabled: false, note: null },
          { label: SECOND.label, checked: false, disabled: true, note: "in group 1" },
        ]);
      await page.close();
    });

    it("greys out every lamp in the groups added after the first, for a first group that has every lamp", async () => {
      const { page } = await openScene({ addedGroups: [NEW_GROUP] });

      await expect
        .poll(async () => at((await groupsOf(page)).groups, 0).lamps.map((lamp) => lamp.note))
        .toEqual(["in group 1", "in group 1"]);
      await page.close();
    });

    it("greys out a lamp another group holds, with its group, and leaves the others free", async () => {
      const { page } = await openScene({
        ...FIRST_HOLDS_NONE,
        addedGroups: [{ ...NEW_GROUP, lamps: [savedLamp(FIRST)] }, NEW_GROUP],
      });

      await expect
        .poll(async () => at((await groupsOf(page)).groups, 1).lamps)
        .toEqual([
          { label: FIRST.label, checked: false, disabled: true, note: "in group 2" },
          { label: SECOND.label, checked: false, disabled: false, note: null },
        ]);
      await page.close();
    });

    it("keeps what the first group saved for a lamp a group holds, and All covers the others", async () => {
      const { page, uuid } = await openScene({ addedGroups: [{ ...NEW_GROUP, lamps: [savedLamp(FIRST)] }] });
      await expect.poll(async () => (await pickerOf(page)).all).toBe(true);

      const after = streamDeck.messages.length;
      await clickInPicker(page, "All");
      const saves = () =>
        streamDeck.messages.filter(
          (m) => m.event === "setSettings" && m.context === uuid && streamDeck.messages.indexOf(m) >= after,
        );
      await expect.poll(() => saves().length).toBeGreaterThanOrEqual(2);
      const payload = at(saves(), -1).payload ?? {};

      expect({ lamps: payload.lamps, leftOutLamps: payload.leftOutLamps }).toEqual({
        lamps: [savedLamp(FIRST)],
        leftOutLamps: [savedLamp(SECOND)],
      });
      await page.close();
    });

    it("leaves out a lamp the plugin doesn't know that a group checked, and keeps it in what it saves (#194)", async () => {
      const gone = "aaaaaaaaaaaaaaaa";
      const { page, uuid } = await openScene({ ...FIRST_HOLDS_NONE, addedGroups: [{ ...NEW_GROUP, lamps: [gone] }] });

      await expect
        .poll(async () => at((await groupsOf(page)).groups, 0).lamps)
        .toEqual([
          { label: FIRST.label, checked: false, disabled: false, note: null },
          { label: SECOND.label, checked: false, disabled: false, note: null },
        ]);

      const after = streamDeck.messages.length;
      await clickInGroups(page, FIRST.label, 2);

      expect(await nextGroups(uuid, after)).toEqual([{ ...NEW_GROUP, lamps: [gone, FIRST.id] }]);
      await page.close();
    });

    it("removes a group, numbers the ones after it again, and frees its lamps in the first group's picker", async () => {
      const { page, uuid } = await openScene({
        addedGroups: [
          { ...NEW_GROUP, lamps: [savedLamp(FIRST)] },
          { ...NEW_GROUP, lamps: [savedLamp(SECOND)] },
        ],
      });
      await expect.poll(async () => (await groupsOf(page)).groups.length).toBe(2);

      const after = streamDeck.messages.length;
      await clickInGroups(page, "Remove group 2");
      const saved = await nextGroups(uuid, after);

      expect(saved).toEqual([{ ...NEW_GROUP, lamps: [savedLamp(SECOND)] }]);
      expect(await groupsOf(page)).toMatchObject({
        groups: [{ heading: "Group 2", lamps: [{ checked: false }, { checked: true }] }],
      });
      expect(await pickerRowsOf(page)).toEqual([
        { label: FIRST.label, checked: true, disabled: false, note: null },
        { label: SECOND.label, checked: false, disabled: true, note: "in group 2" },
      ]);
      await page.close();
    });
  });

  describe("the lamp screens' blink (#144)", () => {
    const KEY = at(PANELS, 0);
    const DIAL = at(PANELS, 2);
    const NEW_CONTEXT = "0123456789abcdef0123456789abcdef";

    afterEach(() => {
      streamDeck.globalSettings = {};
    });

    /** Opens a page once it shows the blink as the global settings hold it. */
    async function openBlink(panel: Panel, context?: string) {
      const opened = await openPanel(panel, {}, context);
      await opened.page.evaluate(`Promise.all([
        SDPIComponents.useGlobalSettings("blinkOnLampScreen")[0](),
        SDPIComponents.useGlobalSettings("blinkOnLampScreenExceptions")[0](),
      ])`);
      if (panel.controller === "Encoder") {
        await expect.poll(() => dialBlinkOf(opened.page)).toMatchObject({ shown: true });
      }
      return opened;
    }

    /** Opens the plugin settings on a page, and returns what every dial's checkbox shows. */
    async function openEveryDialBlink(page: Page): Promise<string | null> {
      await clickInPluginSettings(page, "Plugin settings");
      return everyDialBlinkOf(page);
    }

    it("shows a dial's own as the plugin's setting, for a dial that made no choice of its own", async () => {
      streamDeck.globalSettings = { blinkOnLampScreen: true, blinkOnLampScreenExceptions: ["other-dial"] };
      const { page } = await openBlink(DIAL);

      expect(await dialBlinkOf(page)).toMatchObject({ checked: true });
      await page.close();
    });

    it.each([true, false])(
      "shows a dial's own as the opposite of the plugin's setting, %s, for a dial that chose otherwise",
      async (blink) => {
        streamDeck.globalSettings = { blinkOnLampScreen: blink, blinkOnLampScreenExceptions: [NEW_CONTEXT] };
        const { page } = await openBlink(DIAL, NEW_CONTEXT);

        expect(await dialBlinkOf(page)).toMatchObject({ checked: !blink });
        await page.close();
      },
    );

    it("saves a click on a dial's own as the dial's choice, keeping the other global settings, and a second click takes it back", async () => {
      streamDeck.globalSettings = { keepBrightnessDifference: true };
      const { page, uuid, context } = await openBlink(DIAL);

      await clickDialBlink(page);

      await expect
        .poll(() => streamDeck.globalSettings)
        .toEqual({
          keepBrightnessDifference: true,
          blinkOnLampScreenExceptions: [context],
        });
      expect(await dialBlinkOf(page)).toMatchObject({ checked: true });
      expect(read("blinkOnLampScreenExceptions", [context])).toEqual({ value: [context], valid: true });

      await clickDialBlink(page);

      await expect
        .poll(() => streamDeck.globalSettings)
        .toEqual({
          keepBrightnessDifference: true,
          blinkOnLampScreenExceptions: [],
        });
      expect(await dialBlinkOf(page)).toMatchObject({ checked: false });
      expect(streamDeck.messages.filter((m) => m.event === "setSettings" && m.context === uuid)).toEqual([]);
      await page.close();
    });

    it.each([
      ["unchecked, settings.ts's default, when nothing is saved", {}, "false"],
      ["checked when every dial blinks", { blinkOnLampScreen: true, blinkOnLampScreenExceptions: [] }, "true"],
      [
        "indeterminate when a dial doesn't",
        { blinkOnLampScreen: true, blinkOnLampScreenExceptions: ["a-dial"] },
        "mixed",
      ],
      [
        "indeterminate when a dial does",
        { blinkOnLampScreen: false, blinkOnLampScreenExceptions: ["a-dial"] },
        "mixed",
      ],
    ])("shows every dial's in the plugin settings %s", async (_, saved, shown) => {
      streamDeck.globalSettings = saved;
      const { page } = await openBlink(KEY);

      expect(await openEveryDialBlink(page)).toBe(shown);
      expect(read("blinkOnLampScreen", false)).toEqual({ value: defaultOf("blinkOnLampScreen"), valid: true });
      await page.close();
    });

    it.each([
      ["indeterminate turns it on", { blinkOnLampScreen: false, blinkOnLampScreenExceptions: ["a-dial"] }, true],
      ["indeterminate keeps it on", { blinkOnLampScreen: true, blinkOnLampScreenExceptions: ["a-dial"] }, true],
      ["checked turns it off", { blinkOnLampScreen: true }, false],
      ["unchecked turns it on", {}, true],
    ])(
      "saves a click on every dial's, where %s for every dial, keeping the other global settings",
      async (_, saved, blink) => {
        streamDeck.globalSettings = { keepTemperatureDifference: true, ...saved };
        const { page } = await openBlink(KEY);
        await openEveryDialBlink(page);

        await clickEveryDialBlink(page);

        await expect
          .poll(() => streamDeck.globalSettings)
          .toEqual({
            keepTemperatureDifference: true,
            blinkOnLampScreen: blink,
            blinkOnLampScreenExceptions: [],
          });
        expect(await everyDialBlinkOf(page)).toBe(String(blink));
        await page.close();
      },
    );

    it("keeps every dial's and the dial's own in step on a dial's page", async () => {
      streamDeck.globalSettings = { blinkOnLampScreen: true, blinkOnLampScreenExceptions: [NEW_CONTEXT] };
      const { page } = await openBlink(DIAL, NEW_CONTEXT);
      expect(await dialBlinkOf(page)).toMatchObject({ checked: false });

      expect(await openEveryDialBlink(page)).toBe("mixed");
      await clickEveryDialBlink(page);
      await clickInPluginSettings(page, "Back");

      expect(await dialBlinkOf(page)).toMatchObject({ checked: true });

      await clickDialBlink(page);

      expect(await openEveryDialBlink(page)).toBe("mixed");
      await page.close();
    });
  });

  describe.each(PANELS)("the plugin settings of $page on $controller (#146)", (panel) => {
    it("start closed, behind a Plugin settings button at the top of the page", async () => {
      const { page } = await openPanel(panel);
      await expect.poll(() => pluginSettingsOf(page)).toMatchObject({ buttons: ["Plugin settings"] });

      expect(await pluginSettingsOf(page)).toEqual({
        first: true,
        open: false,
        actionShown: true,
        buttons: ["Plugin settings"],
        lamps: [],
        notes: [],
      });
      await page.close();
    });

    it("show in place of the action's settings, and give way to them again on Back", async () => {
      streamDeck.globalSettings = { lamps: { [FIRST.id]: known(FIRST) } };
      const { page } = await openPanel(panel);

      await clickInPluginSettings(page, "Plugin settings");
      await expect.poll(() => pluginSettingsOf(page)).toMatchObject({ lamps: [{ serialEnd: FIRST.serialEnd }] });
      expect(await pluginSettingsOf(page)).toMatchObject({
        open: true,
        actionShown: false,
        // A Configure button under each of the lamp screens' cells (#177), and a Reset button under each text style
        // (#153).
        buttons: [
          "Back",
          "Find lamps",
          "Identify",
          `Forget ${FIRST.label}`,
          ...LAMP_SCREEN_LISTS.map(() => "Configure"),
          ...Object.keys(TEXT_STYLES).map(() => "Reset"),
        ],
      });
      expect(await shownGlobalSettings(page)).toEqual(PLUGIN_SETTINGS_GLOBALS);

      await clickInPluginSettings(page, "Back");
      expect(await pluginSettingsOf(page)).toMatchObject({
        open: false,
        actionShown: true,
        buttons: ["Plugin settings"],
      });
      expect(await shownGlobalSettings(page)).toEqual([]);
      streamDeck.globalSettings = {};
      await page.close();
    });
  });

  describe("the plugin settings (#146)", () => {
    const POWER = at(PANELS, 0);

    afterEach(() => {
      streamDeck.lamps = [];
      streamDeck.globalSettings = {};
    });

    /**
     * Opens the Power key's page with the lamps the plugin knows (#194) and the ones it finds, then its plugin settings,
     * once they list the ones it knows.
     */
    async function openPluginSettings(knows: Record<string, unknown>, finds: ListedLamp[] = []) {
      streamDeck.globalSettings = { ...streamDeck.globalSettings, lamps: knows };
      streamDeck.lamps = finds;
      const opened = await openPanel(POWER);
      await clickInPluginSettings(opened.page, "Plugin settings");
      await expect.poll(async () => (await pluginSettingsOf(opened.page)).lamps.length).toBe(Object.keys(knows).length);
      return opened;
    }

    /** The messages the page sent the plugin with this event, after the `after`th message. */
    function sentToPlugin(uuid: string, event: string, after = 0) {
      return streamDeck.messages
        .slice(after)
        .filter((m) => m.event === "sendToPlugin" && m.context === uuid && m.payload?.event === event);
    }

    it("list every lamp the plugin knows by the end of its serial, its model and its name, without looking for lamps (#194)", async () => {
      const { page, uuid } = await openPluginSettings({
        [FIRST.id]: known(FIRST),
        [SECOND.id]: known(SECOND, "Key light"),
      });

      expect(await pluginSettingsOf(page)).toMatchObject({
        headers: ["ID", "Model", "Name", "", ""],
        lamps: [
          {
            serialEnd: "1111",
            model: "Beam",
            name: "",
            placeholder: FIRST.label,
            maxLength: "24",
            identify: true,
            forget: `Forget ${FIRST.label}`,
            missing: false,
          },
          {
            serialEnd: "2222",
            model: "Beam LX",
            name: "Key light",
            placeholder: SECOND.label,
            maxLength: "24",
            identify: true,
            forget: "Forget Key light",
            missing: false,
          },
        ],
        notes: [],
      });
      expect(streamDeck.messages.filter((m) => isLampsRequest(m, uuid))).toHaveLength(0);
      await page.close();
    });

    it("ask the plugin to name a lamp as it's typed, save no global settings, and show the name in the lamp picker", async () => {
      const { page, uuid } = await openPluginSettings(
        { [FIRST.id]: known(FIRST), [SECOND.id]: known(SECOND, "Key light") },
        [FIRST, SECOND],
      );

      const after = streamDeck.messages.length;
      await typeName(page, FIRST.serialEnd, "  Left ");

      await expect
        .poll(() => sentToPlugin(uuid, "rename", after).map((m) => m.payload))
        .toEqual([{ event: "rename", id: FIRST.id, name: "  Left " }]);
      expect(streamDeck.messages.slice(after).filter((m) => m.event === "setGlobalSettings")).toEqual([]);
      await clickInPluginSettings(page, "Back");
      await expect
        .poll(async () => (await pickerOf(page)).lamps.map((lamp) => lamp.label))
        .toEqual(["Left", "Key light"]);
      await page.close();
    });

    it("ask the plugin to take a name away when its field is emptied, and show the lamp by its label again", async () => {
      const { page, uuid } = await openPluginSettings(
        { [FIRST.id]: known(FIRST, "Left"), [SECOND.id]: known(SECOND, "Key light") },
        [FIRST, SECOND],
      );

      const after = streamDeck.messages.length;
      await typeName(page, FIRST.serialEnd, " ");

      await expect
        .poll(() => sentToPlugin(uuid, "rename", after).map((m) => m.payload))
        .toEqual([{ event: "rename", id: FIRST.id, name: " " }]);
      await clickInPluginSettings(page, "Back");
      await expect
        .poll(async () => (await pickerOf(page)).lamps.map((lamp) => lamp.label))
        .toEqual([FIRST.label, "Key light"]);
      await page.close();
    });

    it("ask the plugin to blink a lamp on its Identify button", async () => {
      const { page, uuid } = await openPluginSettings({ [FIRST.id]: known(FIRST), [SECOND.id]: known(SECOND) });

      await clickInPluginSettings(page, "Identify", SECOND.serialEnd);
      const message = await streamDeck.waitFor(
        (m) => m.event === "sendToPlugin" && m.context === uuid && m.payload?.event === "identify",
      );

      expect(message.payload).toEqual({ event: "identify", id: SECOND.id });
      await page.close();
    });

    it("ask the plugin to forget a lamp on its trash can, and list the lamps it knows then (#194)", async () => {
      const { page, uuid } = await openPluginSettings({
        [FIRST.id]: known(FIRST),
        [SECOND.id]: known(SECOND, "Key light"),
      });

      await clickInPluginSettings(page, "Forget Key light", SECOND.serialEnd);

      await expect
        .poll(() => sentToPlugin(uuid, "forget").map((m) => m.payload))
        .toEqual([{ event: "forget", id: SECOND.id }]);
      await expect
        .poll(async () => (await pluginSettingsOf(page)).lamps.map((lamp) => lamp.serialEnd))
        .toEqual([FIRST.serialEnd]);
      await page.close();
    });

    it("ask the plugin to find the lamps on Find lamps, list the ones it adds, and mark the ones it didn't find, in a column of one width", async () => {
      const { page, uuid } = await openPluginSettings({ [FIRST.id]: known(FIRST) });
      const identifyWidth = () => page.evaluate(`document.querySelector("#plugin-settings td.identify").offsetWidth`);
      const before = await identifyWidth();

      streamDeck.lamps = [SECOND];
      await clickInPluginSettings(page, "Find lamps");

      await expect
        .poll(async () =>
          (await pluginSettingsOf(page)).lamps.map(({ serialEnd, identify, missing }) => ({
            serialEnd,
            identify,
            missing,
          })),
        )
        .toEqual([
          { serialEnd: FIRST.serialEnd, identify: false, missing: true },
          { serialEnd: SECOND.serialEnd, identify: true, missing: false },
        ]);
      expect((await pluginSettingsOf(page)).notes).toEqual(["Not found"]);
      // Identify and "Not found" share their place, so the column keeps its width whichever shows.
      expect(await identifyWidth()).toBe(before);
      // Only on Find lamps.
      expect(streamDeck.messages.filter((m) => isLampsRequest(m, uuid))).toHaveLength(1);
      await page.close();
    });

    it("say so when the plugin knows no lamp", async () => {
      const { page } = await openPluginSettings({});

      await expect.poll(async () => (await pluginSettingsOf(page)).notes).toEqual(["No lamps found"]);
      expect((await pluginSettingsOf(page)).lamps).toEqual([]);
      await page.close();
    });
  });
});

/** What a dial's page shows of the dial's own blink: whether it shows it, and if so, its label and whether it's checked. */
function dialBlinkOf(page: Page): Promise<{ shown: boolean; label?: string | null; checked?: boolean }> {
  return page.evaluate(`(() => {
    const box = document.querySelector("#dial-blink sdpi-checkbox");
    return box === null || !box.checkVisibility()
      ? { shown: false }
      : { shown: true, label: box.getAttribute("label"), checked: box.value === true };
  })()`);
}

/** Clicks the dial's own blink, as the user would: on the input inside the component. */
function clickDialBlink(page: Page): Promise<void> {
  return page.evaluate(`(async () => {
    const host = document.querySelector("#dial-blink sdpi-checkbox");
    await host.updateComplete;
    host.shadowRoot.querySelector("input").click();
  })()`);
}

/** Whether a key's page shows the key's own new lamps checkbox (#147), and with what. */
function keyNewLampsOf(page: Page): Promise<{ shown: boolean; label?: string | null; checked?: boolean }> {
  return page.evaluate(`(() => {
    const box = document.querySelector("#key-new-lamps sdpi-checkbox");
    return box === null || !box.checkVisibility()
      ? { shown: false }
      : { shown: true, label: box.getAttribute("label"), checked: box.value === true };
  })()`);
}

/** Clicks the key's own new lamps checkbox, as the user would: on the input inside the component. */
function clickKeyNewLamps(page: Page): Promise<void> {
  return page.evaluate(`(async () => {
    const host = document.querySelector("#key-new-lamps sdpi-checkbox");
    await host.updateComplete;
    host.shadowRoot.querySelector("input").click();
  })()`);
}

/** The expression that finds a checkbox of the plugin settings that can be indeterminate, by the start of its label. */
function triState(label: string): string {
  return `[...document.querySelectorAll("#plugin-settings .tri-state")].find((box) =>
    box.querySelector(".text").textContent.startsWith(${JSON.stringify(label)}))`;
}

/** What every dial's blink shows in the plugin settings: "true", "false" or "mixed". */
function everyDialBlinkOf(page: Page): Promise<string | null> {
  return page.evaluate(`${triState("Blink each lamp")}.getAttribute("aria-checked")`);
}

/** Clicks every dial's blink in the plugin settings. */
function clickEveryDialBlink(page: Page): Promise<void> {
  return page.evaluate(`${triState("Blink each lamp")}.click()`);
}

/** A lamp as the plugin knows it, in the global settings (#194), with the name given to it, if any (#146). */
function known(lamp: ListedLamp, name?: string): KnownLamp {
  return { model: lamp.model, serialEnd: lamp.serialEnd, ...(name === undefined ? {} : { name }) };
}

/** These lamps as the plugin knows them, by id, in the global settings (#194), without names. */
function knowing(...lamps: ListedLamp[]): Record<string, KnownLamp> {
  return Object.fromEntries(lamps.map((lamp) => [lamp.id, known(lamp)]));
}

/** Whether a message is a page asking the plugin for the lamps. */
function isLampsRequest(message: { event: string; context?: string; payload?: Record<string, unknown> }, uuid: string) {
  return message.event === "sendToPlugin" && message.context === uuid && message.payload?.event === "lamps";
}

type PickerLamp = { label: string | null; checked: boolean };

/** What the lamp picker shows: each lamp's row, the All checkbox, if shown yet, its notes and its buttons. */
function pickerOf(
  page: Page,
): Promise<{ lamps: PickerLamp[]; all: boolean | undefined; notes: string[]; buttons: string[] }> {
  return page.evaluate(`(() => {
    const picker = document.getElementById("lamp-picker");
    const lamps = [...picker.querySelectorAll(".lamp")].map((row) => ({
      label: row.querySelector("sdpi-checkbox").getAttribute("label"),
      checked: row.querySelector("sdpi-checkbox").value === true,
    }));
    const all = [...picker.children].find((child) => child.localName === "sdpi-checkbox");
    return {
      lamps,
      all: all === undefined ? undefined : all.value === true,
      notes: [...picker.querySelectorAll(":scope > .note")].map((note) => note.textContent),
      buttons: [...picker.querySelectorAll("sdpi-button")].map((button) => button.textContent),
    };
  })()`);
}

type ListedLampRow = { label: string | null; checked: boolean; disabled: boolean; note: string | null };

/** Reads a list of lamps' rows: each checkbox's label, whether it's checked and greyed out, and its note, if any. */
const LAMP_ROWS = `(list) => [...list.querySelectorAll(".lamp")].map((row) => {
  const box = row.querySelector("sdpi-checkbox");
  return {
    label: box.getAttribute("label"),
    checked: box.value === true,
    disabled: box.disabled === true,
    note: row.querySelector(".note")?.textContent ?? null,
  };
})`;

/** The lamp picker's rows, with whether each is greyed out and its note, such as the scene group that holds it. */
function pickerRowsOf(page: Page): Promise<ListedLampRow[]> {
  return page.evaluate(`(${LAMP_ROWS})(document.getElementById("lamp-picker"))`);
}

type SceneGroupView = {
  heading: string | null;
  power: string;
  /** Whether its Brightness and Temperature show. */
  presets: boolean;
  brightness: string;
  temperature: string;
  lamps: ListedLampRow[];
  remove: string | null;
};

/**
 * What the Scene page shows of its groups: whether the first group's heading and presets show, each group added after
 * it, and whether the button that adds one does.
 */
function groupsOf(
  page: Page,
): Promise<{ firstHeading: boolean; firstPresets: boolean; groups: SceneGroupView[]; add: boolean }> {
  return page.evaluate(`(() => {
    const rows = ${LAMP_ROWS};
    const itemOf = (group, label) => group.querySelector('sdpi-item[label="' + label + '"]');
    const groups = [...document.querySelectorAll("#added-groups .group")].map((group) => ({
      heading: group.querySelector(".group-heading").textContent,
      power: itemOf(group, "Power").querySelector("sdpi-select").value,
      presets: !itemOf(group, "Brightness").hidden && !itemOf(group, "Temperature").hidden,
      brightness: (${NUMBER_SHOWN})(itemOf(group, "Brightness").querySelector("litra-number")),
      temperature: (${NUMBER_SHOWN})(itemOf(group, "Temperature").querySelector("litra-number")),
      lamps: rows(group),
      remove: group.querySelector("sdpi-button")?.textContent ?? null,
    }));
    return {
      firstHeading: !document.getElementById("first-group-heading").hidden,
      firstPresets: [...document.querySelectorAll(".first-group-preset")].every((preset) => !preset.hidden),
      groups,
      add: [...document.querySelectorAll("#added-groups > sdpi-item sdpi-button")].some(
        (button) => button.textContent === "Add a group"),
    };
  })()`);
}

/**
 * Clicks a button of the Scene page's groups, or, in the group numbered `group`, a lamp's checkbox by its label, as
 * the user would.
 */
function clickInGroups(page: Page, text: string, group?: number): Promise<void> {
  return page.evaluate(`(async () => {
    const groups = document.getElementById("added-groups");
    if (${group === undefined}) {
      [...groups.querySelectorAll("sdpi-button")].find((button) => button.textContent === ${JSON.stringify(text)})
        .shadowRoot.querySelector("button").click();
      return;
    }
    const view = [...groups.querySelectorAll(".group")].find((candidate) =>
      candidate.querySelector(".group-heading").textContent === "Group ${group}");
    const host = [...view.querySelectorAll("sdpi-checkbox")].find((box) =>
      box.getAttribute("label") === ${JSON.stringify(text)});
    await host.updateComplete;
    host.shadowRoot.querySelector("input").click();
  })()`);
}

/** Sets the control of a group's row, by its label, to `value`, as the user would: a list's choice, a typed number. */
function setGroupControl(page: Page, group: number, label: string, value: string): Promise<void> {
  const view = `[...document.querySelectorAll("#added-groups .group")].find((candidate) =>
    candidate.querySelector(".group-heading").textContent === "Group ${group}")`;
  return setControl(
    page,
    `${view}.querySelector('sdpi-item[label="${label}"]').querySelector("sdpi-select, litra-number")`,
    value,
  );
}

/** Clicks a checkbox of the lamp picker by its label, as the user would: on the input inside the component. */
function clickInPicker(page: Page, label: string): Promise<void> {
  return page.evaluate(`(async () => {
    const picker = document.getElementById("lamp-picker");
    const host = [...picker.querySelectorAll("sdpi-checkbox")].find((element) =>
      element.getAttribute("label") === ${JSON.stringify(label)});
    await host.updateComplete;
    host.shadowRoot.querySelector("input").click();
  })()`);
}

type PluginSettingsLamp = {
  serialEnd: string;
  model: string;
  name: string;
  placeholder: string | null;
  maxLength: string | null;
  identify: boolean;
  /** The label of the button that forgets the lamp (#194), or null when there's none. */
  forget: string | null;
  /** Whether it's greyed out, as a lamp the last Find lamps didn't find. */
  missing: boolean;
};

type PluginSettings = {
  /** Whether they're the first thing on the page. */
  first: boolean;
  open: boolean;
  /** Whether any of the action's own settings show. */
  actionShown: boolean;
  buttons: string[];
  headers?: string[];
  lamps: PluginSettingsLamp[];
  notes: string[];
};

/** The `setting` of every global control the page shows, as the user sees it, wherever it sits on the page. */
function shownGlobalSettings(page: Page): Promise<string[]> {
  return page.evaluate(`
    [...document.querySelectorAll("[setting][global]")]
      .filter((control) => control.checkVisibility())
      .map((control) => control.getAttribute("setting"))
  `);
}

/** What the plugin settings show, and whether the action's own settings show beside them. */
function pluginSettingsOf(page: Page): Promise<PluginSettings> {
  return page.evaluate(`(() => {
    const container = document.getElementById("plugin-settings");
    const headers = [...container.querySelectorAll("th")].map((th) => th.textContent);
    return {
      first: document.body.firstElementChild === container,
      open: document.body.classList.contains("plugin-settings-open"),
      actionShown: [...document.body.children].some(
        (child) => child !== container && child.localName !== "script" && child.checkVisibility(),
      ),
      buttons: [...container.querySelectorAll("sdpi-button, button.forget")]
        .filter((button) => button.checkVisibility({ visibilityProperty: true }))
        .map((button) => button.textContent || button.getAttribute("aria-label")),
      ...(headers.length === 0 ? {} : { headers }),
      lamps: [...container.querySelectorAll("tr.lamp")].map((row) => {
        const [serialEnd, model] = [...row.children].map((td) => td.textContent);
        const name = row.querySelector("sdpi-textfield");
        return {
          serialEnd,
          model,
          name: name.value ?? "",
          placeholder: name.getAttribute("placeholder"),
          maxLength: name.getAttribute("maxlength"),
          identify: [...row.querySelectorAll("sdpi-button")].some(
            (button) => button.textContent === "Identify" && button.checkVisibility({ visibilityProperty: true }),
          ),
          forget: row.querySelector("button.forget")?.getAttribute("aria-label") ?? null,
          missing: row.classList.contains("missing"),
        };
      }),
      notes: [...container.querySelectorAll(".note")]
        .filter((note) => note.checkVisibility({ visibilityProperty: true }))
        .map((note) => note.textContent),
    };
  })()`);
}

/**
 * Clicks a button of the plugin settings by its text, or its label for the trash can, a plain button with no text, in
 * the row of the lamp whose serial ends in `row` when given, as the user would: on the button inside the component.
 */
function clickInPluginSettings(page: Page, text: string, row?: string): Promise<void> {
  return page.evaluate(`(async () => {
    const container = document.getElementById("plugin-settings");
    const scope = ${row === undefined ? "container" : `[...container.querySelectorAll("tr.lamp")].find((r) => r.firstElementChild.textContent === ${JSON.stringify(row)})`};
    const trash = [...scope.querySelectorAll("button.forget")].find(
      (element) => element.getAttribute("aria-label") === ${JSON.stringify(text)},
    );
    if (trash !== undefined) {
      trash.click();
      return;
    }
    const host = [...scope.querySelectorAll("sdpi-button")].find(
      (element) => element.textContent === ${JSON.stringify(text)} && element.checkVisibility({ visibilityProperty: true }),
    );
    await host.updateComplete;
    host.shadowRoot.querySelector("button").click();
  })()`);
}

/** Types a name into the field of the lamp whose serial ends in `row`, as the user would, replacing what it held. */
function typeName(page: Page, row: string, name: string): Promise<void> {
  return page.evaluate(`(async () => {
    const container = document.getElementById("plugin-settings");
    const lamp = [...container.querySelectorAll("tr.lamp")].find((r) => r.firstElementChild.textContent === ${JSON.stringify(row)});
    const host = lamp.querySelector("sdpi-textfield");
    await host.updateComplete;
    const input = host.shadowRoot.querySelector("input");
    input.focus();
    input.value = ${JSON.stringify(name)};
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  })()`);
}
