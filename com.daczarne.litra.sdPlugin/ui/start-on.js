// The screen a Brightness or Temperature dial starts on as it appears (#278): its main screen, or a lamp's, which the
// dial shows while the lamp is connected, until its strip is tapped. A list of "Main screen" and the lamps the plugin
// knows, from its global settings, as the keys' lamp pickers list them (lamp-picker.js): each by the name given to it
// in the plugin settings (#146), or else its label, such as "Beam - c870", in the order of their ids. The dial saves
// its choice as `startOn`: "main", or the lamp's id. A lamp the plugin no longer knows, such as one forgotten, shows
// "Main screen" chosen, the screen the dial starts on then, while the dial keeps its id, so the lamp is the dial's
// again once the plugin knows it. Beside it, the color the dial shows its lamp in, which the page saves itself, as
// `startColor`, is greyed out while the list shows "Main screen", where it changes nothing. A file rather than an
// inline script, so the pages' Content-Security-Policy doesn't have to allow inline scripts.
//
// Its styles are in settings.css, with every page's (#247).
(() => {
  const container = document.getElementById("start-on");
  if (container === null) {
    return;
  }
  const MAIN = "main";
  const color = document.getElementById("start-color");

  // What the dial saved, and the lamps the plugin knows, by id, or undefined until they're read.
  let saved = MAIN;
  let known;
  // What the list shows, its options and the one chosen, so it's drawn afresh only when that changes.
  let drawn;

  const [readSaved, save] = SDPIComponents.useSettings(
    "startOn",
    (value) => {
      saved = validStart(value);
      render();
    },
    0,
  );

  // The lamps arrive with the global settings, each time the plugin saves them.
  const [readKnown] = SDPIComponents.useGlobalSettings("lamps", (value) => {
    known = validKnown(value);
    render();
  });

  /**
   * The screen the dial saved, or the main screen when it saved none, or something that isn't one.
   *
   * @param {unknown} value what the dial saved as `startOn`
   * @returns {string}
   */
  function validStart(value) {
    return typeof value === "string" && value !== "" ? value : MAIN;
  }

  /**
   * The lamps the plugin knows, by id, or none when they aren't lamps by id: each with a model, and a name only when
   * it's text.
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
          ? [[id, { model: lamp.model, ...(typeof lamp.name === "string" ? { name: lamp.name } : {}) }]]
          : [],
      ),
    );
  }

  /**
   * The screens offered: the main screen, then every lamp the plugin knows, in the order of their ids.
   *
   * @returns {[string, string][]} each screen's value and text
   */
  function offered() {
    const lamps = Object.entries(known ?? {})
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([id, lamp]) => [id, lamp.name ?? `${lamp.model} - ${id.slice(-4)}`]);
    return [[MAIN, "Main screen"], ...lamps];
  }

  /**
   * Draws the list afresh, with its options in place before it's on the page, showing the screen the dial starts on:
   * the lamp it saved, or the main screen for a lamp the plugin doesn't know, unless it already shows them. A list from
   * sdpi-components that saves nothing itself, and also reports the value this script gives it, which matches what it
   * last showed and is left out, as is a value that isn't one of its screens, so only a choice saves.
   *
   * @returns {void}
   */
  function render() {
    const screens = offered();
    const shown = screens.some(([id]) => id === saved) ? saved : MAIN;
    const showing = JSON.stringify({ screens, shown });
    if (showing === drawn) {
      return;
    }
    drawn = showing;
    const list = document.createElement("sdpi-select");
    for (const [value, text] of screens) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      list.append(option);
    }
    list.value = shown;
    // What the list last showed: the screen this script gave it, then each choice.
    let chosen = shown;
    greyColor(shown);
    list.addEventListener("valuechange", () => {
      if (list.value === chosen || !screens.some(([id]) => id === list.value)) {
        return;
      }
      chosen = list.value;
      saved = list.value;
      greyColor(chosen);
      save(saved).catch((error) => console.error("Can't save the screen the dial starts on", error));
    });
    container.replaceChildren(list);
  }

  /**
   * Greys out the color while the dial starts on its main screen, where it shows no lamp to color.
   *
   * @param {string} shown the screen the list shows
   * @returns {void}
   */
  function greyColor(shown) {
    if (color !== null) {
      color.disabled = shown === MAIN;
    }
  }

  Promise.all([readSaved(), readKnown()])
    .then(([start, lamps]) => {
      saved = validStart(start);
      known = validKnown(lamps);
      render();
    })
    .catch((error) => console.error("Can't show the screen the dial starts on", error));
})();
