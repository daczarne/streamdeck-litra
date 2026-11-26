// A number field with a − button on its left and a + button on its right (#195), for the settings a slider set before:
// a brightness or a temperature, a step, the blink's length. sdpi-components has no such control, so it's the plugin's
// own, an element named `litra-number`, drawn in the panel's look. − and + move the value by the setting's step, and
// greyed out at the ends of its range, and holding one repeats it. A value typed in is taken on Enter, or once the
// field is left, snapped to the step and kept within the range, and one that isn't a number goes back to the value
// shown. The unit shows inside the field, after the value. A disabled field is a setting that doesn't apply, such as a
// scene group's presets while it turns its lamps off: it shows a dash in place of its value and unit, and keeps its
// value.
//
// With a `setting`, the field reads and saves it, an action's or, with `global`, the plugin's, as an sdpi-components
// control does, and shows its `default` while the setting is missing. Without one, it saves nothing, and a script sets
// its `value` and hears the user's changes through `valuechange`, as with an sdpi-components control without a
// `setting`. A change saves once the clicks stop for a moment, so a run of clicks or a hold saves once, and at once on
// Enter, on leaving the field, or on letting go of a button held. A file rather than an inline script, so the pages'
// Content-Security-Policy doesn't have to allow inline scripts.
//
// Its styles are in settings.css, with every page's (#247).
(() => {
  // How long a button is held before it repeats, how often it repeats, and how long after the last change a value
  // saves.
  const HOLD_DELAY_MS = 400;
  const REPEAT_MS = 80;
  const SAVE_DELAY_MS = 300;

  /** The number field, as a page writes it: `<litra-number setting min max step default unit>`. */
  class NumberField extends HTMLElement {
    /**
     * Draws the buttons and the field once, and reads the setting it saves, if any.
     *
     * @returns {void}
     */
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
      this.unit = document.createElement("span");
      this.unit.className = "unit";
      this.unit.textContent = this.getAttribute("unit") ?? "";
      const field = document.createElement("div");
      field.className = "entry";
      field.append(this.input, this.unit);
      field.addEventListener("click", () => this.input.focus());
      this.append(this.minus, field, this.plus);
      if (this._value === undefined) {
        this._value = this.snap(this.fallback);
      }
      this.show();
      this.bind();
    }

    /**
     * The lowest value.
     *
     * @returns {number}
     */
    get min() {
      return Number(this.getAttribute("min") ?? 0);
    }

    /**
     * The highest value.
     *
     * @returns {number}
     */
    get max() {
      return Number(this.getAttribute("max") ?? 100);
    }

    /**
     * The step between values.
     *
     * @returns {number}
     */
    get step() {
      return Number(this.getAttribute("step") ?? 1);
    }

    /**
     * The value while the setting is missing.
     *
     * @returns {number}
     */
    get fallback() {
      return Number(this.getAttribute("default") ?? this.min);
    }

    /**
     * The value shown.
     *
     * @returns {number}
     */
    get value() {
      return this._value;
    }

    /**
     * Shows a value set by a script, snapped and kept within the range, without saving it or telling of it.
     *
     * @param {unknown} value
     */
    set value(value) {
      this._value = this.snap(Number(value));
      this.show();
    }

    /**
     * The disabled state, which greys out the buttons and the field, and shows a dash in place of the value.
     *
     * @returns {boolean}
     */
    get disabled() {
      return this.hasAttribute("disabled");
    }

    /**
     * Greys out the field, or brings it back.
     *
     * @param {boolean} disabled
     */
    set disabled(disabled) {
      this.toggleAttribute("disabled", disabled);
      this.show();
    }

    /**
     * A button that moves the value one step down or up, and keeps doing it while it's held.
     *
     * @param {string} text what the button shows
     * @param {string} label what it's read as
     * @param {-1 | 1} direction down or up
     * @returns {HTMLButtonElement}
     */
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

    /**
     * Takes the arrow keys as − and +, and Enter as the end of typing.
     *
     * @param {KeyboardEvent} event
     * @returns {void}
     */
    onKey(event) {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        this.nudge(event.key === "ArrowUp" ? 1 : -1);
      } else if (event.key === "Enter") {
        this.take(this.input.value, true);
      }
    }

    /**
     * A value snapped to the step, counted from the lowest value, and kept within the range.
     *
     * @param {number} value
     * @returns {number}
     */
    snap(value) {
      const { min, max, step } = this;
      if (!Number.isFinite(value)) {
        return this._value ?? min;
      }
      const snapped = min + Math.round((value - min) / step) * step;
      // Rounded again, so a step such as 0.1 leaves no trailing digits.
      return Math.min(max, Math.max(min, Math.round(snapped * 1e6) / 1e6));
    }

    /**
     * Moves the value one step down or up, as − and + do.
     *
     * @param {-1 | 1} direction
     * @returns {void}
     */
    nudge(direction) {
      this.change(this._value + direction * this.step);
    }

    /**
     * Takes a typed value, or shows the one before for one that isn't a number, and saves it at once when asked.
     *
     * @param {string} text what was typed
     * @param {boolean} now whether to save it at once
     * @returns {void}
     */
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
     * Shows the user's new value, and saves it once the changes stop for a moment, or, while a button is held, once
     * it's let go.
     *
     * @param {number} value
     * @returns {void}
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

    /**
     * Saves a change once the changes stop for a moment.
     *
     * @returns {void}
     */
    saveSoon() {
      clearTimeout(this.pending);
      this.pending = setTimeout(() => this.save(), SAVE_DELAY_MS);
    }

    /**
     * Saves the value now, or tells of it for a field without a setting, if it changed since it was last saved.
     *
     * @returns {void}
     */
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

    /**
     * Shows the value, and greys out a button at its end of the range, or everything while it's disabled, when it shows
     * a dash instead of the value and its unit.
     *
     * @returns {void}
     */
    show() {
      if (this.input === undefined) {
        return;
      }
      this.unit.hidden = this.disabled;
      if (this.disabled) {
        this.input.value = "—";
      } else if (document.activeElement !== this.input || this.changed) {
        // A value being typed is left as it is until it's taken.
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
     *
     * @returns {void}
     */
    fit() {
      this.input.style.width = `${Math.max(this.input.value.length, 1)}ch`;
    }

    /**
     * Reads and follows the setting the field saves, if it has one, keeping a change the user hasn't saved yet.
     *
     * @returns {void}
     */
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
