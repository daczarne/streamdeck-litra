// The groups of a scene (#174), each of which turns its lamps off, or on at its own brightness and temperature. The
// first group is the page's own controls, which save the key's settings as a scene with a single group saves them, and
// whose presets this hides while its power is off. The groups added after it are drawn here, under a heading each, and
// saved as `addedGroups`: each with its power, its presets, and the ids of the lamps checked for it, among the lamps
// the plugin knows (#194), keeping the ones it no longer knows, such as one forgotten. No two groups hold the same
// lamp: a lamp another group holds, the first included, is greyed out, and says which group holds it, here and in the
// first group's lamp picker (lamp-picker.js), which tells this of the lamps the first group holds, as this tells it of
// the ones the others do, through events on the document. A lamp that a group added after the first checks leaves the
// first, as the plugin takes it. The lamps, with their names, come from the plugin's global settings, where the plugin
// saves them. Only adding or removing a group, or groups that arrive changed, draw the groups again: a change to a
// group saves it in place, and a lamp checked or unchecked draws the lamp lists alone, since a page drawn again scrolls
// while its new controls are drawn. A file rather than an inline script, so the pages' Content-Security-Policy doesn't
// have to allow inline scripts.
(() => {
  const container = document.getElementById("added-groups");
  if (container === null) {
    return;
  }

  // A group as it's added: on, at the presets' defaults, as a new key's are, with no lamps.
  const NEW_GROUP = { power: "on", presetPercentage: 0, presetKelvin: 2700, lamps: [] };

  // The groups added after the first, as saved.
  let groups = [];
  // The lamps the plugin knows, by id, from its global settings, or undefined until they're read.
  let known;
  // Each group's list of lamps, as last drawn, by the group's place.
  let lampLists = [];
  // The ids of the lamps the first group holds, as its lamp picker shows them.
  let firstGroupLamps = [];

  // The first group's presets, which don't apply while it turns its lamps off.
  const power = document.getElementById("power");
  const firstPresets = document.querySelectorAll(".first-group-preset");
  const showFirstPresets = () => {
    for (const preset of firstPresets) {
      preset.hidden = (power.value ?? "on") === "off";
    }
  };
  power.addEventListener("valuechange", showFirstPresets);
  showFirstPresets();

  const [readGroups, saveGroups] = SDPIComponents.useSettings(
    "addedGroups",
    (value) => {
      // The groups this page just saved come back unchanged, and aren't drawn again.
      const arrived = validGroups(value);
      if (JSON.stringify(asSaved(arrived)) !== JSON.stringify(asSaved(groups))) {
        groups = arrived;
        render();
      }
    },
    0,
  );

  // The lamps arrive with the global settings, each time the plugin saves them.
  const [readKnown] = SDPIComponents.useGlobalSettings("lamps", (value) => {
    known = validKnown(value);
    renderLamps();
  });

  /** The groups as the key saved them, each with its settings' defaults for the ones that aren't valid. */
  function validGroups(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    const number = (setting, min, max, fallback) =>
      typeof setting === "number" && setting >= min && setting <= max ? setting : fallback;
    return value
      .filter((group) => typeof group === "object" && group !== null && !Array.isArray(group))
      .map((group) => ({
        power: group.power === "off" ? "off" : "on",
        presetPercentage: number(group.presetPercentage, 0, 100, NEW_GROUP.presetPercentage),
        presetKelvin: number(group.presetKelvin, 2700, 6500, NEW_GROUP.presetKelvin),
        lamps: Array.isArray(group.lamps) ? group.lamps.filter((id) => typeof id === "string") : [],
      }));
  }

  /**
   * The lamps the plugin knows, by id, or none when they aren't lamps by id: each with a model and serial end, and a
   * name only when it's text.
   */
  function validKnown(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(value).flatMap(([id, lamp]) =>
        typeof lamp?.model === "string" && typeof lamp?.serialEnd === "string"
          ? [
              [
                id,
                {
                  model: lamp.model,
                  serialEnd: lamp.serialEnd,
                  ...(typeof lamp.name === "string" ? { name: lamp.name } : {}),
                },
              ],
            ]
          : [],
      ),
    );
  }

  /**
   * The group that holds each lamp, by the lamp's id, as the page numbers it: the first added group that checks the
   * lamp, as the plugin takes it, since only an edited profile has two groups check the same lamp. The first group's
   * lamps aren't among them: the lamp picker leaves out the ones these hold.
   */
  function holders() {
    const held = {};
    groups.forEach((group, index) => {
      for (const id of group.lamps) {
        held[id] ??= index + 2;
      }
    });
    return held;
  }

  /** Groups as the key saves them: every setting written out, and the ids of their lamps. */
  function asSaved(list) {
    return list.map(({ power: groupPower, presetPercentage, presetKelvin, lamps }) => ({
      power: groupPower,
      presetPercentage,
      presetKelvin,
      lamps: [...lamps],
    }));
  }

  /** Saves the groups. */
  function save() {
    saveGroups(asSaved(groups)).catch((error) => console.error("Can't save the groups", error));
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

  /**
   * A control from sdpi-components that saves nothing itself, showing `value`, which calls `onChange` with a new value.
   * Its listener is added after the value is set, so only the user's changes reach it.
   */
  function control(tag, value, onChange, { label, options, disabled = false } = {}) {
    const element = document.createElement(tag);
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
    element.addEventListener("valuechange", () => onChange(element.value));
    return element;
  }

  /**
   * A number field with − and + (number-field.js, #195), as the first group's, which saves nothing itself, and calls
   * `onChange` with the user's new value.
   */
  function numberField(value, { min, max, step, unit }, onChange) {
    const field = document.createElement("litra-number");
    for (const [name, setting] of Object.entries({ min, max, step, unit })) {
      field.setAttribute(name, String(setting));
    }
    field.value = value;
    field.addEventListener("valuechange", () => onChange(field.value));
    return field;
  }

  /** A line of grey text. */
  function note(text) {
    const element = document.createElement("p");
    element.className = "note";
    element.textContent = text;
    return element;
  }

  /**
   * The lamps a group lists: the ones the plugin knows, in the order of the ends of their serial numbers, as the lamp
   * picker lists them, each with its name, or else its label, and the group that holds it.
   */
  function listed() {
    const held = { ...Object.fromEntries(firstGroupLamps.map((id) => [id, 1])), ...holders() };
    return Object.entries(known ?? {})
      .sort(([, a], [, b]) => (a.serialEnd < b.serialEnd ? -1 : 1))
      .map(([id, lamp]) => ({ id, label: lamp.name ?? `${lamp.model} - ${lamp.serialEnd}`, heldBy: held[id] }));
  }

  /**
   * A lamp's row in a group: its checkbox, by its name or else its label, checked when the group holds it, and greyed
   * out, with the group that does, when another one holds it.
   */
  function lampRow(group, number, lamp) {
    const elsewhere = lamp.heldBy !== undefined && lamp.heldBy !== number;
    const row = document.createElement("div");
    row.className = "lamp";
    row.append(
      control(
        "sdpi-checkbox",
        lamp.heldBy === number,
        (checked) => {
          group.lamps = checked ? [...group.lamps, lamp.id] : group.lamps.filter((id) => id !== lamp.id);
          save();
          renderLamps();
        },
        { label: lamp.label, disabled: elsewhere },
      ),
    );
    if (elsewhere) {
      row.append(note(`in group ${lamp.heldBy}`));
    }
    return row;
  }

  /** A group's lamps: a row for each, or what stands in for them until they're read, or when the plugin knows none. */
  function lampRows(group, number) {
    if (known === undefined) {
      return [];
    }
    const lamps = listed();
    return lamps.length === 0 ? [note("No lamps found")] : lamps.map((lamp) => lampRow(group, number, lamp));
  }

  /** Draws every group's lamps again, and tells the lamp picker of the lamps the groups hold. */
  function renderLamps() {
    lampLists.forEach((list, index) => {
      const group = groups[index];
      if (group !== undefined) {
        list.replaceChildren(...lampRows(group, index + 2));
      }
    });
    document.dispatchEvent(new CustomEvent("litra:held-lamps", { detail: holders() }));
  }

  /** A group's heading and controls, numbered after the first group, with a button that removes it. */
  function groupView(group, index) {
    const number = index + 2;
    const heading = document.createElement("h2");
    heading.className = "group-heading";
    heading.textContent = `Group ${number}`;
    const change = (setting) => (value) => {
      group[setting] = value;
      save();
    };
    const presets = [
      item(
        "Brightness",
        numberField(group.presetPercentage, { min: 0, max: 100, step: 1, unit: "%" }, change("presetPercentage")),
      ),
      item(
        "Temperature",
        numberField(group.presetKelvin, { min: 2700, max: 6500, step: 100, unit: "K" }, change("presetKelvin")),
      ),
    ];
    const showPresets = () => {
      for (const preset of presets) {
        preset.hidden = group.power === "off";
      }
    };
    showPresets();
    const list = document.createElement("div");
    list.className = "group-lamps";
    list.append(...lampRows(group, number));
    lampLists[index] = list;
    const view = document.createElement("div");
    view.className = "group";
    view.append(
      heading,
      item(
        "Power",
        control(
          "sdpi-select",
          group.power,
          (value) => {
            change("power")(value);
            showPresets();
          },
          {
            options: [
              ["on", "On"],
              ["off", "Off"],
            ],
          },
        ),
      ),
      ...presets,
      item("Lamps", list),
      item(
        undefined,
        button(`Remove group ${number}`, () => {
          groups.splice(index, 1);
          save();
          render();
        }),
      ),
    );
    return view;
  }

  /** Draws the groups added after the first, and tells the lamp picker of the lamps they hold. */
  function render() {
    document.getElementById("first-group-heading").hidden = groups.length === 0;
    lampLists = [];
    container.replaceChildren(
      ...groups.map(groupView),
      item(
        undefined,
        button("Add a group", () => {
          groups.push({ ...NEW_GROUP, lamps: [] });
          save();
          render();
        }),
      ),
    );
    document.dispatchEvent(new CustomEvent("litra:held-lamps", { detail: holders() }));
  }

  (async () => {
    // Told each time the picker draws its lamps, so the same ones draw nothing again.
    document.addEventListener("litra:first-group-lamps", (event) => {
      if (JSON.stringify(event.detail) !== JSON.stringify(firstGroupLamps)) {
        firstGroupLamps = event.detail;
        renderLamps();
      }
    });
    render();
    [groups, known] = await Promise.all([readGroups().then(validGroups), readKnown().then(validKnown)]);
    render();
  })().catch((error) => console.error("Can't show the groups", error));
})();
