// A number field with a − button on its left and a + button on its right (#195), for the settings a slider set before:
// a brightness or a temperature, a step, the blink's length. sdpi-components has no such control, so it's the plugin's
// own, an element named `litra-number`, drawn in the panel's look. − and + move the value by the setting's step, and
// greyed out at the ends of its range, and holding one repeats it. A value typed in is taken on Enter, or once the field
// is left, snapped to the step and kept within the range, and one that isn't a number goes back to the value shown.
// The unit shows inside the field, after the value.
//
// With a `setting`, the field reads and saves it, an action's or, with `global`, the plugin's, as an sdpi-components
// control does, and shows its `default` while the setting is missing. Without one, it saves nothing, and a script sets
// its `value` and hears the user's changes through `valuechange`, as with an sdpi-components control without a
// `setting`. A change saves once the clicks stop for a moment, so a run of clicks or a hold saves once, and at once on
// Enter, on leaving the field, or on letting go of a button held. A file rather than an inline script, so the pages'
// Content-Security-Policy doesn't have to allow inline scripts.
(() => {
  // How long a button is held before it repeats, how often it repeats, and how long after the last change a value saves.
  const HOLD_DELAY_MS = 400;
  const REPEAT_MS = 80;
  const SAVE_DELAY_MS = 300;

  // The panel's look, written out from sdpi-components' styles, whose custom properties stay inside its elements: its
  // buttons' border and hover, and its fields' background and text.
  const style = document.createElement("style");
  style.textContent = `
    litra-number {
      display: inline-flex;
      align-items: stretch;
      gap: 4px;
      height: 26px;
      font-family: "Segoe UI", Arial, Roboto, Helvetica, sans-serif;
      font-size: 9pt;
    }

    litra-number button {
      width: 26px;
      padding: 0;
      background-color: #2d2d2d;
      border: 1px solid #969696;
      border-radius: 3px;
      color: #d8d8d8;
      font-family: inherit;
      font-size: 11pt;
      line-height: 1;
      user-select: none;
    }

    litra-number button:not(:disabled):hover {
      background-color: #464646;
      cursor: pointer;
    }

    litra-number button:not(:disabled):active {
      background-color: #2d2d2d;
      border-color: #646464;
      color: #969696;
    }

    litra-number button:disabled,
    litra-number[disabled] .entry {
      opacity: 0.5;
    }

    /* The field: the value and its unit, centered together, on the background of sdpi-components' fields. A page that
      needs it narrower, such as to fit several on a row, sets --number-field-width. Its class isn't "field", which the
      plugin settings give their power states' options, stacked in a column, and which would stack the unit under the
      value. */
    litra-number .entry {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 2px;
      width: var(--number-field-width, 72px);
      background-color: #3d3d3d;
      color: #d8d8d8;
      cursor: text;
    }

    litra-number input {
      padding: 0;
      background: transparent;
      border: none;
      outline: none;
      color: inherit;
      font-family: inherit;
      font-size: inherit;
      font-variant-numeric: tabular-nums;
      text-align: right;
    }
  `;
  document.head.append(style);

  /** The number field, as a page writes it: `<litra-number setting min max step default unit>`. */
  class NumberField extends HTMLElement {
    /** Draws the buttons and the field once, and reads the setting it saves, if any. */
    connectedCallback() {
      if (this.input !== undefined) {
        return;
      }
      this.minus = this.button("−", "Lower", -1);
      this.plus = this.button("+", "Raise", 1);
      this.input = document.createElement("input");
      this.input.inputMode = "decimal";
      this.input.addEventListener("input", () => this.fit());
      this.input.addEventListener("keydown", (event) => this.onKey(event));
      this.input.addEventListener("blur", () => this.take(this.input.value, true));
      const unit = document.createElement("span");
      unit.className = "unit";
      unit.textContent = this.getAttribute("unit") ?? "";
      const field = document.createElement("div");
      field.className = "entry";
      field.append(this.input, unit);
      field.addEventListener("click", () => this.input.focus());
      this.append(this.minus, field, this.plus);
      if (this._value === undefined) {
        this._value = this.snap(this.fallback);
      }
      this.show();
      this.bind();
    }

    /** The lowest value, the highest, the step between values, and the value while the setting is missing. */
    get min() {
      return Number(this.getAttribute("min") ?? 0);
    }

    get max() {
      return Number(this.getAttribute("max") ?? 100);
    }

    get step() {
      return Number(this.getAttribute("step") ?? 1);
    }

    get fallback() {
      return Number(this.getAttribute("default") ?? this.min);
    }

    /** The value shown. */
    get value() {
      return this._value;
    }

    /** Shows a value set by a script, snapped and kept within the range, without saving it or telling of it. */
    set value(value) {
      this._value = this.snap(Number(value));
      this.show();
    }

    /** The disabled state, which greys out the buttons and the field. */
    get disabled() {
      return this.hasAttribute("disabled");
    }

    set disabled(disabled) {
      this.toggleAttribute("disabled", disabled);
      this.show();
    }

    /** A button that moves the value one step down or up, and keeps doing it while it's held. */
    button(text, label, direction) {
      const element = document.createElement("button");
      element.type = "button";
      element.textContent = text;
      element.setAttribute("aria-label", label);
      // A click waits for the pause after it, as typing does, while a hold that repeated saves once it's let go.
      const stop = () => {
        if (this.holding === undefined) {
          return;
        }
        clearTimeout(this.holding);
        clearInterval(this.holding);
        this.holding = undefined;
        if (this.repeated) {
          this.save();
        } else {
          this.saveSoon();
        }
      };
      element.addEventListener("pointerdown", (event) => {
        if (element.disabled || event.button !== 0) {
          return;
        }
        event.preventDefault();
        this.repeated = false;
        this.holding = setTimeout(() => {
          this.repeated = true;
          this.holding = setInterval(() => this.nudge(direction), REPEAT_MS);
        }, HOLD_DELAY_MS);
        this.nudge(direction);
      });
      for (const end of ["pointerup", "pointerleave", "pointercancel"]) {
        element.addEventListener(end, stop);
      }
      // The keyboard presses a focused button with Enter or the space bar, which a pointer doesn't send.
      element.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.nudge(direction);
          this.save();
        }
      });
      return element;
    }

    /** Takes the arrow keys as − and +, and Enter as the end of typing. */
    onKey(event) {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        this.nudge(event.key === "ArrowUp" ? 1 : -1);
      } else if (event.key === "Enter") {
        this.take(this.input.value, true);
      }
    }

    /** A value snapped to the step, counted from the lowest value, and kept within the range. */
    snap(value) {
      const { min, max, step } = this;
      if (!Number.isFinite(value)) {
        return this._value ?? min;
      }
      const snapped = min + Math.round((value - min) / step) * step;
      // Rounded again, so a step such as 0.1 leaves no trailing digits.
      return Math.min(max, Math.max(min, Math.round(snapped * 1e6) / 1e6));
    }

    /** Moves the value one step down or up, as − and + do. */
    nudge(direction) {
      this.change(this._value + direction * this.step);
    }

    /** Takes a typed value, or shows the one before for one that isn't a number, and saves it at once when asked. */
    take(text, now) {
      const typed = Number.parseFloat(text);
      if (!Number.isNaN(typed)) {
        this.change(typed);
      }
      // The field shows what it took, snapped, or the value before, even while it has focus.
      this.input.value = String(this._value);
      this.fit();
      if (now) {
        this.save();
      }
    }

    /**
     * Shows the user's new value, and saves it once the changes stop for a moment, or, while a button is held, once it's
     * let go.
     */
    change(value) {
      const snapped = this.snap(value);
      if (snapped === this._value) {
        this.show();
        return;
      }
      this._value = snapped;
      this.changed = true;
      this.show();
      if (this.holding === undefined) {
        this.saveSoon();
      }
    }

    /** Saves a change once the changes stop for a moment. */
    saveSoon() {
      clearTimeout(this.pending);
      this.pending = setTimeout(() => this.save(), SAVE_DELAY_MS);
    }

    /** Saves the value now, or tells of it for a field without a setting, if it changed since it was last saved. */
    save() {
      clearTimeout(this.pending);
      this.pending = undefined;
      if (!this.changed) {
        return;
      }
      this.changed = false;
      if (this.store !== undefined) {
        this.store(this._value).catch((error) => console.error(`Can't save ${this.getAttribute("setting")}`, error));
      }
      this.dispatchEvent(new Event("valuechange"));
    }

    /** Shows the value, and greys out a button at its end of the range, or everything while it's disabled. */
    show() {
      if (this.input === undefined) {
        return;
      }
      // A value being typed is left as it is until it's taken.
      if (document.activeElement !== this.input || this.changed) {
        this.input.value = String(this._value);
      }
      this.fit();
      this.input.disabled = this.disabled;
      this.minus.disabled = this.disabled || this._value <= this.min;
      this.plus.disabled = this.disabled || this._value >= this.max;
    }

    /**
     * Makes the input as wide as the text in it, as it's shown or typed, so the field centers the value and its unit
     * together, rather than the widest value the range holds, which left a shorter value and its unit off center.
     */
    fit() {
      this.input.style.width = `${Math.max(this.input.value.length, 1)}ch`;
    }

    /** Reads and follows the setting the field saves, if it has one, keeping a change the user hasn't saved yet. */
    bind() {
      const setting = this.getAttribute("setting");
      if (setting === null) {
        return;
      }
      const use = this.hasAttribute("global") ? SDPIComponents.useGlobalSettings : SDPIComponents.useSettings;
      const arrived = (saved) => {
        if (!this.changed && this.holding === undefined) {
          this.value = saved ?? this.fallback;
        }
      };
      const [read, store] = use(setting, arrived, 0);
      this.store = store;
      read()
        .then(arrived)
        .catch((error) => console.error(`Can't read ${setting}`, error));
    }
  }

  customElements.define("litra-number", NumberField);
})();
