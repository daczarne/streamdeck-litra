// The groups of a scene (#174), each of which turns its lamps off, or on at its own brightness and temperature, on one
// row: a switch for its power, and number fields for its presets. The first group is the page's own controls, which
// save the key's settings as a scene with a single group saves them. While a group's power is off, its presets don't
// apply: this greys them out, so they show a dash in place of their values, which they keep, and shows a note under
// them that says so. The groups added after it are drawn here, under a heading each, and saved as `addedGroups`: each
// with its power, its presets, and the ids of the lamps checked for it, among the lamps the plugin knows (#194),
// keeping the ones it no longer knows, such as one forgotten. No two groups hold the same lamp: a lamp another group
// holds, the first included, is greyed out, and says which group holds it, here and in the first group's lamp picker
// (lamp-picker.js), which tells this of the lamps the first group holds, as this tells it of the ones the others do,
// through events on the document. A lamp that a group added after the first checks leaves the first, as the plugin
// takes it. The lamps, with their names, come from the plugin's global settings, where the plugin saves them. Only
// adding or removing a group, or groups that arrive changed, draw the groups again: a change to a group saves it in
// place, and a lamp checked or unchecked draws the lamp lists alone, since a page drawn again scrolls while its new
// controls are drawn. Each group, the first included, has a radio button that says it's the one a key that adds new
// lamps adds them to (#279), greyed out while the key doesn't, and saved as `newLamps` on each group added after the
// first, none of which says so while the first takes them, as it does by default, and once the group that took them is
// removed. A group other than the first that takes them holds the lamps the first group hasn't listed yet, as the
// plugin takes it: they show checked there, and greyed out elsewhere, and unchecking one leaves it out, as unchecking
// it in the first group would. A file rather than an inline script, so the pages' Content-Security-Policy doesn't have to allow
// inline scripts.
(() => {
  const container = document.getElementById("added-groups");
  if (container === null) {
    return;
  }

  // A group as it's added: on, at the presets' defaults, as a new key's are, with no lamps.
  const NEW_GROUP = { power: "on", presetPercentage: 0, presetKelvin: 2700, lamps: [], newLamps: false };

  // The groups added after the first, as saved.
  let groups = [];
  // The lamps the plugin knows, by id, from its global settings, or undefined until they're read.
  let known;
  // Each group's list of lamps, as last drawn, by the group's place.
  let lampLists = [];
  // The ids of the lamps the first group holds, as its lamp picker shows them, and of the ones it hasn't listed yet.
  let firstGroupLamps = [];
  let unlisted = [];
  // Whether the key takes in lamps added later, as plugin-settings.js says, which every key does by default.
  let addsNew = true;
  // Each group's radio button for whether it takes the lamps added later, by the group's number.
  let radios = [];

  /**
   * @typedef {object} Group A group added after the first, as the key saves it.
   * @property {"on" | "off"} power whether it turns its lamps on or off
   * @property {number} presetPercentage its brightness
   * @property {number} presetKelvin its temperature
   * @property {string[]} lamps the ids of the lamps checked for it
   * @property {boolean} newLamps whether it takes the lamps added later
   */

  /** @typedef {{ id: string, label: string, heldBy: number | undefined }} ListedLamp A lamp a group lists. */

  // The first group's presets, greyed out with the note under them while it turns its lamps off.
  const power = document.getElementById("power");
  const firstPresets = document.querySelectorAll(".first-group-preset");
  const firstOffNote = document.getElementById("first-group-off-note");
  /**
   * Greys out the first group's presets, and shows the note under them, while it turns its lamps off.
   *
   * @returns {void}
   */
  const showFirstPresets = () => {
    for (const preset of firstPresets) {
      preset.disabled = power.value === "off";
    }
    firstOffNote.hidden = power.value !== "off";
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

  /**
   * The groups as the key saved them, each with its settings' defaults for the ones that aren't valid.
   *
   * @param {unknown} value what the key saved as `addedGroups`
   * @returns {Group[]}
   */
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
        newLamps: group.newLamps === true,
      }));
  }

  /**
   * The number of the group the lamps added later go to: the first added group that says it takes them, as the plugin
   * takes it, or else the first group.
   *
   * @returns {number}
   */
  function newLampsGroup() {
    const index = groups.findIndex((group) => group.newLamps);
    return index === -1 ? 1 : index + 2;
  }

  /**
   * The lamps the plugin knows, by id, or none when they aren't lamps by id: each with a model, and a
   * name only when it's text.
   *
   * @param {unknown} value the global settings' `lamps`
   * @returns {Record<string, { model: string, name?: string }>}
   */
  function validKnown(value) {
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

  /**
   * The group that holds each lamp, by the lamp's id, as the page numbers it: the first added group that checks the
   * lamp, as the plugin takes it, since only an edited profile has two groups check the same lamp. The first group's
   * lamps aren't among them: the lamp picker leaves out the ones these hold.
   *
   * @returns {Record<string, number>}
   */
  function holders() {
    const held = {};
    groups.forEach((group, index) => {
      for (const id of group.lamps) {
        held[id] ??= index + 2;
      }
    });
    const taker = newLampsGroup();
    if (addsNew && taker !== 1) {
      for (const id of unlisted) {
        held[id] ??= taker;
      }
    }
    return held;
  }

  /**
   * Groups as the key saves them: every setting written out, and the ids of their lamps.
   *
   * @param {Group[]} list
   * @returns {Group[]}
   */
  function asSaved(list) {
    return list.map(({ power: groupPower, presetPercentage, presetKelvin, lamps, newLamps }) => ({
      power: groupPower,
      presetPercentage,
      presetKelvin,
      lamps: [...lamps],
      newLamps,
    }));
  }

  /**
   * Saves the groups.
   *
   * @returns {void}
   */
  function save() {
    saveGroups(asSaved(groups)).catch((error) => console.error("Can't save the groups", error));
  }

  /**
   * A row of its own, as wide as the page's controls, holding `content`, with `label` on its left.
   *
   * @param {string | undefined} label
   * @param {...Node} content
   * @returns {HTMLElement}
   */
  function item(label, ...content) {
    const element = document.createElement("sdpi-item");
    if (label !== undefined) {
      element.setAttribute("label", label);
    }
    element.append(...content);
    return element;
  }

  /**
   * A button from sdpi-components.
   *
   * @param {string} text
   * @param {() => void} onClick
   * @returns {HTMLElement}
   */
  function button(text, onClick) {
    const element = document.createElement("sdpi-button");
    element.textContent = text;
    element.addEventListener("click", onClick);
    return element;
  }

  /**
   * A control from sdpi-components that saves nothing itself, showing `value`, which calls `onChange` with a new value.
   * Its listener is added after the value is set, so only the user's changes reach it.
   *
   * @param {string} tag the control's element, such as `sdpi-checkbox`
   * @param {unknown} value
   * @param {(value: any) => void} onChange
   * @param {{ label?: string, disabled?: boolean }} [options] its label, and whether it's greyed out
   * @returns {HTMLElement}
   */
  function control(tag, value, onChange, { label, disabled = false } = {}) {
    const element = document.createElement(tag);
    element.disabled = disabled;
    if (label !== undefined) {
      element.setAttribute("label", label);
    }
    element.value = value;
    element.addEventListener("valuechange", () => onChange(element.value));
    return element;
  }

  /**
   * A number field with − and + (number-field.js, #195), as the first group's, which saves nothing itself, and calls
   * `onChange` with the user's new value.
   *
   * @param {number} value
   * @param {{ min: number, max: number, step: number, unit: string }} range its range, step and unit
   * @param {(value: number) => void} onChange
   * @returns {HTMLElement}
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

  /**
   * The note under a group's controls while it turns its lamps off, which the group shows and hides.
   *
   * @returns {HTMLParagraphElement}
   */
  function offNote() {
    const element = document.createElement("p");
    element.className = "off-note";
    element.textContent = "Temperature and Brightness aren't applied while Power is off";
    return element;
  }

  /**
   * A line of grey text.
   *
   * @param {string} text
   * @returns {HTMLParagraphElement}
   */
  function note(text) {
    const element = document.createElement("p");
    element.className = "note";
    element.textContent = text;
    return element;
  }

  /**
   * The lamps a group lists: the ones the plugin knows, in the order of their ids, as the lamp
   * picker lists them, each with its name, or else its label, and the group that holds it.
   *
   * @returns {ListedLamp[]}
   */
  function listed() {
    const held = { ...Object.fromEntries(firstGroupLamps.map((id) => [id, 1])), ...holders() };
    return Object.entries(known ?? {})
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([id, lamp]) => ({ id, label: lamp.name ?? `${lamp.model} - ${id.slice(-4)}`, heldBy: held[id] }));
  }

  /**
   * A lamp's row in a group: its checkbox, by its name or else its label, checked when the group holds it, and greyed
   * out, with the group that does, when another one holds it.
   *
   * @param {Group} group
   * @param {number} number the group's number on the page
   * @param {ListedLamp} lamp
   * @returns {HTMLDivElement}
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
          // A lamp the group holds as one the first group hasn't listed yet is left out there, so the group no longer
          // takes it.
          if (!checked && !group.lamps.includes(lamp.id)) {
            document.dispatchEvent(new CustomEvent("litra:leave-out", { detail: lamp.id }));
            return;
          }
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

  /**
   * A group's lamps: a row for each, or what stands in for them until they're read, or when the plugin knows none.
   *
   * @param {Group} group
   * @param {number} number the group's number on the page
   * @returns {HTMLElement[]}
   */
  function lampRows(group, number) {
    if (known === undefined) {
      return [];
    }
    const lamps = listed();
    return lamps.length === 0 ? [note("No lamps found")] : lamps.map((lamp) => lampRow(group, number, lamp));
  }

  /**
   * Draws every group's lamps again, and tells the lamp picker of the lamps the groups hold, and of the group the lamps
   * added later go to.
   *
   * @returns {void}
   */
  function renderLamps() {
    lampLists.forEach((list, index) => {
      const group = groups[index];
      if (group !== undefined) {
        list.replaceChildren(...lampRows(group, index + 2));
      }
    });
    tellPicker();
  }

  /**
   * Tells the lamp picker of the group the lamps added later go to, and of the lamps the groups hold.
   *
   * @returns {void}
   */
  function tellPicker() {
    document.dispatchEvent(new CustomEvent("litra:new-lamps-group", { detail: newLampsGroup() }));
    document.dispatchEvent(new CustomEvent("litra:held-lamps", { detail: holders() }));
  }

  /**
   * A group's radio button for whether it takes the lamps added later: a radio from sdpi-components with that option
   * alone, which saves nothing itself, chosen for one group at a time, and greyed out while the key adds no new lamps.
   * It also reports the values this script gives it, which are left out, so only a choice moves the lamps added later.
   *
   * @param {number} number the group's number on the page
   * @returns {HTMLElement}
   */
  function newLampsRadio(number) {
    const radio = document.createElement("sdpi-radio");
    const option = document.createElement("option");
    option.value = "takes";
    option.textContent = "Add new lamps to this group";
    radio.append(option);
    radio.addEventListener("valuechange", () => {
      if (radio.value !== "takes" || newLampsGroup() === number) {
        return;
      }
      groups.forEach((group, index) => {
        group.newLamps = index + 2 === number;
      });
      save();
      showRadios();
      renderLamps();
    });
    radios[number] = radio;
    return radio;
  }

  /**
   * Shows each group's radio button: the one of the group the lamps added later go to chosen, and all greyed out while
   * the key adds no new lamps.
   *
   * @returns {void}
   */
  function showRadios() {
    const taker = newLampsGroup();
    radios.forEach((radio, number) => {
      radio.disabled = !addsNew;
      radio.value = number === taker ? "takes" : undefined;
    });
  }

  /**
   * A group's heading and controls, numbered after the first group, with a button that removes it.
   *
   * @param {Group} group
   * @param {number} index its place among the groups added after the first
   * @returns {HTMLDivElement}
   */
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
      numberField(group.presetKelvin, { min: 2700, max: 6500, step: 100, unit: "K" }, change("presetKelvin")),
      numberField(group.presetPercentage, { min: 0, max: 100, step: 1, unit: "%" }, change("presetPercentage")),
    ];
    const off = offNote();
    const showPresets = () => {
      for (const preset of presets) {
        preset.disabled = group.power === "off";
      }
      off.hidden = group.power !== "off";
    };
    showPresets();
    const power = document.createElement("litra-switch");
    power.value = group.power;
    power.addEventListener("valuechange", () => {
      change("power")(power.value);
      showPresets();
    });
    // The group's power and presets on one row, under their labels, and the note under them, as the first group's.
    const row = document.createElement("div");
    row.className = "scene-row";
    for (const label of ["Power", "Temperature", "Brightness"]) {
      const element = document.createElement("span");
      element.textContent = label;
      row.append(element);
    }
    row.append(power, ...presets, off);
    const list = document.createElement("div");
    list.className = "group-lamps";
    list.append(...lampRows(group, number));
    lampLists[index] = list;
    const view = document.createElement("div");
    view.className = "group";
    view.append(
      heading,
      row,
      item("Lamps", list, newLampsRadio(number)),
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

  /**
   * Draws the groups added after the first, and tells the lamp picker of the lamps they hold.
   *
   * @returns {void}
   */
  function render() {
    lampLists = [];
    radios = radios.slice(0, 2);
    container.replaceChildren(
      ...groups.map(groupView),
      item(
        undefined,
        button("Add a new group", () => {
          groups.push({ ...NEW_GROUP, lamps: [] });
          save();
          render();
        }),
      ),
    );
    showRadios();
    tellPicker();
  }

  (async () => {
    // Told each time the picker draws its lamps, so the same ones draw nothing again.
    document.addEventListener("litra:first-group-lamps", (event) => {
      if (JSON.stringify(event.detail) !== JSON.stringify(firstGroupLamps)) {
        firstGroupLamps = event.detail;
        renderLamps();
      }
    });
    document.addEventListener("litra:unlisted-lamps", (event) => {
      if (JSON.stringify(event.detail) !== JSON.stringify(unlisted)) {
        unlisted = event.detail;
        renderLamps();
      }
    });
    document.addEventListener("litra:adds-new-lamps", (event) => {
      addsNew = event.detail;
      showRadios();
      renderLamps();
    });
    document.getElementById("first-group-new-lamps")?.append(newLampsRadio(1));
    render();
    [groups, known] = await Promise.all([readGroups().then(validGroups), readKnown().then(validKnown)]);
    render();
  })().catch((error) => console.error("Can't show the groups", error));
})();
