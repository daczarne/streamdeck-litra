// A switch for whether a scene's group turns its lamps on or off (#174), in place of a list of On and Off, so a group's
// power and presets fit on one row. sdpi-components has no switch, so it's the plugin's own, an element named
// `litra-switch`: grey when it's off, and in the purple of sdpi-components' checked checkbox when it's on. It saves "on"
// or "off", as the list did. With a `setting`, it reads and saves it, as an sdpi-components control does, shows its
// `default` while the setting is missing, and tells of each value it shows, the user's or the saved one, through
// `valuechange`. Without one, it saves nothing, and a script sets its `value` and hears the user's changes through
// `valuechange`. A file rather than an inline script, so the pages' Content-Security-Policy doesn't have to allow inline
// scripts.
(() => {
  const style = document.createElement("style");
  style.textContent = `
    litra-switch {
      display: inline-flex;
      align-items: center;
      height: 26px;
    }

    litra-switch button {
      position: relative;
      width: 36px;
      height: 20px;
      padding: 0;
      background-color: #3d3d3d;
      border: 1px solid #969696;
      border-radius: 10px;
      cursor: pointer;
      transition: background-color 0.12s;
    }

    litra-switch button::after {
      content: "";
      position: absolute;
      top: 2px;
      left: 2px;
      width: 14px;
      height: 14px;
      background-color: #969696;
      border-radius: 50%;
      transition: transform 0.12s, background-color 0.12s;
    }

    litra-switch button[aria-checked="true"] {
      background-color: #77f;
      border-color: rgba(0, 0, 0, 0.4);
    }

    litra-switch button[aria-checked="true"]::after {
      background-color: #ffffff;
      transform: translateX(16px);
    }
  `;
  document.head.append(style);

  /** The switch, as a page writes it: `<litra-switch setting default>`. */
  class PowerSwitch extends HTMLElement {
    /** Draws the switch once, and reads the setting it saves, if any. */
    connectedCallback() {
      if (this.button !== undefined) {
        return;
      }
      this.button = document.createElement("button");
      this.button.type = "button";
      this.button.setAttribute("role", "switch");
      this.button.setAttribute("aria-label", this.getAttribute("label") ?? "Power");
      this.button.addEventListener("click", () => this.toggle());
      this.append(this.button);
      if (this._value === undefined) {
        this._value = this.valid(this.getAttribute("default"));
      }
      this.show();
      this.bind();
    }

    /** The value shown: "on" or "off". */
    get value() {
      return this._value;
    }

    /** Shows a value set by a script, without saving it or telling of it. */
    set value(value) {
      this._value = this.valid(value);
      this.show();
    }

    /** A value the switch shows: "off", or else "on", the default of a scene's power. */
    valid(value) {
      return value === "off" ? "off" : "on";
    }

    /** Turns the switch the other way, saves it, and tells of it. */
    toggle() {
      this._value = this._value === "on" ? "off" : "on";
      this.show();
      if (this.store !== undefined) {
        this.store(this._value).catch((error) => console.error(`Can't save ${this.getAttribute("setting")}`, error));
      }
      this.dispatchEvent(new Event("valuechange"));
    }

    /** Shows the value. */
    show() {
      this.button?.setAttribute("aria-checked", String(this._value === "on"));
    }

    /** Reads and follows the setting the switch saves, if it has one. */
    bind() {
      const setting = this.getAttribute("setting");
      if (setting === null) {
        return;
      }
      const arrived = (saved) => {
        this.value = saved ?? this.getAttribute("default");
        this.dispatchEvent(new Event("valuechange"));
      };
      const [read, store] = SDPIComponents.useSettings(setting, arrived, 0);
      this.store = store;
      read()
        .then(arrived)
        .catch((error) => console.error(`Can't read ${setting}`, error));
    }
  }

  customElements.define("litra-switch", PowerSwitch);
})();
