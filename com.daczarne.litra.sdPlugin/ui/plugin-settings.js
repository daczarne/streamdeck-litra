// The plugin's own settings (#146), the same on every action's page: a button at the top of the page shows them in
// place of the action's, and back. They list the lamps the plugin knows (#194), which it keeps in its global settings
// as `lamps`, each by the end of its id and its model, with a field for its name, a button that blinks it, and one that
// forgets it. The plugin alone saves the lamps: this asks it to find them, and to rename or forget one, and shows them
// as Stream Deck passes on what the plugin saved. Find lamps is the only time they're looked for, and marks the ones it
// didn't find. The keys' lamp pickers list the same lamps, with their names (lamp-picker.js). Under the lamps, Re-sync
// lamps brings the lamps the plugin knows that are connected and the plugin back in step, in the direction chosen
// above it (#214). Then come the global settings that every dial and key shares, such as whether each lamp steps from its own value (#145), how long a
// blink lasts (#171), whether keys take in lamps added later (#147), which a key's own page can choose for that key
// alone, and tells its lamp picker, the lamp screens' blink (#144), which a dial's own page can turn on or off for that
// dial alone, and what each cell of the lamp screens shows, with a Configure button that shows the cell's options in
// place of the plugin settings (#177), and Back, which shows the plugin settings again, scrolled to where they were. A
// file rather than an inline script, so the pages' Content-Security-Policy doesn't have to allow inline scripts.
//
// Its styles are in settings.css, with every page's (#247).
(() => {
  const container = document.getElementById("plugin-settings");
  if (container === null) {
    return;
  }
  const client = SDPIComponents.streamDeckClient;
  const MAX_NAME_LENGTH = 24;

  // Whether the plugin settings are shown, in place of the action's, and the cell whose options are, in their place.
  let open = false;
  let editing;
  // How far the plugin settings were scrolled when a cell's options took their place, which Back scrolls them to
  // again, so the next cell's Configure button is where it was.
  let scrolledTo = 0;
  // The lamps the plugin knows, by id, each with its model, and its name, if any.
  let lamps = {};
  // The ids of the lamps the plugin found the last time it looked (#198): what it answers as the plugin settings open,
  // and tells of every change since, and what the last Find lamps found. Undefined before either, when none is marked
  // as not found.
  let found;

  // The plugin tells the page shown which lamps are connected whenever an operation finds one plugged in or unplugged.
  client.sendToPropertyInspector.subscribe((message) => {
    if (message.payload?.event === "connected" && Array.isArray(message.payload.ids)) {
      found = message.payload.ids;
      render();
    }
  });

  // The lamps arrive with the global settings, each time the plugin saves them.
  const [readLamps] = SDPIComponents.useGlobalSettings("lamps", (value) => {
    lamps = validLamps(value);
    render();
  });

  /**
   * The lamps the plugin knows, by id, or none when they aren't lamps by id: each with a model, and a
   * name only when it's text.
   */
  function validLamps(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(value).flatMap(([id, lamp]) =>
        typeof lamp?.model === "string"
          ? [
              [
                id,
                {
                  model: lamp.model,
                  ...(typeof lamp.name === "string" ? { name: lamp.name } : {}),
                },
              ],
            ]
          : [],
      ),
    );
  }

  /** Asks the plugin to name a lamp, or to take its name away when `name` is blank. The plugin saves it. */
  function rename(id, name) {
    client.send("sendToPlugin", { event: "rename", id, name }).catch(showError);
  }

  /** Asks the plugin to forget a lamp. The plugin saves the lamps left, which then arrive without it. */
  function forget(id) {
    client.send("sendToPlugin", { event: "forget", id }).catch(showError);
  }

  /**
   * Asks the plugin for the lamps connected now, which it adds to the ones it knows, and marks the ones it knows that
   * it didn't find. The lamps it adds arrive with the global settings, as the plugin saves them.
   */
  async function findLamps() {
    const reply = await client.get(
      "sendToPlugin",
      "sendToPropertyInspector",
      (message) => message.payload?.event === "lamps",
      { event: "lamps" },
    );
    found = reply.payload.lamps.map(({ id }) => id);
    render();
  }

  /**
   * Shows the plugin settings, with the lamps the plugin knows, or the action's settings again, or the plugin settings
   * again from a cell's options, scrolled to where they were. Opening them looks for no lamps: it asks the plugin which
   * ones it last found (#198).
   */
  async function toggle() {
    if (editing !== undefined) {
      editing = undefined;
      render();
      // The lamps are drawn again, and sdpi-components draws each of their controls a moment later, before the page is
      // painted: scrolled before then, the page would end up short of where it was by the height they take.
      await Promise.all([...lampList.querySelectorAll("*")].map((element) => element.updateComplete));
      window.scrollTo(0, scrolledTo);
      return;
    }
    open = !open;
    document.body.classList.toggle("plugin-settings-open", open);
    render();
    if (open) {
      // The answer arrives as the plugin tells of a change, which marks the lamps it didn't find.
      client.send("sendToPlugin", { event: "connected" }).catch(showError);
      lamps = validLamps(await readLamps());
      render();
    }
  }

  /** A row of its own, as wide as the page's controls, holding `content`, with `label` on its left. */
  function item(label, ...content) {
    const element = document.createElement("sdpi-item");
    if (label !== undefined) {
      element.setAttribute("label", label);
    }
    element.append(...content);
    return element;
  }

  /** A button from sdpi-components. */
  function button(text, onClick) {
    const element = document.createElement("sdpi-button");
    element.textContent = text;
    element.addEventListener("click", onClick);
    return element;
  }

  /** A checkbox from sdpi-components that reads and saves a global setting itself. */
  function globalCheckbox(setting, label) {
    const box = document.createElement("sdpi-checkbox");
    box.setAttribute("setting", setting);
    box.setAttribute("global", "");
    box.setAttribute("label", label);
    return box;
  }

  /** A number field with − and + (number-field.js, #195) that reads and saves a global setting itself. */
  function globalNumber(setting, { min, max, step, fallback, unit }) {
    const field = document.createElement("litra-number");
    const attributes = { setting, global: "", min, max, step, default: fallback, unit };
    for (const [name, value] of Object.entries(attributes)) {
      field.setAttribute(name, String(value));
    }
    return field;
  }

  /** A color picker from sdpi-components that reads and saves a global setting itself. */
  function globalColor(setting, fallback) {
    const picker = document.createElement("sdpi-color");
    picker.setAttribute("setting", setting);
    picker.setAttribute("global", "");
    picker.setAttribute("default", fallback);
    return picker;
  }

  /**
   * Shows a color in a color picker from sdpi-components, as well as giving it the color. The picker draws its color as
   * its input's `defaultValue`, which an input the user already changed no longer shows, so a color a script gives it,
   * such as a Reset's, would be saved, but the picker would go on showing the user's.
   * @param {HTMLElement} picker The `sdpi-color`.
   * @param {string | null} color The color to show.
   * @returns {void}
   */
  function showColor(picker, color) {
    const input = picker.shadowRoot?.querySelector('input[type="color"]');
    if (input instanceof HTMLInputElement && color !== null) {
      input.value = color;
    }
  }

  /**
   * Radio buttons from sdpi-components that read and save a global setting themselves, one under the other, with their
   * options as [value, text].
   */
  function globalRadio(setting, options, fallback) {
    const radio = document.createElement("sdpi-radio");
    radio.setAttribute("setting", setting);
    radio.setAttribute("global", "");
    radio.setAttribute("default", fallback);
    for (const [value, text] of options) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      radio.append(option);
    }
    return radio;
  }

  /** A list from sdpi-components that reads and saves a global setting itself, with its options as [value, text]. */
  function globalSelect(setting, options, fallback) {
    const select = document.createElement("sdpi-select");
    select.setAttribute("setting", setting);
    select.setAttribute("global", "");
    select.setAttribute("default", fallback);
    for (const [value, text] of options) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      select.append(option);
    }
    return select;
  }

  // What each cell of the lamp screens can show, in the order the lists offer it (#177).
  const LAMP_SCREEN_ITEMS = [
    ["identification", "Identification"],
    ["counter", "Lamp counter"],
    ["temperature", "Temperature"],
    ["power", "Power"],
    ["brightnessPercentage", "Brightness %"],
    ["brightnessLumen", "Brightness lm"],
    ["none", "None"],
  ];

  //* The lamp screens' cells (#177): what each shows, a list from sdpi-components that saves it itself, and how, which
  // a cell's editor shows in place of the plugin settings. A cell's options are kept in the global settings as
  // `lampScreenOptions`, by cell and by item, so a cell switched to another item and back gets its options back. Only
  // what differs from the defaults needs saving: the plugin reads every option against src/settings/schema.ts.

  // The cells, by the setting that holds what each shows, with their names, and what each shows by default.
  const CELLS = [
    ["topLeft", "lampScreenTopLeft", "Top left", "identification"],
    ["topRight", "lampScreenTopRight", "Top right", "counter"],
    ["middleLeft", "lampScreenMiddleLeft", "Middle left", "temperature"],
    ["middleRight", "lampScreenMiddleRight", "Middle right", "power"],
    ["bottomLeft", "lampScreenBottomLeft", "Bottom left", "brightnessPercentage"],
    ["bottomRight", "lampScreenBottomRight", "Bottom right", "brightnessLumen"],
  ];

  // Each item's options and their defaults, as src/settings/schema.ts has them.
  const ITEM_OPTIONS = {
    identification: { first: "model", second: "id", trim: false, style: "primary" },
    counter: { count: "countOf", format: "of", style: "primary" },
    temperature: { icon: true, unit: true, style: "primary" },
    power: {
      onLabel: "ON",
      onStyle: "primary",
      onColor: "#ffffff",
      onWeight: "normal",
      offLabel: "OFF",
      offStyle: "secondary",
      offColor: "#202020",
      offWeight: "normal",
    },
    brightnessPercentage: { icon: true, unit: true, style: "primary" },
    brightnessLumen: { icon: false, unit: true, style: "primary" },
    none: {},
  };

  const PARTS = [
    ["model", "Model"],
    ["id", "ID"],
    ["name", "Name"],
    ["empty", "Empty"],
  ];
  const WEIGHTS = [
    ["normal", "Normal"],
    ["bold", "Bold"],
  ];
  // The dials' text styles, which a lamp screen's cell and a part of a main screen take (#183), and a look of its own,
  // which only a power state takes (#153).
  const TEXT_STYLES = [
    ["primary", "Primary"],
    ["secondary", "Secondary"],
    ["accent", "Accent"],
    ["alert", "Alert"],
  ];
  const FONT_STYLES = [...TEXT_STYLES, ["custom", "Custom"]];
  const FONT_SIZES = [16, 17, 18, 19, 20, 21, 22].map((size) => [String(size), `${size} px`]);
  const ON_LABELS = ["On", "ON", "●", "I"].map((label) => [label, label]);
  const OFF_LABELS = ["Off", "OFF", "○", "O"].map((label) => [label, label]);

  // The lists of what each cell shows, by cell, and every cell's options as saved.
  const cellLists = {};
  let cellOptions = {};

  // Saved at once, without sdpi-components' wait for more changes, so a page closed right after a change keeps it.
  const [readCellOptions, saveCellOptions] = SDPIComponents.useGlobalSettings(
    "lampScreenOptions",
    (value) => {
      cellOptions = validObject(value);
      renderEditor();
    },
    0,
  );

  /** An object from the global settings, or an empty one when it isn't an object. */
  function validObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  }

  /** What a cell shows: its list's value, or its default before the global settings arrive. */
  function itemOf(cell) {
    const [, , , fallback] = CELLS.find(([name]) => name === cell);
    return cellLists[cell].value || fallback;
  }

  /** A cell's options for an item: the saved ones of the right type, and the defaults for the rest. */
  function optionsOf(cell, item) {
    const saved = validObject(validObject(cellOptions[cell])[item]);
    const defaults = ITEM_OPTIONS[item];
    return Object.fromEntries(
      Object.entries(defaults).map(([key, fallback]) => [
        key,
        typeof saved[key] === typeof fallback ? saved[key] : fallback,
      ]),
    );
  }

  /**
   * Saves a cell's options for an item, or takes them away, to bring back the defaults, when `options` is undefined.
   */
  function storeOptions(cell, item, options) {
    const { [item]: _, ...others } = validObject(cellOptions[cell]);
    cellOptions = { ...cellOptions, [cell]: options === undefined ? others : { ...others, [item]: options } };
    saveCellOptions(cellOptions).catch((error) => console.error("Can't save the lamp screens' options", error));
    renderEditor();
  }

  /**
   * One of the dials' text styles (#153), under its name: its color, weight and size, side by side, each saved
   * by sdpi-components as a global setting named after the style, and a Reset button under them, which sets each back
   * to its default. A control saves the value a script gives it, as it does the user's.
   */
  function textStyle(name, setting, color, weight = "normal") {
    const controls = [
      globalColor(`${setting}Color`, color),
      globalSelect(`${setting}Weight`, WEIGHTS, weight),
      globalSelect(`${setting}Size`, FONT_SIZES, "18"),
    ];
    const [colorPicker, weightList, sizeList] = controls;
    const box = fields(name, [
      ["Color", colorPicker],
      ["Font weight", weightList],
      ["Font size", sizeList],
    ]);
    const reset = button("Reset", () => {
      for (const control of controls) {
        control.value = control.getAttribute("default");
      }
      showColor(colorPicker, colorPicker.getAttribute("default"));
    });
    reset.className = "fields-reset";
    reset.dataset.style = setting;
    box.append(reset);
    return box;
  }

  /**
   * The parts of the dials' main screen (#183), two to a row, as [name, setting]: each under its name, with the text
   * style it takes its color from, saved by sdpi-components as a global setting, and a Reset button under it, which
   * sets it back to Primary.
   */
  function mainScreenParts(parts) {
    const grid = document.createElement("div");
    grid.className = "cells";
    for (const [name, setting] of parts) {
      const heading = document.createElement("p");
      heading.className = "fields-title";
      heading.textContent = name;
      const style = globalSelect(setting, TEXT_STYLES, "primary");
      const reset = button("Reset", () => {
        style.value = style.getAttribute("default");
      });
      reset.dataset.part = setting;
      const box = document.createElement("div");
      box.className = "cell";
      box.append(heading, style, reset);
      grid.append(box);
    }
    return grid;
  }

  /** A list for each cell of the lamp screens, laid out as the cells are, each with a button that shows its options. */
  function lampScreenCells() {
    const cells = document.createElement("div");
    cells.className = "cells";
    for (const [cell, setting, , fallback] of CELLS) {
      const box = document.createElement("div");
      box.className = "cell";
      cellLists[cell] = globalSelect(setting, LAMP_SCREEN_ITEMS, fallback);
      const configure = button("Configure", () => {
        scrolledTo = window.scrollY;
        editing = cell;
        render();
        window.scrollTo(0, 0);
      });
      configure.dataset.cell = cell;
      box.append(cellLists[cell], configure);
      cells.append(box);
    }
    return cells;
  }

  /**
   * A control from sdpi-components that saves nothing itself, showing the value of an option, marked with its key,
   * which calls `onChange` with a new value, greyed out when it's `disabled`. It also reports the values this script
   * gives it, which are left out, so only the user's changes reach `onChange`.
   */
  function control(tag, key, value, onChange, { label, options, disabled = false } = {}) {
    const element = document.createElement(tag);
    element.dataset.option = key;
    element.disabled = disabled;
    if (label !== undefined) {
      element.setAttribute("label", label);
    }
    for (const [optionValue, text] of options ?? []) {
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = text;
      element.append(option);
    }
    element.value = value;
    element.addEventListener("valuechange", () => {
      if (element.value !== value) {
        onChange(element.value);
      }
    });
    return element;
  }

  /** The rows of an editor for an item's options, each control showing its option and saving its change. */
  function optionRows(shownItem, options, change) {
    const option = (tag, key, settings) => control(tag, key, options[key], (value) => change(key, value), settings);
    const select = (label, key, choices, disabled = false) =>
      item(label, option("sdpi-select", key, { options: choices, disabled }));
    const check = (label, key, text) => item(label, option("sdpi-checkbox", key, { label: text }));
    // A power state's label and text style, and under them its own color and weight, which only a Custom style takes
    // (#153).
    const state = (name, prefix, labels) => {
      const ownLook = options[`${prefix}Style`] === "custom";
      return item(
        undefined,
        fields(
          name,
          [
            ["Label", option("sdpi-select", `${prefix}Label`, { options: labels })],
            ["Font style", option("sdpi-select", `${prefix}Style`, { options: FONT_STYLES })],
          ],
          [
            ["Color", option("sdpi-color", `${prefix}Color`, { disabled: !ownLook })],
            ["Font weight", option("sdpi-select", `${prefix}Weight`, { options: WEIGHTS, disabled: !ownLook })],
          ],
        ),
      );
    };
    switch (shownItem) {
      case "identification":
        return [
          select("First part", "first", PARTS),
          select("Second part", "second", PARTS),
          check("Trim", "trim", "Trim to half a row"),
          select("Font style", "style", TEXT_STYLES),
        ];
      case "counter":
        return [
          select("Count", "count", [
            ["count", "Lamp number"],
            ["countOf", "Count of total lamps"],
            ["countByModel", "Count by model"],
          ]),
          // A lamp's number alone shows no count to format.
          select(
            "Format",
            "format",
            [
              ["of", "1 of 2"],
              ["slash", "1/2"],
              ["dash", "1-2"],
              ["space", "1 2"],
            ],
            options.count === "count",
          ),
          select("Font style", "style", TEXT_STYLES),
        ];
      case "temperature":
      case "brightnessPercentage":
      case "brightnessLumen": {
        const unit = { temperature: "K", brightnessPercentage: "%", brightnessLumen: "lm" }[shownItem];
        return [
          check("Icon", "icon", "Show the icon"),
          check("Unit", "unit", `Show the unit (${unit})`),
          select("Font style", "style", TEXT_STYLES),
        ];
      }
      case "power":
        return [state("On state", "on", ON_LABELS), state("Off state", "off", OFF_LABELS)];
      default:
        return [item(undefined, note("Nothing to configure: the cell shows nothing."))];
    }
  }

  /**
   * Shows the options of the cell being edited, for the item it shows, with a Reset button that brings back their
   * defaults. Drawn again whenever they change, here or on another page.
   */
  function renderEditor() {
    if (editing === undefined) {
      editor.replaceChildren();
      return;
    }
    const cell = editing;
    const shownItem = itemOf(cell);
    const [, , cellName] = CELLS.find(([name]) => name === cell);
    const [, itemName] = LAMP_SCREEN_ITEMS.find(([value]) => value === shownItem);
    const options = optionsOf(cell, shownItem);
    const change = (key, value) => storeOptions(cell, shownItem, { ...options, [key]: value });
    const reset = button("Reset", () => storeOptions(cell, shownItem, undefined));
    reset.dataset.action = "reset";
    editor.replaceChildren(
      item("Cell", note(`${cellName}: ${itemName}`)),
      ...optionRows(shownItem, options, change),
      ...(shownItem === "none" ? [] : [item(undefined, reset)]),
    );
  }

  /** Controls side by side under a title, given as [caption, control], each with its caption above it. */
  function fields(title, ...rows) {
    const heading = document.createElement("p");
    heading.className = "fields-title";
    heading.textContent = title;
    const box = document.createElement("div");
    box.append(heading);
    for (const captioned of rows) {
      const row = document.createElement("div");
      row.className = "fields";
      for (const [caption, content] of captioned) {
        const field = document.createElement("div");
        field.className = "field";
        const label = document.createElement("p");
        label.className = "caption";
        label.textContent = caption;
        field.append(label, content);
        row.append(field);
      }
      box.append(row);
    }
    return box;
  }

  /** The heading of a section of the plugin settings, across the page, with a line under it. */
  function section(text) {
    const element = document.createElement("h2");
    element.className = "section";
    element.textContent = text;
    return element;
  }

  /** The heading of a part of a section, centered over the controls. */
  function subsection(text) {
    const element = document.createElement("h3");
    element.className = "subsection";
    element.textContent = text;
    return element;
  }

  /** A line of grey text. */
  function note(text) {
    const element = document.createElement("p");
    element.className = "note";
    element.textContent = text;
    return element;
  }

  /** A table cell holding text or elements. */
  function cell(tag, ...content) {
    const element = document.createElement(tag);
    element.append(...content);
    return element;
  }

  /** A trash can, drawn in its button's text color, for the button that forgets a lamp (#194). */
  function trashCan() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 12 14");
    svg.setAttribute("width", "12");
    svg.setAttribute("height", "14");
    svg.setAttribute("aria-hidden", "true");
    // The lid with its handle, then the can, with two grooves.
    for (const d of ["M1 3h10", "M4.5 3V1.5h3V3", "M2.5 3l.75 9.5h5.5L9.5 3", "M5 5.5v5", "M7 5.5v5"]) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", "1.2");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      svg.append(path);
    }
    return svg;
  }

  /**
   * A lamp's row: the end of its id, its model, its name, a button that blinks it, and one that forgets it. The end of
   * its id matches nothing printed on the lamp: Identify tells which lamp a row is.
   * A lamp the plugin didn't find the last time it looked is greyed out, with "Not found" in place of its Identify
   * button (#198).
   */
  function lampRow([id, lamp]) {
    const label = `${lamp.model} - ${id.slice(-4)}`;
    const name = document.createElement("sdpi-textfield");
    name.setAttribute("maxlength", String(MAX_NAME_LENGTH));
    name.setAttribute("placeholder", label);
    name.value = lamp.name ?? "";
    // Added after the value is set, so only the user's typing reaches it.
    name.addEventListener("valuechange", () => rename(id, name.value ?? ""));

    const missing = found !== undefined && !found.includes(id);
    const row = document.createElement("tr");
    row.className = missing ? "lamp missing" : "lamp";
    const nameCell = cell("td", name);
    nameCell.className = "name";
    const identify = button("Identify", () => client.send("sendToPlugin", { event: "identify", id }));
    const notFound = note("Not found");
    (missing ? identify : notFound).setAttribute("aria-hidden", "true");
    const identifyOrMissing = document.createElement("div");
    identifyOrMissing.className = "identify-or-missing";
    identifyOrMissing.append(identify, notFound);
    const identifyCell = cell("td", identifyOrMissing);
    identifyCell.className = "identify";
    const trash = document.createElement("button");
    trash.type = "button";
    trash.className = "forget";
    trash.title = `Forget ${lamp.name ?? label}`;
    trash.setAttribute("aria-label", trash.title);
    trash.append(trashCan());
    trash.addEventListener("click", () => forget(id));
    row.append(cell("td", id.slice(-4)), cell("td", lamp.model), nameCell, identifyCell, cell("td", trash));
    return row;
  }

  /** The table of the lamps the plugin knows, in the order of their ids. */
  function lampTable() {
    const table = document.createElement("table");
    const model = cell("th", "Model");
    model.className = "model";
    const head = cell("tr", cell("th", "ID"), model, cell("th", "Name"), cell("th"), cell("th"));
    const rows = Object.entries(lamps).sort(([a], [b]) => (a < b ? -1 : 1));
    table.append(cell("thead", head), cell("tbody", ...rows.map(lampRow)));
    return table;
  }

  /**
   * A checkbox that can also be indeterminate, which calls `onClick` when it's clicked, or toggled with the space bar.
   * Its state is its `aria-checked`: "true", "false" or "mixed".
   */
  function triStateCheckbox(label, onClick) {
    const box = document.createElement("div");
    box.className = "tri-state";
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", "false");
    box.tabIndex = 0;
    const symbol = document.createElement("span");
    symbol.className = "symbol";
    const text = document.createElement("span");
    text.className = "text";
    text.textContent = label;
    box.append(symbol, text);
    box.addEventListener("click", onClick);
    box.addEventListener("keydown", (event) => {
      if (event.key === " ") {
        event.preventDefault();
        onClick();
      }
    });
    return box;
  }

  //* Choices every dial or every key shares, which one dial or one key can make otherwise on its own page: the lamp
  // screens' blink (#144), and whether a key takes in lamps added later (#147). Each is a global setting, and the ids
  // of the dials or keys that chose otherwise. The plugin settings show every one's at once, indeterminate when they
  // differ, and a click there gives every one the same again, even the ones not on screen. A dial's or key's page shows
  // its own, in the element the page has for it.

  /** The ids in the global settings, or none when they aren't a list of ids. */
  function validIds(value) {
    return Array.isArray(value) ? value.filter((id) => typeof id === "string") : [];
  }

  /**
   * A choice every dial or every key shares, kept in the global setting `setting` and the ids in `exceptions`, which
   * holds `fallback` until the global settings arrive. Returns the plugin settings' checkbox for every one, labeled
   * `every`, and puts the page's own, labeled `own`, in the element with the id `ownElement`, on a page for that
   * `controller` ("Encoder" or "Keypad"). `onOwnChange` hears the page's own choice each time it's shown.
   */
  function sharedChoice({ setting, exceptions, fallback, every, own, ownElement, controller, onOwnChange = () => {} }) {
    // The plugin's setting, the ids that chose otherwise, and the id of the dial or key whose page this is, if it is
    // one.
    let chosen = fallback;
    let others = [];
    let ownId;
    const read = (value) => (typeof value === "boolean" ? value : fallback);

    // Saved at once, without sdpi-components' wait for more changes, so a page closed right after a click keeps it.
    const [readChosen, saveChosen] = SDPIComponents.useGlobalSettings(
      setting,
      (value) => {
        chosen = read(value);
        render();
      },
      0,
    );
    const [readOthers, saveOthers] = SDPIComponents.useGlobalSettings(
      exceptions,
      (value) => {
        others = validIds(value);
        render();
      },
      0,
    );

    /**
     * The choice of the dial or key whose page this is: the plugin's setting, or the opposite if it chose otherwise.
     */
    const ownChoice = () => chosen !== others.includes(ownId);

    /** Shows the choice on both checkboxes, and saves the ids that chose otherwise. */
    const storeOthers = () => {
      render();
      saveOthers(others).catch((error) => console.error(`Can't save ${exceptions}`, error));
    };

    // Every one's: checked turns it off for every one, and empty or indeterminate turns it on for every one.
    const everyBox = triStateCheckbox(every, () => {
      chosen = !(chosen && others.length === 0);
      others = [];
      saveChosen(chosen).catch((error) => console.error(`Can't save ${setting}`, error));
      storeOthers();
    });

    // The page's own. A checkbox from sdpi-components that saves nothing itself, and also reports the changes this
    // script makes, which match the setting already and are left out, so only a click changes it.
    const ownBox = document.createElement("sdpi-checkbox");
    ownBox.setAttribute("label", own);
    ownBox.addEventListener("valuechange", () => {
      if (ownId === undefined || ownBox.value === ownChoice()) {
        return;
      }
      others = others.includes(ownId) ? others.filter((id) => id !== ownId) : [...others, ownId];
      storeOthers();
    });

    /** Shows the choice on both checkboxes. */
    function render() {
      everyBox.setAttribute("aria-checked", others.length > 0 ? "mixed" : String(chosen));
      if (ownId !== undefined) {
        ownBox.value = ownChoice();
        onOwnChange(ownChoice());
      }
    }

    (async () => {
      const info = await client.getConnectionInfo();
      const ownContainer = document.getElementById(ownElement);
      if (info?.actionInfo?.payload?.controller === controller && ownContainer !== null) {
        ownId = info.actionInfo.context;
        ownContainer.append(ownBox);
      }
      [chosen, others] = await Promise.all([readChosen().then(read), readOthers().then(validIds)]);
      render();
    })().catch((error) => console.error(`Can't show ${setting}`, error));

    return everyBox;
  }

  const everyDialBlink = sharedChoice({
    setting: "blinkOnLampScreen",
    exceptions: "blinkOnLampScreenExceptions",
    fallback: false,
    every: "Blink each lamp as it's shown, on every dial",
    own: "Blink each lamp as it's shown, on this dial",
    ownElement: "dial-blink",
    controller: "Encoder",
  });

  // The key's own choice also tells the lamp picker whether a lamp it hasn't listed yet is one the key acts on.
  const everyKeyAddsNewLamps = sharedChoice({
    setting: "addNewLamps",
    exceptions: "addNewLampsExceptions",
    fallback: true,
    every: "Add new lamps automatically, on every key",
    own: "Add new lamps automatically, on this key",
    ownElement: "key-new-lamps",
    controller: "Keypad",
    onOwnChange: (adds) => document.dispatchEvent(new CustomEvent("litra:adds-new-lamps", { detail: adds })),
  });

  //* Re-sync lamps (#214): brings the lamps the plugin knows that are connected and the plugin back in step, after a
  // change made another way, such as with a lamp's own buttons, in the direction the radio buttons above it choose. The
  // page keeps the choice as a global setting, and sends it with the re-sync: the save reaches the plugin through
  // Stream Deck, apart from the re-sync, so a press right after a choice could otherwise come first. The plugin to the
  // lamps is the default, since it only reads the lamps.

  // In the order they're offered, as src/settings/schemas.ts lists them.
  const RESYNC_DIRECTIONS = [
    ["lampsToPlugin", "Sync the lamps to the plugin"],
    ["pluginToLamps", "Sync the plugin to the lamps"],
  ];
  const resyncDirection = globalRadio("resyncDirection", RESYNC_DIRECTIONS, "pluginToLamps");

  /**
   * Asks the plugin to re-sync, in the direction chosen, or the default one before the global settings arrive. The
   * plugin logs a lamp it can't read or set, which the page has no way to show.
   */
  function resync() {
    const direction = resyncDirection.value || resyncDirection.getAttribute("default");
    client
      .send("sendToPlugin", { event: "resync", direction })
      .catch((error) => console.error("Can't re-sync the lamps", error));
  }

  /** Logs a failure to find the lamps, which the page has no other way to show. */
  function showError(error) {
    console.error("Can't show the lamps", error);
  }

  // The controls are on the page from the start, though hidden, since sdpi-components only gives a control the
  // global settings that arrive once it's on the page. Only the lamps are drawn again.
  const toggleButton = button("Plugin settings", () => toggle().catch(showError));
  const lampList = document.createElement("div");
  lampList.className = "lamp-list";
  const view = document.createElement("div");
  view.hidden = true;
  const editor = document.createElement("div");
  editor.className = "cell-editor";
  editor.hidden = true;
  // The settings come by their reach: first the lamps', whichever key or dial acts on them, then the keys', then the
  // dials', with their text styles, which both their screens take (#183), before their main screens' and their lamp
  // screens', under headings of their own. A subsection with a single
  // setting is a row's label until it grows. The "The plugin settings are laid out by reach" section of
  // docs/contributing.md describes where a new setting goes.
  view.append(
    section("Lamps"),
    item(
      undefined,
      button("Find lamps", () => findLamps().catch(showError)),
    ),
    lampList,
    item("Re-sync", resyncDirection),
    item(undefined, button("Re-sync lamps", resync)),
    item(
      "Brightness",
      globalCheckbox("keepBrightnessDifference", "Each lamp steps from its own brightness, on every dial and key"),
    ),
    item(
      "Temperature",
      globalCheckbox("keepTemperatureDifference", "Each lamp steps from its own temperature, on every dial and key"),
    ),
    item("Blink length", globalNumber("identifyBlinkMs", { min: 300, max: 1500, step: 50, fallback: 400, unit: "ms" })),
    section("Keys"),
    item("New lamps", everyKeyAddsNewLamps),
    item("Turn on", globalCheckbox("setBrightnessKeysTurnLampsOn", "Set Brightness keys turn lamps on")),
    item(undefined, globalCheckbox("brightnessUpKeysTurnLampsOn", "Brightness Up keys turn lamps on")),
    item(undefined, globalCheckbox("brightnessDownKeysTurnLampsOn", "Brightness Down keys turn lamps on")),
    item(undefined, globalCheckbox("setTemperatureKeysTurnLampsOn", "Set Temperature keys turn lamps on")),
    item(undefined, globalCheckbox("temperatureUpKeysTurnLampsOn", "Temperature Up keys turn lamps on")),
    item(undefined, globalCheckbox("temperatureDownKeysTurnLampsOn", "Temperature Down keys turn lamps on")),
    section("Dials"),
    item("Text styles", textStyle("Primary", "lampScreenPrimary", "#ffffff")),
    item(undefined, textStyle("Secondary", "lampScreenSecondary", "#202020")),
    item(undefined, textStyle("Accent", "lampScreenAccent", "#4dd0e1")),
    item(undefined, textStyle("Alert", "lampScreenAlert", "#ff6b6b", "bold")),
    item(undefined, subsection("Main screen")),
    item("Turn on", globalCheckbox("setBrightnessDialsTurnLampsOn", "Set Brightness dials turn lamps on")),
    item(undefined, globalCheckbox("setTemperatureDialsTurnLampsOn", "Set Temperature dials turn lamps on")),
    item(
      "Layout",
      mainScreenParts([
        ["Icon", "mainScreenIconStyle"],
        ["Value", "mainScreenValueStyle"],
        ["Bar", "mainScreenBarStyle"],
      ]),
    ),
    item(undefined, subsection("Lamp screens")),
    item("Blink", everyDialBlink),
    item("Turn on", globalCheckbox("setBrightnessLampScreensTurnLampsOn", "Set Brightness dials turn the lamp on")),
    item(undefined, globalCheckbox("setTemperatureLampScreensTurnLampsOn", "Set Temperature dials turn the lamp on")),
    item("Layout", lampScreenCells()),
  );
  container.append(item(undefined, toggleButton), view, editor);
  readCellOptions()
    .then((value) => {
      cellOptions = validObject(value);
    })
    .catch((error) => console.error("Can't read the lamp screens' options", error));

  /**
   * Shows the button's text, and the plugin settings when they're open, with the lamps the plugin knows. A name field
   * being typed in isn't redrawn, so the names that arrive from Stream Deck as the plugin saves them don't move its
   * cursor.
   */
  function render() {
    toggleButton.textContent = open ? "Back" : "Plugin settings";
    view.hidden = !open || editing !== undefined;
    editor.hidden = editing === undefined;
    renderEditor();
    if (!open || document.activeElement?.closest("#plugin-settings sdpi-textfield")) {
      return;
    }
    if (Object.keys(lamps).length === 0) {
      const none = note("No lamps found");
      none.classList.add("alert");
      lampList.replaceChildren(item(undefined, none));
    } else {
      lampList.replaceChildren(lampTable());
    }
  }
})();
