// The groups of a scene (#174), each of which turns its lamps off, or on at its own brightness and temperature. The
// first group is the page's own controls, which save the key's settings as a scene with a single group saves them, and
// whose presets this hides while its power is off. The groups added after it are drawn here, under a heading each, and
// saved as `addedGroups`: each with its power, its presets, and the lamps checked for it, with their ids and labels, so
// a lamp that isn't connected keeps its place. No two groups hold the same lamp: a lamp another group holds, the first
// included, is greyed out, and says which group holds it, here and in the first group's lamp picker (lamp-picker.js),
// which tells this of the lamps the first group holds, as this tells it of the ones the others do, through events on
// the document. A lamp that a group added after the first checks leaves the first, as the plugin takes it. The
// lamps found and their names come as the lamp picker gets them. Only adding or removing a group, or groups that
// arrive changed, draw the groups again: a change to a group saves it in place, and a lamp checked or unchecked draws
// the lamp lists alone, since a page drawn again scrolls while its new controls are drawn. A file rather than an
// inline script, so the pages' Content-Security-Policy doesn't have to allow inline scripts.
(() => {
  const container = document.getElementById("added-groups");
  if (container === null) {
    return;
  }

  // A group as it's added: on, at the presets' defaults, as a new key's are, with no lamps.
  const NEW_GROUP = { power: "on", presetPercentage: 0, presetKelvin: 2700, lamps: [] };

  // The groups added after the first, as saved.
  let groups = [];
  // The lamps the plugin found, or undefined while it's asked.
  let found;
  // The lamps' names, by id, from the plugin's global settings.
  let names = {};
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

  // The names arrive with the lamps the plugin knows, in the global settings, each time the plugin saves them.
  const [readNames] = SDPIComponents.useGlobalSettings("lamps", (value) => {
    names = validNames(value);
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
        lamps: Array.isArray(group.lamps) ? group.lamps.filter((lamp) => typeof lamp?.id === "string") : [],
      }));
  }

  /** The names of the lamps the plugin knows, by id, from the global settings, or none when they aren't lamps by id. */
  function validNames(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(value).flatMap(([id, lamp]) => (typeof lamp?.name === "string" ? [[id, lamp.name]] : [])),
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
      for (const { id } of group.lamps) {
        held[id] ??= index + 2;
      }
    });
    return held;
  }

  /** Groups as the key saves them: every setting written out, and each lamp with its id and label alone. */
  function asSaved(list) {
    return list.map(({ power: groupPower, presetPercentage, presetKelvin, lamps }) => ({
      power: groupPower,
      presetPercentage,
      presetKelvin,
      lamps: lamps.map(({ id, label }) => ({ id, label })),
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

  /** A slider with its value on its right, followed while it's dragged, as range-value.js shows the first group's. */
  function slider(value, { min, max, step, suffix }, onChange) {
    const range = control("sdpi-range", value, (changed) => onChange(Number(changed)));
    range.setAttribute("min", String(min));
    range.setAttribute("max", String(max));
    range.setAttribute("step", String(step));
    const output = document.createElement("output");
    const show = (shown) => {
      output.value = `${shown}${suffix}`;
    };
    // sdpi-range only takes the slider's value on release, so a drag is followed on the slider itself.
    range.addEventListener("input", (event) => show(event.composedPath()[0].value));
    show(value);
    const box = document.createElement("div");
    box.className = "range";
    box.append(range, output);
    return box;
  }

  /** A line of grey text. */
  function note(text) {
    const element = document.createElement("p");
    element.className = "note";
    element.textContent = text;
    return element;
  }

  /**
   * The lamps a group lists: the ones found, then the ones it checked that weren't, marked as missing, each with the
   * group that holds it.
   */
  function listedIn(group) {
    const held = { ...Object.fromEntries(firstGroupLamps.map((id) => [id, 1])), ...holders() };
    const lamps = (found ?? []).map(({ id, label }) => ({ id, label, missing: false }));
    for (const { id, label } of group.lamps) {
      if (!lamps.some((lamp) => lamp.id === id)) {
        lamps.push({ id, label, missing: true });
      }
    }
    return lamps.map((lamp) => ({ ...lamp, heldBy: held[lamp.id] }));
  }

  /**
   * A lamp's row in a group: its checkbox, by its name or else its label, checked when the group holds it, and greyed
   * out, with the group that does, when another one holds it, or a note when it isn't connected.
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
          group.lamps = checked
            ? [...group.lamps, { id: lamp.id, label: lamp.label }]
            : group.lamps.filter(({ id }) => id !== lamp.id);
          save();
          renderLamps();
        },
        { label: names[lamp.id] ?? lamp.label, disabled: elsewhere },
      ),
    );
    if (elsewhere) {
      row.append(note(`in group ${lamp.heldBy}`));
    } else if (lamp.missing) {
      row.append(note("not found"));
    }
    return row;
  }

  /** A group's lamps: a row for each, or what stands in for them. */
  function lampRows(group, number) {
    if (found === undefined) {
      return [note("Looking for lamps…")];
    }
    const lamps = listedIn(group);
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
        slider(group.presetPercentage, { min: 0, max: 100, step: 1, suffix: "%" }, change("presetPercentage")),
      ),
      item(
        "Temperature",
        slider(group.presetKelvin, { min: 2700, max: 6500, step: 100, suffix: " K" }, change("presetKelvin")),
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
    // The lamp picker and the plugin settings tell of the lamps they find.
    document.addEventListener("litra:lamps", (event) => {
      found = event.detail;
      renderLamps();
    });
    // Told each time the picker draws its lamps, so the same ones draw nothing again.
    document.addEventListener("litra:first-group-lamps", (event) => {
      if (JSON.stringify(event.detail) !== JSON.stringify(firstGroupLamps)) {
        firstGroupLamps = event.detail;
        renderLamps();
      }
    });
    render();
    [groups, names] = await Promise.all([readGroups().then(validGroups), readNames().then(validNames)]);
    render();
  })().catch((error) => console.error("Can't show the groups", error));
})();
