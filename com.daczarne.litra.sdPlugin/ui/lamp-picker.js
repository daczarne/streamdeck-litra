// The lamps a key acts on (#20): a checkbox for each lamp the plugin finds, and one for every lamp. Each lamp shows
// with the name given to it in the plugin settings (plugin-settings.js, #146), or else its label, such as
// "Beam - 7K98". The key's `lamps` setting is "all", or the lamps checked, each with its id and its label, so a lamp
// that isn't connected keeps its place here. A file rather than an inline script, so the pages'
// Content-Security-Policy doesn't have to allow inline scripts.
(() => {
  const picker = document.getElementById("lamp-picker");
  if (picker === null) {
    return;
  }
  const client = SDPIComponents.streamDeckClient;

  // What the key has saved: "all", or the lamps checked.
  let saved = "all";
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

  /** Every lamp the page lists: the ones found, then the ones the key has saved that weren't, marked as missing. */
  function listed() {
    const lamps = (found ?? []).map(({ id, label }) => ({ id, label, missing: false }));
    if (saved !== "all") {
      for (const { id, label } of saved) {
        if (!lamps.some((lamp) => lamp.id === id)) {
          lamps.push({ id, label, missing: true });
        }
      }
    }
    return lamps;
  }

  /** Saves the key's lamps and shows them. */
  function store(value) {
    saved = value;
    render();
    save(value).catch((error) => console.error("Can't save the lamps", error));
  }

  /** Checks or unchecks one lamp. Every lamp checked one by one is a list of them, not "all", which takes in new ones. */
  function toggleLamp(toggled, checked) {
    const isChecked = (lamp) =>
      lamp.id === toggled.id ? checked : saved === "all" || saved.some(({ id }) => id === lamp.id);
    store(
      listed()
        .filter(isChecked)
        .map(({ id, label }) => ({ id, label })),
    );
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
    const checked = saved === "all" || saved.some(({ id }) => id === lamp.id);
    row.append(checkbox(names[lamp.id] ?? lamp.label, checked, (value) => toggleLamp(lamp, value)));
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
      rows.push(checkbox("All", saved === "all", (value) => store(value ? "all" : [])));
    }
    picker.replaceChildren(...rows);
  }

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
    [saved, names] = await Promise.all([readSaved().then((value) => value ?? "all"), readNames().then(validNames)]);
    await findLamps();
  })().catch((error) => console.error("Can't show the lamps", error));
})();
