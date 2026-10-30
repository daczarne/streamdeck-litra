// The plugin's own settings (#146), the same on every action's page: a button at the top of the page shows them in
// place of the action's, and back. They list the lamps the plugin finds, each by the end of its serial number and its
// model, with a field for its name and a button that blinks it. The names are kept in the plugin's global settings, as
// `lampNames`, by lamp id, and the keys' lamp pickers show them (lamp-picker.js, which this tells of every name changed
// and every lamp found, through events on the document). Under the lamps come the global settings that every dial and
// key shares, such as whether each lamp steps from its own value (#145), and the lamp screens' blink (#144), which a
// dial's own page can turn on or off for that dial alone. A file rather than an inline script, so the pages'
// Content-Security-Policy doesn't have to allow inline scripts.
(() => {
  const container = document.getElementById("plugin-settings");
  if (container === null) {
    return;
  }
  const client = SDPIComponents.streamDeckClient;
  const MAX_NAME_LENGTH = 24;

  // Whether the plugin settings are shown, in place of the action's.
  let open = false;
  // The lamps' names, by id.
  let names = {};
  // The lamps the plugin found, or undefined while it's asked.
  let found;

  const style = document.createElement("style");
  style.textContent = `
    body.plugin-settings-open > :not(#plugin-settings) {
      display: none;
    }

    #plugin-settings .note {
      color: #969696;
      margin: 0;
      padding: 4px 0;
    }

    #plugin-settings table {
      width: 100%;
      border-collapse: collapse;
      color: #969696;
      font-family: "Segoe UI", Arial, Roboto, Helvetica, sans-serif;
      font-size: 9pt;
      margin-bottom: 10px;
    }

    #plugin-settings th {
      font-weight: bold;
      text-align: center;
      padding: 0 4px 4px;
    }

    /* Wide enough for the longest model, "Beam LX", with room on each side, whichever lamps are connected. A width
      would give way to the name's, which takes the rest of the row. */
    #plugin-settings th.model {
      min-width: 10ch;
    }

    #plugin-settings td {
      padding: 2px 4px;
      text-align: center;
      white-space: nowrap;
    }

    #plugin-settings td.name {
      width: 100%;
    }

    /* A checkbox with a third, indeterminate state, drawn as sdpi-components draws its own, which has none, with its
      check mark. Inside quotes, a data: URL only needs its "#" encoded. */
    .tri-state {
      align-items: center;
      cursor: pointer;
      display: inline-flex;
      outline: 0;
      padding: 5px 0 0 0;
      user-select: none;
    }

    .tri-state .symbol {
      align-self: flex-start;
      background: #3d3d3d;
      border: 1px solid rgba(0, 0, 0, 0.2);
      border-radius: 3px;
      flex: 0 0 16px;
      height: 16px;
      width: 16px;
    }

    .tri-state .text {
      margin: 0 0 0 4px;
    }

    .tri-state:not([aria-checked="false"]) .symbol {
      background: #77f no-repeat center center;
      border: 1px solid rgba(0, 0, 0, 0.4);
    }

    .tri-state[aria-checked="true"] .symbol {
      background-image: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='10' viewBox='0 0 12 10'><polygon fill='%23FFF' points='7.2 7.5 7.2 -1.3 8.7 -1.3 8.6 9.1 2.7 8.7 2.7 7.2' transform='rotate(37 5.718 3.896)'/></svg>");
    }

    .tri-state[aria-checked="mixed"] .symbol {
      background-image: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='2' viewBox='0 0 10 2'><rect width='10' height='2' fill='%23FFF'/></svg>");
    }
  `;
  document.head.append(style);

  // Names saved by other pages arrive with the global settings.
  const [readNames, saveNames] = SDPIComponents.useGlobalSettings("lampNames", (value) => {
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

  /** Names a lamp, or takes its name away when `name` is blank, and tells the lamp picker. */
  function rename(id, name) {
    const trimmed = name.trim();
    const others = Object.entries(names).filter(([other]) => other !== id);
    names = Object.fromEntries(trimmed === "" ? others : [...others, [id, trimmed]]);
    document.dispatchEvent(new CustomEvent("litra:lamp-names", { detail: names }));
    saveNames(names).catch((error) => console.error("Can't save the lamps' names", error));
  }

  /** Asks the plugin for the lamps connected now, shows them, and tells the lamp picker. */
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
    document.dispatchEvent(new CustomEvent("litra:lamps", { detail: found }));
    render();
  }

  /** Shows the plugin settings, with the names saved and the lamps connected now, or the action's settings again. */
  async function toggle() {
    open = !open;
    document.body.classList.toggle("plugin-settings-open", open);
    render();
    if (open) {
      names = validNames(await readNames());
      await findLamps();
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

  /** A lamp's row: the end of its serial number, its model, its name, and a button that blinks it. */
  function lampRow(lamp) {
    const name = document.createElement("sdpi-textfield");
    name.setAttribute("maxlength", String(MAX_NAME_LENGTH));
    name.setAttribute("placeholder", lamp.label);
    name.value = names[lamp.id] ?? "";
    // Added after the value is set, so only the user's typing reaches it.
    name.addEventListener("valuechange", () => rename(lamp.id, name.value ?? ""));

    const row = document.createElement("tr");
    row.className = "lamp";
    const nameCell = cell("td", name);
    nameCell.className = "name";
    const identify = button("Identify", () => client.send("sendToPlugin", { event: "identify", id: lamp.id }));
    row.append(cell("td", lamp.serialEnd), cell("td", lamp.model), nameCell, cell("td", identify));
    return row;
  }

  /** The table of the lamps found. */
  function lampTable(lamps) {
    const table = document.createElement("table");
    const model = cell("th", "Model");
    model.className = "model";
    const head = cell("tr", cell("th", "ID"), model, cell("th", "Name"), cell("th"));
    table.append(cell("thead", head), cell("tbody", ...lamps.map(lampRow)));
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

  //* The lamp screens' blink (#144): whether every dial blinks each lamp as its lamp screen shows it, and the dials that
  // chose otherwise on their own page, by id. The plugin settings show every dial's at once, indeterminate when the
  // dials differ, and a click there gives every dial the same again, even the ones not on screen. A dial's page shows
  // its own (`#dial-blink`).

  // The plugin's setting, and the ids of the dials that chose otherwise.
  let blink = false;
  let blinkExceptions = [];
  // The id of the dial whose page this is, or undefined on a key's page or until it's known.
  let dialId;

  // Saved at once, without sdpi-components' wait for more changes, so a page closed right after a click keeps it.
  const [readBlink, saveBlink] = SDPIComponents.useGlobalSettings(
    "blinkOnLampScreen",
    (value) => {
      blink = value === true;
      renderBlink();
    },
    0,
  );
  const [readBlinkExceptions, saveBlinkExceptions] = SDPIComponents.useGlobalSettings(
    "blinkOnLampScreenExceptions",
    (value) => {
      blinkExceptions = validIds(value);
      renderBlink();
    },
    0,
  );

  /** The ids in the global settings, or none when they aren't a list of ids. */
  function validIds(value) {
    return Array.isArray(value) ? value.filter((id) => typeof id === "string") : [];
  }

  /** Whether the dial whose page this is blinks: the plugin's setting, or the opposite if it chose otherwise. */
  function dialBlinks() {
    return blink !== blinkExceptions.includes(dialId);
  }

  /** Shows the blink on both checkboxes, and saves the dials that chose otherwise. */
  function storeBlinkExceptions() {
    renderBlink();
    saveBlinkExceptions(blinkExceptions).catch((error) => console.error("Can't save the blink's dials", error));
  }

  // Every dial's: checked turns it off for every dial, and empty or indeterminate turns it on for every dial.
  const everyDialBlink = triStateCheckbox("Blink each lamp as it's shown, on every dial", () => {
    blink = !(blink && blinkExceptions.length === 0);
    blinkExceptions = [];
    saveBlink(blink).catch((error) => console.error("Can't save the blink", error));
    storeBlinkExceptions();
  });

  // The dial's own, on a dial's page. A checkbox from sdpi-components that saves nothing itself, and also reports the
  // changes this script makes, which match the setting already and are left out, so only a click changes it.
  const dialBlinkContainer = document.getElementById("dial-blink");
  const dialBlink = document.createElement("sdpi-checkbox");
  dialBlink.setAttribute("label", "Blink each lamp as it's shown, on this dial");
  dialBlink.addEventListener("valuechange", () => {
    if (dialId === undefined || dialBlink.value === dialBlinks()) {
      return;
    }
    blinkExceptions = blinkExceptions.includes(dialId)
      ? blinkExceptions.filter((id) => id !== dialId)
      : [...blinkExceptions, dialId];
    storeBlinkExceptions();
  });

  /** Shows the blink on both checkboxes. */
  function renderBlink() {
    everyDialBlink.setAttribute("aria-checked", blinkExceptions.length > 0 ? "mixed" : String(blink));
    if (dialId !== undefined) {
      dialBlink.value = dialBlinks();
    }
  }

  (async () => {
    const info = await client.getConnectionInfo();
    if (info?.actionInfo?.payload?.controller === "Encoder" && dialBlinkContainer !== null) {
      dialId = info.actionInfo.context;
      dialBlinkContainer.append(dialBlink);
    }
    [blink, blinkExceptions] = await Promise.all([
      readBlink().then((value) => value === true),
      readBlinkExceptions().then(validIds),
    ]);
    renderBlink();
  })().catch((error) => console.error("Can't show the blink", error));

  /** Logs a failure to find the lamps, which the page has no other way to show. */
  function showError(error) {
    console.error("Can't show the lamps", error);
  }

  // The checkboxes are on the page from the start, though hidden, since sdpi-components only gives a control the
  // global settings that arrive once it's on the page. Only the lamps are drawn again.
  const toggleButton = button("Plugin settings", () => toggle().catch(showError));
  const lampList = document.createElement("div");
  const view = document.createElement("div");
  view.hidden = true;
  view.append(
    item(
      undefined,
      button("Find lamps", () => findLamps().catch(showError)),
    ),
    lampList,
    item(
      "Each lamp",
      globalCheckbox("keepBrightnessDifference", "Steps from its own brightness, on every dial and key"),
      globalCheckbox("keepTemperatureDifference", "Steps from its own temperature, on every dial and key"),
    ),
    item("Lamp screens", everyDialBlink),
  );
  container.append(item(undefined, toggleButton), view);

  /**
   * Shows the button's text, and the plugin settings when they're open, with the lamps found. A name field being typed
   * in isn't redrawn, so the names that arrive from Stream Deck don't move its cursor.
   */
  function render() {
    toggleButton.textContent = open ? "Back" : "Plugin settings";
    view.hidden = !open;
    if (!open || document.activeElement?.closest("#plugin-settings sdpi-textfield")) {
      return;
    }
    if (found === undefined) {
      lampList.replaceChildren(note("Looking for lamps…"));
    } else if (found.length === 0) {
      lampList.replaceChildren(note("No lamps found"));
    } else {
      lampList.replaceChildren(lampTable(found));
    }
  }
})();
