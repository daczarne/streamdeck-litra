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

// The global checkboxes of sdpi-components the plugin settings show, on every page, which every dial and key shares
// (#145, #146), the lists of the lamp screens' cells, in the order the cells are read (#177), the controls of their text
// styles (#153), and every global setting they show through sdpi-components, in their order, the blink's length last
// (#171).
const PLUGIN_SETTINGS_CHECKBOXES = ["keepBrightnessDifference", "keepTemperatureDifference"];
const LAMP_SCREEN_LISTS = [
  "lampScreenTopLeft",
  "lampScreenTopRight",
  "lampScreenMiddleLeft",
  "lampScreenMiddleRight",
  "lampScreenBottomLeft",
  "lampScreenBottomRight",
];
const TEXT_STYLE_CONTROLS = ["Primary", "Accent"].flatMap((style) =>
  ["Color", "Weight", "Size"].map((part) => `lampScreen${style}${part}`),
);
const PLUGIN_SETTINGS_GLOBALS = [
  ...PLUGIN_SETTINGS_CHECKBOXES,
  ...LAMP_SCREEN_LISTS,
  ...TEXT_STYLE_CONTROLS,
  "identifyBlinkMs",
];

// What the plugin accepts for each setting, by its name, and the default it takes: settings.ts says these are what
// each page offers, and the pages' own defaults.
const SCHEMA = {
  ...powerSettings,
  ...brightnessSettings,
  ...temperatureSettings,
  ...sceneSettings,
  ...lampSettings,
  ...globalSettings,
};

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
      await expect.poll(() => visibleSettings(page, { global: true })).toEqual([]);
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
  describe.each([
    { setting: "lampScreenPrimaryColor", value: "#ff8800" },
    { setting: "lampScreenPrimaryWeight", value: "bold" },
    { setting: "lampScreenPrimarySize", value: "22" },
    { setting: "lampScreenAccentColor", value: "#00aaff" },
    { setting: "lampScreenAccentWeight", value: "bold" },
    { setting: "lampScreenAccentSize", value: "16" },
  ])("the global $setting in the plugin settings on ui/power.html", ({ setting, value }) => {
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
        rows: ["Cell", "First part", "Second part", "Trim", ""],
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
          topLeft: { counter: { format: "slash" }, identification: { first: "model", second: "id", trim: true } },
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

  // How long a blink lasts, a slider in the plugin settings, on a page without sliders of its own and on one with them,
  // whose values a script shows (#171).
  describe.each([at(PANELS, 0), at(PANELS, 2)])(
    "the blink's length in the plugin settings on $page on $controller",
    (panel) => {
      const SETTING = "identifyBlinkMs";

      afterEach(() => {
        streamDeck.globalSettings = {};
      });

      /** Waits for the page to have the global settings, which the slider shows once they've arrived. */
      async function globalSettingsRead(page: Page): Promise<void> {
        await page.evaluate(`SDPIComponents.useGlobalSettings("${SETTING}")[0]()`);
      }

      /** Moves the slider to `value`, as a drag does, and releases it unless asked not to. */
      async function slide(page: Page, value: number, { release = true } = {}): Promise<void> {
        await page.evaluate(`(async () => {
          const host = document.querySelector('[setting="${SETTING}"]');
          await host.updateComplete;
          const control = host.shadowRoot.querySelector("input");
          control.value = "${value}";
          control.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
          if (${release}) {
            control.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
          }
        })()`);
      }

      it("defaults to its default in settings.ts, and shows it next to it", async () => {
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

      it("follows the slider while it's dragged, before it's released", async () => {
        const { page } = await openPanel(panel);
        await globalSettingsRead(page);
        await slide(page, 900, { release: false });
        const shown = await shownValue(page, SETTING);
        await page.close();

        expect(shown).toBe("900 ms");
      });

      it("saves to the global settings, as settings.ts takes it, keeping the others and the action's own", async () => {
        streamDeck.globalSettings = { blinkOnLampScreen: true };
        const { page, uuid } = await openPanel(panel);
        await globalSettingsRead(page);
        await clickInPluginSettings(page, "Plugin settings");
        await slide(page, 900);
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

  const FIRST: ListedLamp = { id: "0123456789abcdef", label: "Beam - 1111", model: "Beam", serialEnd: "1111" };
  const SECOND: ListedLamp = { id: "fedcba9876543210", label: "Beam LX - 2222", model: "Beam LX", serialEnd: "2222" };

  /** A lamp as a key saves it: its id, and the label it was listed with. */
  function savedLamp({ id, label }: ListedLamp) {
    return { id, label };
  }

  describe("the lamp picker (#20)", () => {
    const POWER = at(PANELS, 0);

    afterEach(() => {
      streamDeck.lamps = [];
      streamDeck.globalSettings = {};
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

    it("lists every lamp found, by its label, all checked for a key with no lamps saved", async () => {
      const { page } = await openPicker([FIRST, SECOND]);

      expect(await pickerOf(page)).toEqual({
        lamps: [
          { label: FIRST.label, checked: true, missing: false },
          { label: SECOND.label, checked: true, missing: false },
        ],
        all: true,
        notes: [],
        buttons: [],
      });
      // A key with no lamps saved acts on every lamp, settings.ts's default.
      expect(read("lamps", "all")).toEqual({ value: defaultOf("lamps"), valid: true });
      await page.close();
    });

    it("checks the lamps the key has saved, and leaves All unchecked", async () => {
      const { page } = await openPicker([FIRST, SECOND], { lamps: [savedLamp(SECOND)] });

      expect(await pickerOf(page)).toMatchObject({
        lamps: [{ checked: false }, { checked: true }],
        all: false,
      });
      await page.close();
    });

    it("saves the lamps still checked when one is unchecked from All, which unchecks", async () => {
      const { page, uuid } = await openPicker([FIRST, SECOND]);

      const after = streamDeck.messages.length;
      await clickInPicker(page, FIRST.label);
      const saved = await nextSave(uuid, after);

      expect(saved).toEqual([savedLamp(SECOND)]);
      expect(read("lamps", saved as JsonValue)).toEqual({ value: [SECOND.id], valid: true });
      expect(await pickerOf(page)).toMatchObject({ lamps: [{ checked: false }, { checked: true }], all: false });
      await page.close();
    });

    it("saves every lamp when All is checked, and checks them all", async () => {
      const { page, uuid } = await openPicker([FIRST, SECOND], { lamps: [savedLamp(FIRST)] });

      const after = streamDeck.messages.length;
      await clickInPicker(page, "All");

      expect(await nextSave(uuid, after)).toBe("all");
      expect(await pickerOf(page)).toMatchObject({ lamps: [{ checked: true }, { checked: true }], all: true });
      await page.close();
    });

    it("saves no lamp when All is unchecked", async () => {
      const { page, uuid } = await openPicker([FIRST, SECOND]);

      const after = streamDeck.messages.length;
      await clickInPicker(page, "All");
      const saved = await nextSave(uuid, after);

      expect(saved).toEqual([]);
      expect(read("lamps", saved as JsonValue)).toEqual({ value: [], valid: true });
      await page.close();
    });

    it("saves the lamps checked one by one as a list, not as All, which would take in lamps plugged in later", async () => {
      const { page, uuid } = await openPicker([FIRST, SECOND], { lamps: [savedLamp(FIRST)] });

      const after = streamDeck.messages.length;
      await clickInPicker(page, SECOND.label);

      expect(await nextSave(uuid, after)).toEqual([savedLamp(FIRST), savedLamp(SECOND)]);
      expect(await pickerOf(page)).toMatchObject({ all: false });
      await page.close();
    });

    it("keeps a saved lamp that isn't connected, checked and marked as not found, so it can be unchecked", async () => {
      const { page, uuid } = await openPicker([FIRST], { lamps: [savedLamp(FIRST), savedLamp(SECOND)] });

      expect(await pickerOf(page)).toMatchObject({
        lamps: [
          { label: FIRST.label, checked: true, missing: false },
          { label: SECOND.label, checked: true, missing: true },
        ],
      });

      const after = streamDeck.messages.length;
      await clickInPicker(page, SECOND.label);

      expect(await nextSave(uuid, after)).toEqual([savedLamp(FIRST)]);
      await page.close();
    });

    it("says so when no lamp is found", async () => {
      const { page } = await openPicker([]);

      expect(await pickerOf(page)).toEqual({ lamps: [], all: true, notes: ["No lamps found"], buttons: [] });
      await page.close();
    });

    it("shows a named lamp by its name, connected or not, and saves it with its label (#146)", async () => {
      streamDeck.globalSettings = { lampNames: { [FIRST.id]: "Left", [SECOND.id]: "Key light" } };
      const { page, uuid } = await openPicker([FIRST], { lamps: [savedLamp(SECOND)] });

      expect(await pickerOf(page)).toMatchObject({
        lamps: [
          { label: "Left", checked: false, missing: false },
          { label: "Key light", checked: true, missing: true },
        ],
      });

      const after = streamDeck.messages.length;
      await clickInPicker(page, "Left");

      expect(await nextSave(uuid, after)).toEqual([savedLamp(FIRST), savedLamp(SECOND)]);
      await page.close();
    });

    it("shows a lamp by its label when its saved name isn't text", async () => {
      streamDeck.globalSettings = { lampNames: { [FIRST.id]: 7 } };
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
      streamDeck.lamps = [FIRST];
      const { page } = await openPanel(panel);

      await clickInPluginSettings(page, "Plugin settings");
      await expect.poll(() => pluginSettingsOf(page)).toMatchObject({ lamps: [{ serialEnd: FIRST.serialEnd }] });
      expect(await pluginSettingsOf(page)).toMatchObject({
        open: true,
        actionShown: false,
        // A Configure button under each of the lamp screens' cells (#177).
        buttons: ["Back", "Find lamps", "Identify", ...LAMP_SCREEN_LISTS.map(() => "Configure")],
      });
      expect(await shownGlobalSettings(page)).toEqual(PLUGIN_SETTINGS_GLOBALS);

      await clickInPluginSettings(page, "Back");
      expect(await pluginSettingsOf(page)).toMatchObject({
        open: false,
        actionShown: true,
        buttons: ["Plugin settings"],
      });
      expect(await shownGlobalSettings(page)).toEqual([]);
      streamDeck.lamps = [];
      await page.close();
    });
  });

  describe("the plugin settings (#146)", () => {
    const POWER = at(PANELS, 0);

    afterEach(() => {
      streamDeck.lamps = [];
      streamDeck.globalSettings = {};
    });

    /** Opens the Power key's page with the lamps the plugin finds, then its plugin settings, once they list them. */
    async function openPluginSettings(lamps: ListedLamp[]) {
      streamDeck.lamps = lamps;
      const opened = await openPanel(POWER);
      await clickInPluginSettings(opened.page, "Plugin settings");
      await expect.poll(async () => (await pluginSettingsOf(opened.page)).notes).not.toContain("Looking for lamps…");
      return opened;
    }

    /** The next global settings the page saves. */
    async function nextGlobalSave(uuid: string, after: number): Promise<unknown> {
      const message = await streamDeck.waitFor(
        (m) => m.event === "setGlobalSettings" && m.context === uuid && streamDeck.messages.indexOf(m) >= after,
      );
      return message.payload;
    }

    it("list every lamp found by the end of its serial, its model and its name, with an Identify button", async () => {
      streamDeck.globalSettings = { lampNames: { [SECOND.id]: "Key light" } };
      const { page } = await openPluginSettings([FIRST, SECOND]);

      expect(await pluginSettingsOf(page)).toMatchObject({
        headers: ["ID", "Model", "Name", ""],
        lamps: [
          { serialEnd: "1111", model: "Beam", name: "", placeholder: FIRST.label, maxLength: "24", identify: true },
          {
            serialEnd: "2222",
            model: "Beam LX",
            name: "Key light",
            placeholder: SECOND.label,
            maxLength: "24",
            identify: true,
          },
        ],
        notes: [],
      });
      await page.close();
    });

    it("save a name typed, by lamp id, keeping the other global settings, and show it in the lamp picker", async () => {
      streamDeck.globalSettings = { blinkOnLampScreen: true, lampNames: { [SECOND.id]: "Key light" } };
      const { page, uuid } = await openPluginSettings([FIRST, SECOND]);

      const after = streamDeck.messages.length;
      await typeName(page, FIRST.serialEnd, "  Left ");

      expect(await nextGlobalSave(uuid, after)).toEqual({
        blinkOnLampScreen: true,
        lampNames: { [SECOND.id]: "Key light", [FIRST.id]: "Left" },
      });
      await clickInPluginSettings(page, "Back");
      expect((await pickerOf(page)).lamps.map((lamp) => lamp.label)).toEqual(["Left", "Key light"]);
      await page.close();
    });

    it("take a name away when its field is emptied, and show the lamp by its label again", async () => {
      streamDeck.globalSettings = { lampNames: { [FIRST.id]: "Left", [SECOND.id]: "Key light" } };
      const { page, uuid } = await openPluginSettings([FIRST, SECOND]);

      const after = streamDeck.messages.length;
      await typeName(page, FIRST.serialEnd, " ");

      expect(await nextGlobalSave(uuid, after)).toEqual({ lampNames: { [SECOND.id]: "Key light" } });
      await clickInPluginSettings(page, "Back");
      expect((await pickerOf(page)).lamps.map((lamp) => lamp.label)).toEqual([FIRST.label, "Key light"]);
      await page.close();
    });

    it("ask the plugin to blink a lamp on its Identify button", async () => {
      const { page, uuid } = await openPluginSettings([FIRST, SECOND]);

      await clickInPluginSettings(page, "Identify", SECOND.serialEnd);
      const message = await streamDeck.waitFor(
        (m) => m.event === "sendToPlugin" && m.context === uuid && m.payload?.event === "identify",
      );

      expect(message.payload).toEqual({ event: "identify", id: SECOND.id });
      await page.close();
    });

    it("ask the plugin again on Find lamps, and list the lamps plugged in since, as the lamp picker does", async () => {
      const { page, uuid } = await openPluginSettings([FIRST]);

      streamDeck.lamps = [FIRST, SECOND];
      await clickInPluginSettings(page, "Find lamps");

      await expect
        .poll(async () => (await pluginSettingsOf(page)).lamps.map((lamp) => lamp.serialEnd))
        .toEqual([FIRST.serialEnd, SECOND.serialEnd]);
      // Once by the lamp picker as the page opened, once as the plugin settings opened, and once on Find lamps.
      expect(streamDeck.messages.filter((m) => isLampsRequest(m, uuid))).toHaveLength(3);
      await clickInPluginSettings(page, "Back");
      expect((await pickerOf(page)).lamps.map((lamp) => lamp.label)).toEqual([FIRST.label, SECOND.label]);
      await page.close();
    });

    it("say so when no lamp is found", async () => {
      const { page } = await openPluginSettings([]);

      expect(await pluginSettingsOf(page)).toMatchObject({ lamps: [], notes: ["No lamps found"] });
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

/** What every dial's blink shows in the plugin settings: "true", "false" or "mixed". */
function everyDialBlinkOf(page: Page): Promise<string | null> {
  return page.evaluate(`document.querySelector("#plugin-settings .tri-state").getAttribute("aria-checked")`);
}

/** Clicks every dial's blink in the plugin settings. */
function clickEveryDialBlink(page: Page): Promise<void> {
  return page.evaluate(`document.querySelector("#plugin-settings .tri-state").click()`);
}

/** Whether a message is a page asking the plugin for the lamps. */
function isLampsRequest(message: { event: string; context?: string; payload?: Record<string, unknown> }, uuid: string) {
  return message.event === "sendToPlugin" && message.context === uuid && message.payload?.event === "lamps";
}

type PickerLamp = { label: string | null; checked: boolean; missing: boolean };

/** What the lamp picker shows: each lamp's row, the All checkbox, if shown yet, its notes and its buttons. */
function pickerOf(
  page: Page,
): Promise<{ lamps: PickerLamp[]; all: boolean | undefined; notes: string[]; buttons: string[] }> {
  return page.evaluate(`(() => {
    const picker = document.getElementById("lamp-picker");
    const lamps = [...picker.querySelectorAll(".lamp")].map((row) => ({
      label: row.querySelector("sdpi-checkbox").getAttribute("label"),
      checked: row.querySelector("sdpi-checkbox").value === true,
      missing: row.querySelector(".note") !== null,
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
      buttons: [...container.querySelectorAll("sdpi-button")]
        .filter((button) => button.checkVisibility())
        .map((button) => button.textContent),
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
          identify: row.querySelector("sdpi-button")?.textContent === "Identify",
        };
      }),
      notes: [...container.querySelectorAll(".note")].map((note) => note.textContent),
    };
  })()`);
}

/**
 * Clicks a button of the plugin settings by its text, in the row of the lamp whose serial ends in `row` when given, as
 * the user would: on the button inside the component.
 */
function clickInPluginSettings(page: Page, text: string, row?: string): Promise<void> {
  return page.evaluate(`(async () => {
    const container = document.getElementById("plugin-settings");
    const scope = ${row === undefined ? "container" : `[...container.querySelectorAll("tr.lamp")].find((r) => r.firstElementChild.textContent === ${JSON.stringify(row)})`};
    const host = [...scope.querySelectorAll("sdpi-button")].find((element) => element.textContent === ${JSON.stringify(text)});
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
