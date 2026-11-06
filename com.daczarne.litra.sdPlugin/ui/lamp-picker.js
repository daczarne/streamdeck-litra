// The lamps a key acts on (#20): a checkbox for each lamp the plugin knows (#194), and one for every lamp. The lamps
// come from the plugin's global settings, where the plugin saves them, and the page looks for none: Find lamps in the
// plugin settings does (plugin-settings.js). Each lamp shows with the name given to it in the plugin settings (#146), or
// else its label, such as "Beam - c870": its model and the last 4 characters of its id. The key saves the ids of the lamps checked, as `lamps`, and of the ones left
// unchecked, as `leftOutLamps`, and keeps the ids of the lamps the plugin no longer knows, such as one forgotten, which
// comes back as the key left it once the plugin knows it again. A key that adds new lamps acts on every lamp but the
// left out ones, so a lamp it hasn't listed yet shows checked, and one that doesn't acts on the checked ones alone
// (#147). Whether it adds them comes from plugin-settings.js, which shows that choice. On a Scene key's page, a lamp a
// group added after the first holds is greyed out, and says which group holds it (scene-groups.js, #174), while the key
// keeps what it saved for it, which applies again once no group holds it. All is then greyed out too, since it means
// every lamp the plugin knows, which the first group no longer can have. The lamps the key acts on, its scene's first
// group, are told to scene-groups.js, through an event on the document.
// `lamps` is "all" for a key saved before lamps could be picked, or never saved, which acts on every lamp. A file rather
// than an inline script, so the pages' Content-Security-Policy doesn't have to allow inline scripts.
(() => {
  const picker = document.getElementById("lamp-picker");
  if (picker === null) {
    return;
  }
  const client = SDPIComponents.streamDeckClient;

  // What the key has saved: "all", or the ids of the lamps checked, and of the lamps left out.
  let saved = "all";
  let leftOut = [];
  // Whether the key takes in lamps added later, as plugin-settings.js says, which every key does by default.
  let addsNew = true;
  // The lamps the plugin knows, by id, from its global settings, or undefined until they're read.
  let known;
  // The number of the scene group that holds each lamp, by lamp id, on a Scene key's page.
  let held = {};
  // Whether the page is a key's, which the picker draws only on, once the page knows it.
  let onKey = false;

  const style = document.createElement("style");
  style.textContent = `
    #lamp-picker .lamp {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    #lamp-picker .note {
      color: #969696;
      margin: 0;
      padding: 4px 0;
    }
  `;
  document.head.append(style);

  // A missing setting is a key from before lamps could be picked, which acts on every lamp.
  const [readSaved, save] = SDPIComponents.useSettings(
    "lamps",
    (value) => {
      saved = validChecked(value);
      render();
    },
    0,
  );

  const [readLeftOut, saveLeftOut] = SDPIComponents.useSettings(
    "leftOutLamps",
    (value) => {
      leftOut = validIds(value);
      render();
    },
    0,
  );

  // The lamps arrive with the global settings, each time the plugin saves them.
  const [readKnown] = SDPIComponents.useGlobalSettings("lamps", (value) => {
    known = validKnown(value);
    render();
  });

  /** A list of lamp ids as the key saves them, or none when it isn't one. */
  function validIds(value) {
    return Array.isArray(value) ? value.filter((id) => typeof id === "string") : [];
  }

  /** The lamps checked, as the key saves them: "all" for a key that never saved them, or their ids. */
  function validChecked(value) {
    return value === undefined || value === "all" ? "all" : validIds(value);
  }

  /**
   * The lamps the plugin knows, by id, or none when they aren't lamps by id: each with a model, and a
   * name only when it's text.
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
   * Every lamp the page lists: the ones the plugin knows, in the order of their ids, as the plugin
   * settings list them, each with its name, or else its label.
   */
  function listed() {
    return Object.entries(known ?? {})
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([id, lamp]) => ({ id, label: lamp.name ?? `${lamp.model} - ${id.slice(-4)}` }));
  }

  /**
   * Whether the key acts on a lamp: every lamp for a key that has saved none, a lamp checked or left out as saved, and
   * a lamp it hasn't listed yet only if it adds new lamps.
   */
  function isChecked(lamp) {
    if (saved === "all" || saved.includes(lamp.id)) {
      return true;
    }
    return !leftOut.includes(lamp.id) && addsNew;
  }

  /**
   * Saves which of the listed lamps the key acts on, and which it leaves out, keeping the lamps the plugin doesn't know
   * as they were saved, and shows them.
   */
  function store(checked) {
    const lamps = listed();
    const unknown = (ids) => ids.filter((id) => known?.[id] === undefined);
    saved = [...lamps.filter(checked).map(({ id }) => id), ...unknown(saved === "all" ? [] : saved)];
    leftOut = [...lamps.filter((lamp) => !checked(lamp)).map(({ id }) => id), ...unknown(leftOut)];
    render();
    save(saved).catch((error) => console.error("Can't save the lamps", error));
    saveLeftOut(leftOut).catch((error) => console.error("Can't save the lamps left out", error));
  }

  /** Checks or unchecks one lamp, keeping the others as they show. */
  function toggleLamp(toggled, checked) {
    store((lamp) => (lamp.id === toggled.id ? checked : isChecked(lamp)));
  }

  /** A checkbox from sdpi-components, which saves nothing itself, since it has no `setting`. */
  function checkbox(label, checked, onChange, disabled = false) {
    const box = document.createElement("sdpi-checkbox");
    box.setAttribute("label", label);
    box.disabled = disabled;
    box.value = checked;
    // Added after the value is set, so only the user's clicks reach it.
    box.addEventListener("valuechange", () => onChange(box.value === true));
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
   * A lamp's row: its checkbox, by its name or else its label. A lamp a scene group holds shows unchecked and greyed
   * out, with the group that holds it.
   */
  function lampRow(lamp) {
    const holder = held[lamp.id];
    const row = document.createElement("div");
    row.className = "lamp";
    row.append(
      checkbox(
        lamp.label,
        holder === undefined && isChecked(lamp),
        (value) => toggleLamp(lamp, value),
        holder !== undefined,
      ),
    );
    if (holder !== undefined) {
      row.append(note(`in group ${holder}`));
    }
    return row;
  }

  /** Draws the picker from what the key has saved and the lamps the plugin knows, on a key's page, once they're read. */
  function render() {
    if (!onKey || known === undefined) {
      return;
    }
    const rows = [];
    const lamps = listed();
    if (lamps.length === 0) {
      rows.push(note("No lamps found"));
    }
    rows.push(...lamps.map(lampRow));
    // All is every lamp the plugin knows, so on a Scene key's page, it's unchecked and greyed out once a group added
    // after the first holds a lamp, which the first group can't have.
    const free = (lamp) => held[lamp.id] === undefined;
    const someHeld = !lamps.every(free);
    rows.push(checkbox("All", !someHeld && lamps.every(isChecked), (value) => store(() => value), someHeld));
    const own = lamps.filter((lamp) => free(lamp) && isChecked(lamp)).map(({ id }) => id);
    document.dispatchEvent(new CustomEvent("litra:first-group-lamps", { detail: own }));
    picker.replaceChildren(...rows);
  }

  // Listened for from the start, since scene-groups.js may tell it before this page knows it's a key's. Lamps held as
  // before draw nothing again, since this tells scene-groups.js of its own lamps each time it draws them.
  document.addEventListener("litra:held-lamps", (event) => {
    if (JSON.stringify(event.detail) === JSON.stringify(held)) {
      return;
    }
    held = event.detail;
    render();
  });

  // Listened for from the start, since plugin-settings.js may tell it before this page knows it's a key's.
  document.addEventListener("litra:adds-new-lamps", (event) => {
    addsNew = event.detail;
    render();
  });

  (async () => {
    // A dial's main screen acts on every lamp, so a page shared with a dial lists none there.
    const info = await client.getConnectionInfo();
    if (info?.actionInfo?.payload?.controller === "Encoder") {
      return;
    }
    onKey = true;
    const [checked, left, lamps] = await Promise.all([readSaved(), readLeftOut(), readKnown()]);
    saved = validChecked(checked);
    leftOut = validIds(left);
    known = validKnown(lamps);
    render();
  })().catch((error) => console.error("Can't show the lamps", error));
})();
