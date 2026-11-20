// A dial's own title (#181): the × at the end of its row empties the field, which takes the dial back to the title the
// plugin settings give its action's dials, shown in the field as its placeholder (plugin-settings.js). It's greyed out
// while the field is empty, with nothing to clear. A file rather than an inline script, so the pages'
// Content-Security-Policy doesn't have to allow inline scripts.
//
// Its styles are in settings.css, with every page's (#247).
(() => {
  for (const row of document.querySelectorAll(".text-and-clear")) {
    const field = row.querySelector("sdpi-textfield");
    const clear = row.querySelector("button.clear");
    // The field tells of every change: the title typed, the one the dial's settings hold as they arrive, and a clear.
    const show = () => {
      clear.disabled = !field.value;
    };
    field.addEventListener("valuechange", show);
    // sdpi-components saves the empty title itself, and the input keeps the focus, so a new title can be typed at once.
    clear.addEventListener("click", () => {
      field.value = "";
      field.shadowRoot?.querySelector("input")?.focus();
    });
    show();
  }
})();
