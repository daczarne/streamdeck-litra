import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { JsonValue } from "@elgato/utils";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { brightnessSettings, parseSettings, powerSettings, temperatureSettings } from "../src/actions/settings";
import { at } from "../src/test-support/at";
import { Chrome, type ExceptionDetails, type Page } from "./support/chrome";
import { FakeStreamDeck } from "./support/fake-stream-deck";

const pluginDir = path.resolve("com.daczarne.litra.sdPlugin");
const manifest = JSON.parse(readFileSync(path.join(pluginDir, "manifest.json"), "utf8")) as {
  Actions: { UUID: string; PropertyInspectorPath: string; Controllers: string[] }[];
};

type Controller = "Keypad" | "Encoder";

/** What a slider shows after its value, next to it. */
type Slider = { suffix: string };

type Panel = {
  page: string;
  controller: Controller;
  /** The settings whose controls the panel shows, by their `setting` attribute. */
  settings: string[];
  /** A setting to change through its control, and the value Stream Deck should receive for it. */
  change: { setting: string; value: string; saved: unknown };
  slider?: Slider;
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
    slider: { suffix: "%" },
  },
  {
    page: "ui/brightness.html",
    controller: "Encoder",
    settings: ["stepPercentage"],
    change: { setting: "stepPercentage", value: "20", saved: 20 },
    slider: { suffix: "%" },
  },
  {
    page: "ui/temperature.html",
    controller: "Keypad",
    settings: ["presetKelvin"],
    change: { setting: "presetKelvin", value: "5000", saved: 5000 },
    slider: { suffix: " K" },
  },
  {
    page: "ui/temperature.html",
    controller: "Encoder",
    settings: ["stepKelvin"],
    change: { setting: "stepKelvin", value: "500", saved: "500" },
  },
];

// What the plugin accepts for each setting, by its name, and the default it takes: settings.ts says these are what
// each page offers, and the pages' own defaults.
const SCHEMA = { ...powerSettings, ...brightnessSettings, ...temperatureSettings };

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
    const declared = manifest.Actions.flatMap((a) => a.Controllers.map((c) => `${a.PropertyInspectorPath} ${c}`));
    expect(PANELS.map((p) => `${p.page} ${p.controller}`).sort()).toEqual(declared.sort());
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
    const setting = at(panel.settings, 0);

    it(`defaults ${setting} to its default in settings.ts`, async () => {
      const { page } = await openPanel(panel);
      const control = await controlOf(page, setting);
      await page.close();

      expect(control.default).not.toBeNull();
      expect(read(setting, saved(control, control.default ?? ""))).toEqual({ value: defaultOf(setting), valid: true });
    });

    it(`offers only values of ${setting} that settings.ts accepts`, async () => {
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

  const withSlider = PANELS.filter((panel): panel is Panel & { slider: Slider } => panel.slider !== undefined);
  describe.each(withSlider)("the slider of $page on $controller", (panel) => {
    const { slider } = panel;

    it("ends where settings.ts does", async () => {
      const { page } = await openPanel(panel);
      const control = await controlOf(page, panel.change.setting);
      await page.close();

      const [min, max, step] = [Number(control.min), Number(control.max), Number(control.step)];
      expect(read(panel.change.setting, min - step).valid).toBe(false);
      expect(read(panel.change.setting, max + step).valid).toBe(false);
    });

    it("shows its default value next to it", async () => {
      const { page } = await openPanel(panel);
      await expect
        .poll(() => shownValue(page, panel.change.setting))
        .toBe(`${defaultOf(panel.change.setting)}${slider.suffix}`);
      await page.close();
    });

    it("shows the saved value next to it", async () => {
      const { setting, saved } = panel.change;
      const { page } = await openPanel(panel, { [setting]: saved });
      await expect.poll(() => shownValue(page, setting)).toBe(`${saved}${slider.suffix}`);
      await page.close();
    });

    it("follows it while it's dragged, before it's released", async () => {
      const { page } = await openPanel(panel);
      const { setting, value } = panel.change;
      await page.evaluate(`(async () => {
        const host = document.querySelector('[setting="${setting}"]');
        await host.updateComplete;
        const control = host.shadowRoot.querySelector("input");
        control.value = "${value}";
        control.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      })()`);
      expect(await shownValue(page, setting)).toBe(`${value}${slider.suffix}`);
      await page.close();
    });
  });
});
