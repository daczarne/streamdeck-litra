// The lamps a key acts on (#20): a checkbox for each lamp the plugin finds, with a button that blinks it, and one for
// every lamp. The key's `lamps` setting is "all", or the lamps checked, each with its id and the label shown for it,
// so a lamp that isn't connected keeps its name here. A file rather than an inline script, so the pages'
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

  /** Asks the plugin for the lamps connected now, and shows them. */
  async function findLamps() {
    found = undefined;
    render();
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

  /** A button from sdpi-components. */
  function button(text, onClick) {
    const element = document.createElement("sdpi-button");
    element.textContent = text;
    element.addEventListener("click", onClick);
    return element;
  }

  /** A line of grey text. */
  function note(text) {
    const element = document.createElement("p");
    element.className = "note";
    element.textContent = text;
    return element;
  }

  /** A lamp's row: its checkbox, and a button that blinks it, or a note when it isn't connected. */
  function lampRow(lamp) {
    const row = document.createElement("div");
    row.className = "lamp";
    const checked = saved === "all" || saved.some(({ id }) => id === lamp.id);
    row.append(checkbox(lamp.label, checked, (value) => toggleLamp(lamp, value)));
    if (lamp.missing) {
      row.append(note("not found"));
    } else {
      row.append(button("Identify", () => client.send("sendToPlugin", { event: "identify", id: lamp.id })));
    }
    return row;
  }

  /** Draws the picker from what the key has saved and what the plugin found. */
  function render() {
    const rows = [
      button("Find lamps", () => findLamps().catch((error) => console.error("Can't find the lamps", error))),
    ];
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
    saved = (await readSaved()) ?? "all";
    await findLamps();
  })().catch((error) => console.error("Can't show the lamps", error));
})();
