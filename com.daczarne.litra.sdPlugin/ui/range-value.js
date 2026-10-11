// Shows each slider's value in the <output> that names it, since sdpi-range only shows it as a tooltip (#15). A file
// rather than an inline script, so the pages' Content-Security-Policy doesn't have to allow inline scripts.
for (const output of document.querySelectorAll("output[for]")) {
  const range = document.getElementById(output.getAttribute("for"));
  const suffix = output.dataset.suffix ?? "";
  const show = (value) => {
    output.value = value === undefined || value === "" ? "" : `${value}${suffix}`;
  };
  const current = () => range.value ?? range.defaultValue;

  // The saved settings arriving from Stream Deck, or the slider released.
  range.addEventListener("valuechange", () => show(current()));
  // sdpi-range only takes the slider's value on release, so a drag is followed on the slider itself.
  range.addEventListener("input", (event) => show(event.composedPath()[0].value));
  show(current());
}
