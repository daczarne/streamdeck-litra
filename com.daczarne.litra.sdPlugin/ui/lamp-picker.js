// The lamps a key acts on (#20): a checkbox for each lamp the plugin finds, and one for every lamp. Each lamp shows
// with the name given to it in the plugin settings (plugin-settings.js, #146), or else its label, such as
// "Beam - 7K98". The key saves the lamps checked, as `lamps`, and the ones listed and left unchecked, as
// `leftOutLamps`, each with its id and its label, so a lamp that isn't connected keeps its place here. A key that adds
// new lamps acts on every lamp but the left out ones, so a lamp it hasn't listed yet shows checked, and one that doesn't
// acts on the checked ones alone (#147). Whether it adds them comes from plugin-settings.js, which shows that choice.
// `lamps` is "all" for a key saved before lamps could be picked, or never saved, which acts on every lamp. A file rather
// than an inline script, so the pages' Content-Security-Policy doesn't have to allow inline scripts.
(() => {
  const picker = document.getElementById("lamp-picker");
  if (picker === null) {
    return;
  }
  const client = SDPIComponents.streamDeckClient;

  // What the key has saved: "all", or the lamps checked, and the lamps left out.
  let saved = "all";
  let leftOut = [];
  // Whether the key adds lamps plugged in later, as plugin-settings.js says, which every key does by default.
  let addsNew = true;
  // The lamps the plugin found, or undefined while it's asked.
  let found;
  // The lamps' names, by id, from the plugin's global settings.
  let names = {};

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
      saved = value ?? "all";
      render();
    },
    0,
  );

  const [readLeftOut, saveLeftOut] = SDPIComponents.useSettings(
    "leftOutLamps",
    (value) => {
      leftOut = validLamps(value);
      render();
    },
    0,
  );

  /** A list of lamps as the key saves them, or none when it isn't one. */
  function validLamps(value) {
    return Array.isArray(value) ? value.filter((lamp) => typeof lamp?.id === "string") : [];
  }

  // Names saved by other pages arrive with the global settings.
  const [readNames] = SDPIComponents.useGlobalSettings("lampNames", (value) => {
    names = validNames(value);
    render();
  });

  /** The names in the global settings, or none when they aren't a set of names by id. */
  function validNames(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return {};
    }
    return Object.fromEntries(Object.entries(value).filter(([, name]) => typeof name === "string"));
  }

  /** Asks the plugin for the lamps connected now, and shows them. */
  async function findLamps() {
    const reply = await client.get(
      "sendToPlugin",
      "sendToPropertyInspector",
      (message) => message.payload?.event === "lamps",
      { event: "lamps" },
    );
    found = reply.payload.lamps;
    render();
  }

  /**
   * Every lamp the page lists: the ones found, then the ones the key has saved, checked or left out, that weren't,
   * marked as missing.
   */
  function listed() {
    const lamps = (found ?? []).map(({ id, label }) => ({ id, label, missing: false }));
    for (const { id, label } of [...(saved === "all" ? [] : saved), ...leftOut]) {
      if (!lamps.some((lamp) => lamp.id === id)) {
        lamps.push({ id, label, missing: true });
      }
    }
    return lamps;
  }

  /**
   * Whether the key acts on a lamp: every lamp for a key that has saved none, a lamp checked or left out as saved, and
   * a lamp it hasn't listed yet only if it adds new lamps.
   */
  function isChecked(lamp) {
    if (saved === "all" || saved.some(({ id }) => id === lamp.id)) {
      return true;
    }
    return !leftOut.some(({ id }) => id === lamp.id) && addsNew;
  }

  /** Saves which of the listed lamps the key acts on, and which it leaves out, and shows them. */
  function store(checked) {
    const lamps = listed();
    const asSaved = ({ id, label }) => ({ id, label });
    saved = lamps.filter(checked).map(asSaved);
    leftOut = lamps.filter((lamp) => !checked(lamp)).map(asSaved);
    render();
    save(saved).catch((error) => console.error("Can't save the lamps", error));
    saveLeftOut(leftOut).catch((error) => console.error("Can't save the lamps left out", error));
  }

  /** Checks or unchecks one lamp, keeping the others as they show. */
  function toggleLamp(toggled, checked) {
    store((lamp) => (lamp.id === toggled.id ? checked : isChecked(lamp)));
  }

  /** A checkbox from sdpi-components, which saves nothing itself, since it has no `setting`. */
  function checkbox(label, checked, onChange) {
    const box = document.createElement("sdpi-checkbox");
    box.setAttribute("label", label);
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

  /** A lamp's row: its checkbox, by its name or else its label, and a note when it isn't connected. */
  function lampRow(lamp) {
    const row = document.createElement("div");
    row.className = "lamp";
    row.append(checkbox(names[lamp.id] ?? lamp.label, isChecked(lamp), (value) => toggleLamp(lamp, value)));
    if (lamp.missing) {
      row.append(note("not found"));
    }
    return row;
  }

  /** Draws the picker from what the key has saved and what the plugin found. */
  function render() {
    const rows = [];
    if (found === undefined) {
      rows.push(note("Looking for lamps…"));
    } else {
      const lamps = listed();
      if (lamps.length === 0) {
        rows.push(note("No lamps found"));
      }
      rows.push(...lamps.map(lampRow));
      rows.push(checkbox("All", lamps.every(isChecked), (value) => store(() => value)));
    }
    picker.replaceChildren(...rows);
  }

  // Listened for from the start, since plugin-settings.js may tell it before this page knows it's a key's.
  document.addEventListener("litra:adds-new-lamps", (event) => {
    addsNew = event.detail;
    if (found !== undefined) {
      render();
    }
  });

  (async () => {
    // A dial's main screen acts on every lamp, so a page shared with a dial lists none there.
    const info = await client.getConnectionInfo();
    if (info?.actionInfo?.payload?.controller === "Encoder") {
      return;
    }
    // The plugin settings tell of the names they change and the lamps they find.
    document.addEventListener("litra:lamp-names", (event) => {
      names = event.detail;
      render();
    });
    document.addEventListener("litra:lamps", (event) => {
      found = event.detail;
      render();
    });
    render();
    [saved, leftOut, names] = await Promise.all([
      readSaved().then((value) => value ?? "all"),
      readLeftOut().then(validLamps),
      readNames().then(validNames),
    ]);
    await findLamps();
  })().catch((error) => console.error("Can't show the lamps", error));
})();
